import AppKit
import Foundation
import Network

final class DavVolume: @unchecked Sendable {
  private let fs: CloudFS
  private let queue = DispatchQueue(label: "app.storebase.dav")
  private var listener: NWListener?
  private var port: UInt16 = 0
  private var locks: [String: String] = [:]
  private(set) var mountPoint: URL
  private(set) var running = false

  var localURL: URL? {
    guard port > 0 else { return nil }
    return URL(string: "http://127.0.0.1:\(port)/")
  }

  init(client: APIClient) {
    fs = CloudFS(client: client)
    let home = FileManager.default.homeDirectoryForCurrentUser
    let preferred = home.appendingPathComponent("Storebase")
    if let names = try? FileManager.default.contentsOfDirectory(atPath: preferred.path), !names.isEmpty {
      mountPoint = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("app.storebase.mac/Storebase", isDirectory: true)
    } else {
      mountPoint = preferred
    }
  }

  func start() throws {
    if running { return }
    let params = NWParameters.tcp
    params.requiredInterfaceType = .loopback
    let listener = try NWListener(using: params, on: .any)
    listener.newConnectionHandler = { [weak self] connection in
      self?.serve(connection)
    }
    let ready = DispatchSemaphore(value: 0)
    var failed: Error?
    listener.stateUpdateHandler = { state in
      switch state {
      case .ready:
        ready.signal()
      case .failed(let error):
        failed = error
        ready.signal()
      default:
        break
      }
    }
    listener.start(queue: queue)
    ready.wait()
    if let failed { throw failed }
    guard let value = listener.port?.rawValue, value > 0 else {
      throw APIError(status: 0, message: "WebDAV listener did not bind a port", code: nil)
    }
    self.listener = listener
    port = value
    running = true
    do {
      try mount()
    } catch {
      listener.cancel()
      self.listener = nil
      running = false
      throw error
    }
    if !isMounted() {
      listener.cancel()
      self.listener = nil
      running = false
      throw APIError(
        status: 0,
        message: "Could not attach the Storebase disk at \(mountPoint.path). If that folder already has files, move them out and retry.",
        code: nil
      )
    }
  }

  func stop() {
    unmount()
    listener?.cancel()
    listener = nil
    running = false
    port = 0
  }

  func reveal() {
    NSWorkspace.shared.open(mountPoint)
  }

  private func mount() throws {
    let fm = FileManager.default
    try fm.createDirectory(at: mountPoint, withIntermediateDirectories: true)
    if isMounted() { return }
    guard let url = localURL else { return }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/sbin/mount_webdav")
    proc.arguments = ["-s", url.absoluteString, mountPoint.path]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    try proc.run()
    proc.waitUntilExit()
    if proc.terminationStatus == 0 { return }
    let alt = Process()
    alt.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    alt.arguments = [
      "-e",
      "mount volume \"\(url.absoluteString)\"",
    ]
    alt.standardOutput = FileHandle.nullDevice
    alt.standardError = FileHandle.nullDevice
    try? alt.run()
    alt.waitUntilExit()
  }

  private func unmount() {
    guard isMounted() else { return }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/sbin/umount")
    proc.arguments = [mountPoint.path]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    try? proc.run()
    proc.waitUntilExit()
  }

  private func isMounted() -> Bool {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/sbin/mount")
    let out = Pipe()
    proc.standardOutput = out
    proc.standardError = FileHandle.nullDevice
    do { try proc.run() } catch { return false }
    proc.waitUntilExit()
    let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    return text.contains(mountPoint.path)
  }

  private func serve(_ connection: NWConnection) {
    connection.start(queue: queue)
    Task {
      defer { connection.cancel() }
      do {
        let req = try await readRequest(connection)
        let res = await handle(req)
        try await send(res, on: connection)
      } catch {
        connection.cancel()
      }
    }
  }

  private func handle(_ req: DavRequest) async -> DavResponse {
    let path = davPath(req.uri)
    do {
      switch req.method {
      case "OPTIONS":
        return DavResponse(
          status: 200,
          headers: [
            "DAV": "1,2",
            "Allow": "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, PROPFIND, LOCK, UNLOCK",
            "MS-Author-Via": "DAV",
          ],
          body: Data()
        )
      case "PROPFIND":
        return try await propfind(path: path, depth: req.headers["depth"] ?? "1")
      case "HEAD", "GET":
        return try await get(path: path, range: req.headers["range"], head: req.method == "HEAD")
      case "PUT":
        let ranged = parseContentRange(req.headers["content-range"])
        let offset = ranged?.start ?? 0
        let total = ranged?.total ?? parsePutTotal(req) ?? Int64(req.body.count)
        try await fs.write(path: path, offset: offset, data: req.body, total: total)
        return DavResponse(status: 201, headers: [:], body: Data())
      case "MKCOL":
        try await fs.mkdir(path)
        return DavResponse(status: 201, headers: [:], body: Data())
      case "DELETE":
        try await fs.remove(path)
        return DavResponse(status: 204, headers: [:], body: Data())
      case "MOVE":
        let dest = davPath(req.headers["destination"] ?? "")
        guard !dest.isEmpty else { return DavResponse.text(400, "Destination required") }
        try await fs.move(from: path, to: dest)
        return DavResponse(status: 201, headers: [:], body: Data())
      case "LOCK":
        let token = "opaquelocktoken:\(UUID().uuidString)"
        _ = queue.sync { self.locks[path] = token }
        return DavResponse(status: 200, headers: ["Lock-Token": "<\(token)>"], body: Data(lockXML(token).utf8))
      case "UNLOCK":
        _ = queue.sync { self.locks.removeValue(forKey: path) }
        return DavResponse(status: 204, headers: [:], body: Data())
      default:
        return DavResponse.text(405, "Method not allowed")
      }
    } catch let err as APIError where err.status == 404 {
      return DavResponse.text(404, "Not found")
    } catch let err as APIError where err.status == 507 {
      return DavResponse.text(507, err.message)
    } catch {
      return DavResponse.text(500, error.localizedDescription)
    }
  }

  private func propfind(path: String, depth: String) async throws -> DavResponse {
    var items: [(href: String, item: APIClient.DriveItem)] = []
    if path.isEmpty {
      items.append((href: "/", item: APIClient.DriveItem(path: "", name: "", type: "folder", size: 0, modifiedAt: "1970-01-01T00:00:00.000Z")))
    } else {
      items.append((href: href(path, folder: false), item: try await fs.stat(path)))
    }
    if depth != "0" {
      let kids = try await fs.list(path)
      for kid in kids {
        items.append((href: href(kid.path, folder: kid.isFolder), item: kid))
      }
    } else if !path.isEmpty {
      let selfItem = try await fs.stat(path)
      items = [(href: href(path, folder: selfItem.isFolder), item: selfItem)]
    }
    var xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?><D:multistatus xmlns:D=\"DAV:\">"
    for row in items {
      let folder = row.item.isFolder
      xml += "<D:response><D:href>\(escapeXML(row.href))</D:href><D:propstat><D:prop>"
      xml += folder ? "<D:resourcetype><D:collection/></D:resourcetype>" : "<D:resourcetype/>"
      if !folder {
        xml += "<D:getcontentlength>\(row.item.size)</D:getcontentlength>"
      }
      xml += "<D:getlastmodified>\(httpDate(row.item.modified))</D:getlastmodified>"
      xml += "<D:displayname>\(escapeXML(row.item.name.isEmpty ? "Storebase" : row.item.name))</D:displayname>"
      xml += "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>"
    }
    xml += "</D:multistatus>"
    return DavResponse(
      status: 207,
      headers: ["Content-Type": "application/xml; charset=utf-8"],
      body: Data(xml.utf8)
    )
  }

  private func get(path: String, range: String?, head: Bool) async throws -> DavResponse {
    let item = try await fs.stat(path)
    if item.isFolder { return DavResponse.text(405, "Is a folder") }
    let size = item.size
    var start: Int64 = 0
    var end: Int64 = size - 1
    var status = 200
    if let range, let parsed = parseBytes(range, size: size) {
      start = parsed.0
      end = parsed.1
      status = 206
    }
    if end < start { end = start - 1 }
    let length = max(0, Int(end - start + 1))
    var headers = [
      "Accept-Ranges": "bytes",
      "Content-Type": "application/octet-stream",
    ]
    if status == 206 {
      headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
    }
    if head {
      headers["Content-Length"] = String(length)
      return DavResponse(status: status, headers: headers, body: Data())
    }
    let body = try await fs.read(path: path, offset: start, length: length)
    return DavResponse(status: status, headers: headers, body: body)
  }

  private func davPath(_ raw: String) -> String {
    var text = raw
    if let url = URL(string: text), let host = url.host, host == "127.0.0.1" || host == "localhost" {
      text = url.path
    }
    if let cut = text.firstIndex(of: "?") {
      text = String(text[..<cut])
    }
    text = text.removingPercentEncoding ?? text
    while text.hasPrefix("/") { text.removeFirst() }
    while text.hasSuffix("/") { text.removeLast() }
    if text.contains("..") { return "" }
    return text
  }

  private func href(_ path: String, folder: Bool) -> String {
    if path.isEmpty { return "/" }
    let parts = path.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
    return "/" + parts.joined(separator: "/") + (folder ? "/" : "")
  }

  private func parseBytes(_ header: String, size: Int64) -> (Int64, Int64)? {
    let match = header.range(of: #"bytes=(\d*)-(\d*)"#, options: .regularExpression)
    guard match != nil else { return nil }
    let body = header.replacingOccurrences(of: "bytes=", with: "")
    let bits = body.split(separator: "-", omittingEmptySubsequences: false)
    guard bits.count == 2 else { return nil }
    if bits[0].isEmpty, let suffix = Int64(bits[1]), suffix > 0 {
      return (max(0, size - suffix), size - 1)
    }
    let start = Int64(bits[0]) ?? 0
    let end = bits[1].isEmpty ? size - 1 : (Int64(bits[1]) ?? (size - 1))
    if start >= size { return nil }
    return (start, min(end, size - 1))
  }

  private func parsePutTotal(_ req: DavRequest) -> Int64? {
    Int64(req.headers["oc-total-length"] ?? "")
  }

  private func parseContentRange(_ header: String?) -> (start: Int64, total: Int64?)? {
    guard let header else { return nil }
    let parts = header.replacingOccurrences(of: "bytes ", with: "").split(separator: "/")
    guard let span = parts.first else { return nil }
    let ends = span.split(separator: "-")
    guard let start = Int64(ends.first ?? "") else { return nil }
    let total = parts.count > 1 && parts[1] != "*" ? Int64(parts[1]) : nil
    return (start, total)
  }

  private func lockXML(_ token: String) -> String {
    """
    <?xml version="1.0" encoding="utf-8"?>
    <D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>
    <D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>
    <D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>
    <D:locktoken><D:href>\(token)</D:href></D:locktoken>
    </D:activelock></D:lockdiscovery></D:prop>
    """
  }

  private func escapeXML(_ value: String) -> String {
    value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
  }

  private func httpDate(_ date: Date) -> String {
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US_POSIX")
    fmt.timeZone = TimeZone(secondsFromGMT: 0)
    fmt.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
    return fmt.string(from: date)
  }
}

private struct DavRequest {
  var method: String
  var uri: String
  var headers: [String: String]
  var body: Data
}

private struct DavResponse {
  var status: Int
  var headers: [String: String]
  var body: Data

  static func text(_ status: Int, _ message: String) -> DavResponse {
    DavResponse(status: status, headers: ["Content-Type": "text/plain; charset=utf-8"], body: Data(message.utf8))
  }
}

private func readRequest(_ connection: NWConnection) async throws -> DavRequest {
  var buf = Data()
  let sep = Data("\r\n\r\n".utf8)
  while buf.range(of: sep) == nil {
    let chunk = try await receive(connection)
    if chunk.isEmpty { throw APIError(status: 0, message: "Empty DAV request", code: nil) }
    buf.append(chunk)
    if buf.count > 2 * 1024 * 1024 { break }
  }
  guard let split = buf.range(of: sep) else {
    throw APIError(status: 0, message: "Bad DAV headers", code: nil)
  }
  let head = String(data: buf.subdata(in: buf.startIndex ..< split.lowerBound), encoding: .isoLatin1) ?? ""
  var rest = buf.subdata(in: split.upperBound ..< buf.endIndex)
  let lines = head.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
  guard let first = lines.first else { throw APIError(status: 0, message: "Bad DAV request", code: nil) }
  let parts = first.split(separator: " ")
  guard parts.count >= 2 else { throw APIError(status: 0, message: "Bad DAV request", code: nil) }
  var headers: [String: String] = [:]
  for line in lines.dropFirst() {
    guard let colon = line.firstIndex(of: ":") else { continue }
    let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
    let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    headers[key] = String(value)
  }
  let length = Int(headers["content-length"] ?? "") ?? 0
  while rest.count < length {
    let chunk = try await receive(connection)
    if chunk.isEmpty { break }
    rest.append(chunk)
  }
  if rest.count > length { rest = Data(rest.prefix(length)) }
  return DavRequest(method: String(parts[0]).uppercased(), uri: String(parts[1]), headers: headers, body: rest)
}

private func send(_ response: DavResponse, on connection: NWConnection) async throws {
  let reason: [Int: String] = [
    200: "OK", 201: "Created", 204: "No Content", 206: "Partial Content",
    207: "Multi-Status", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed",
    500: "Internal Server Error", 507: "Insufficient Storage",
  ]
  var headers = response.headers
  headers["Content-Length"] = String(response.body.count)
  headers["Connection"] = "close"
  headers["Date"] = {
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US_POSIX")
    fmt.timeZone = TimeZone(secondsFromGMT: 0)
    fmt.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
    return fmt.string(from: Date())
  }()
  var text = "HTTP/1.1 \(response.status) \(reason[response.status] ?? "OK")\r\n"
  for (key, value) in headers {
    text += "\(key): \(value)\r\n"
  }
  text += "\r\n"
  var data = Data(text.utf8)
  data.append(response.body)
  try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
    connection.send(content: data, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed { error in
      if let error { cont.resume(throwing: error) } else { cont.resume() }
    })
  }
}

private func receive(_ connection: NWConnection) async throws -> Data {
  try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
    connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { data, _, isComplete, error in
      if let error {
        cont.resume(throwing: error)
      } else {
        let out = data ?? Data()
        _ = isComplete
        cont.resume(returning: out)
      }
    }
  }
}
