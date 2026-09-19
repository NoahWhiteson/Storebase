import Foundation
import Network

struct PairResponse: Decodable {
  let token: String
  let user: PairUser
  let nodeName: String?
  let reservedBytes: Int64
  let quotaBytes: Int64?
  let usedBytes: Int64
}

struct PairUser: Decodable {
  let name: String
  let email: String
}

struct StatusResponse: Decodable {
  let reservedBytes: Int64
  let quotaBytes: Int64?
  let usedBytes: Int64
  let availableBytes: Int64
  let nodeName: String?
  let host: String?
}

struct APIError: LocalizedError {
  let status: Int
  let message: String
  let code: String?

  var errorDescription: String? { message }
  var isQuota: Bool { status == 507 || code == "QUOTA" }
}

final class APIClient: @unchecked Sendable {
  var baseURL: URL
  var token: String
  var limitBytesPerSecond = 0

  init(baseURL: URL, token: String) {
    self.baseURL = baseURL
    self.token = token
  }

  static func pair(baseURL: URL, code: String, deviceName: String) async throws -> PairResponse {
    var request = URLRequest(url: baseURL.appendingPathComponent("api/pair"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.timeoutInterval = 20
    let body: [String: String] = [
      "code": code,
      "name": deviceName,
      "platform": "mac",
    ]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await NodeHTTP.data(for: request)
    try Self.throwIfNeeded(data: data, response: response)
    return try JSONDecoder().decode(PairResponse.self, from: data)
  }

  func status() async throws -> StatusResponse {
    try await get("/api/status", as: StatusResponse.self)
  }

  func mkdir(_ path: String) async throws {
    try await postJSON("/api/files/mkdir", body: ["path": path])
  }

  func trash(_ path: String) async throws {
    try await postJSON("/api/files/trash", body: ["path": path])
  }

  @discardableResult
  func upload(fileURL: URL, destDir: String, onProgress: (@Sendable (Int64, Int64) -> Void)? = nil) async throws -> String {
    var comps = URLComponents(url: baseURL.appendingPathComponent("api/files/upload"), resolvingAgainstBaseURL: false)!
    comps.queryItems = [URLQueryItem(name: "path", value: destDir)]
    var request = URLRequest(url: comps.url!)
    request.httpMethod = "POST"
    request.timeoutInterval = 60 * 60
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let boundary = "sb-\(UUID().uuidString)"
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    let (data, response) = try await NodeHTTP.upload(
      request: request,
      fileURL: fileURL,
      boundary: boundary,
      limitBps: limitBytesPerSecond,
      onProgress: onProgress
    )
    try Self.throwIfNeeded(data: data, response: response)
    struct Body: Decodable {
      struct Item: Decodable { let path: String }
      let item: Item
    }
    return try JSONDecoder().decode(Body.self, from: data).item.path
  }

  func livePaths() async throws -> Set<String> {
    var comps = URLComponents(url: baseURL.appendingPathComponent("api/files"), resolvingAgainstBaseURL: false)!
    comps.queryItems = [URLQueryItem(name: "view", value: "index")]
    var request = URLRequest(url: comps.url!)
    request.timeoutInterval = 30
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await NodeHTTP.data(for: request)
    try Self.throwIfNeeded(data: data, response: response)
    struct Body: Decodable { let paths: [String] }
    return Set(try JSONDecoder().decode(Body.self, from: data).paths)
  }

  func download(path: String, to dest: URL, onProgress: (@Sendable (Int64, Int64) -> Void)? = nil) async throws {
    var comps = URLComponents(url: baseURL.appendingPathComponent("api/files/download"), resolvingAgainstBaseURL: false)!
    comps.queryItems = [URLQueryItem(name: "path", value: path)]
    var request = URLRequest(url: comps.url!)
    request.timeoutInterval = 60 * 60
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await NodeHTTP.download(
      request: request,
      to: dest,
      limitBps: limitBytesPerSecond,
      onProgress: onProgress
    )
    try Self.throwIfNeeded(data: data, response: response)
    if let http = response as? HTTPURLResponse {
      let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
      if type.contains("json"), !path.lowercased().hasSuffix(".json") {
        throw APIError(status: http.statusCode, message: "Node sent an error instead of the file", code: nil)
      }
    }
    if data.isEmpty, (try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize) == 0 {
      throw APIError(status: 0, message: "Empty download", code: nil)
    }
  }

  private func postJSON(_ path: String, body: [String: Any]) async throws {
    var request = authorized(path: path)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await NodeHTTP.data(for: request)
    try Self.throwIfNeeded(data: data, response: response)
  }

  private func get<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
    let request = authorized(path: path)
    let (data, response) = try await NodeHTTP.data(for: request)
    try Self.throwIfNeeded(data: data, response: response)
    return try JSONDecoder().decode(T.self, from: data)
  }

  private func authorized(path: String) -> URLRequest {
    var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
    request.timeoutInterval = 20
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    return request
  }

  fileprivate static func throwIfNeeded(data: Data, response: URLResponse) throws {
    guard let http = response as? HTTPURLResponse else {
      throw APIError(status: 0, message: "No response", code: nil)
    }
    if (200 ..< 300).contains(http.statusCode) { return }
    struct Body: Decodable { var error: String?; var code: String? }
    let parsed = try? JSONDecoder().decode(Body.self, from: data)
    throw APIError(
      status: http.statusCode,
      message: parsed?.error ?? "Request failed (\(http.statusCode))",
      code: parsed?.code
    )
  }
}

enum NodeHTTP {
  static func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    guard let url = request.url, let host = url.host, !host.isEmpty else {
      throw APIError(status: 0, message: "Bad node URL", code: nil)
    }
    let timeout = request.timeoutInterval > 0 ? request.timeoutInterval : 20
    return try await Task.detached {
      try await NodeCall(request: request, url: url, host: host).run(timeout: timeout)
    }.value
  }

  static func upload(
    request: URLRequest,
    fileURL: URL,
    boundary: String,
    limitBps: Int,
    onProgress: (@Sendable (Int64, Int64) -> Void)?
  ) async throws -> (Data, URLResponse) {
    guard let url = request.url, let host = url.host, !host.isEmpty else {
      throw APIError(status: 0, message: "Bad node URL", code: nil)
    }
    let timeout = request.timeoutInterval > 0 ? request.timeoutInterval : 60 * 60
    return try await Task.detached {
      try await NodeCall(request: request, url: url, host: host).uploadFile(
        fileURL,
        boundary: boundary,
        limitBps: limitBps,
        timeout: timeout,
        onProgress: onProgress
      )
    }.value
  }

  static func download(
    request: URLRequest,
    to dest: URL,
    limitBps: Int,
    onProgress: (@Sendable (Int64, Int64) -> Void)?
  ) async throws -> (Data, URLResponse) {
    guard let url = request.url, let host = url.host, !host.isEmpty else {
      throw APIError(status: 0, message: "Bad node URL", code: nil)
    }
    let timeout = request.timeoutInterval > 0 ? request.timeoutInterval : 60 * 60
    return try await Task.detached {
      try await NodeCall(request: request, url: url, host: host).downloadFile(
        to: dest,
        limitBps: limitBps,
        timeout: timeout,
        onProgress: onProgress
      )
    }.value
  }
}

private final class NodeCall: @unchecked Sendable {
  private let request: URLRequest
  private let url: URL
  private let host: String
  private let queue = DispatchQueue(label: "app.storebase.http")
  private var connection: NWConnection?
  private var buffer = Data()
  private var continuation: CheckedContinuation<(Data, URLResponse), Error>?
  private var timeoutItem: DispatchWorkItem?

  init(request: URLRequest, url: URL, host: String) {
    self.request = request
    self.url = url
    self.host = host
  }

  func run(timeout: TimeInterval) async throws -> (Data, URLResponse) {
    try await withCheckedThrowingContinuation { cont in
      queue.async { [self] in
        self.continuation = cont
        let item = DispatchWorkItem { [weak self = self] in
          self?.fail(APIError(status: 0, message: "Timed out talking to the node", code: nil))
        }
        self.timeoutItem = item
        self.queue.asyncAfter(deadline: .now() + timeout, execute: item)
        self.start()
      }
    }
  }

  private func start() {
    let useTLS = url.scheme?.lowercased() == "https"
    let portValue = url.port ?? (useTLS ? 443 : 80)
    guard let port = NWEndpoint.Port(rawValue: UInt16(truncatingIfNeeded: portValue)) else {
      fail(APIError(status: 0, message: "Bad port", code: nil))
      return
    }
    let params: NWParameters
    if useTLS {
      params = NWParameters(tls: NWProtocolTLS.Options())
    } else {
      params = .tcp
    }
    let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: params)
    self.connection = connection
    connection.stateUpdateHandler = { [self] state in
      switch state {
      case .ready:
        self.sendRequest()
      case .failed(let error):
        self.fail(mapNWError(error))
      case .cancelled:
        break
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  func uploadFile(
    _ fileURL: URL,
    boundary: String,
    limitBps: Int,
    timeout: TimeInterval,
    onProgress: (@Sendable (Int64, Int64) -> Void)?
  ) async throws -> (Data, URLResponse) {
    try await open(timeout: timeout)
    defer { closeStream() }
    let name = fileURL.lastPathComponent.replacingOccurrences(of: "\"", with: "")
    let prefix = Data(
      "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8
    )
    let suffix = Data("\r\n--\(boundary)--\r\n".utf8)
    let total = Int64((try FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.int64Value ?? 0)
    let length = prefix.count + Int(total) + suffix.count
    try await sendChunk(headerData(contentLength: length) + prefix, complete: false)
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }
    var sent: Int64 = 0
    let pacer = Pacer(bps: limitBps)
    onProgress?(0, total)
    while true {
      let chunk = handle.readData(ofLength: 32 * 1024)
      if chunk.isEmpty { break }
      await pacer.add(chunk.count)
      try await sendChunk(chunk, complete: false)
      sent += Int64(chunk.count)
      onProgress?(sent, total)
    }
    try await sendChunk(suffix, complete: true)
    let raw = try await readCompleteMessage()
    return try parseHTTP(raw, url: url)
  }

  func downloadFile(
    to dest: URL,
    limitBps: Int,
    timeout: TimeInterval,
    onProgress: (@Sendable (Int64, Int64) -> Void)?
  ) async throws -> (Data, URLResponse) {
    try await open(timeout: timeout)
    defer { closeStream() }
    try await sendChunk(headerData(contentLength: 0), complete: true)
    let (head, firstBody) = try await readHeaders()
    let parsedHead = try parseHTTPHead(head, url: url)
    let headers = parsedHead.headers
    let status = parsedHead.status
    let response = parsedHead.response
    if !(200 ..< 300).contains(status) {
      var rest = firstBody
      rest.append(try await readRemaining(after: rest, headers: headers))
      if let len = Int(headers["content-length"] ?? ""), rest.count > len {
        rest = Data(rest.prefix(len))
      }
      return (rest, response)
    }
    let type = headers["content-type"] ?? ""
    if type.contains("json") {
      var rest = firstBody
      rest.append(try await readRemaining(after: rest, headers: headers))
      return (rest, response)
    }
    let expected = Int64(headers["content-length"] ?? "") ?? -1
    let tmp = dest.appendingPathExtension("part")
    if FileManager.default.fileExists(atPath: tmp.path) {
      try FileManager.default.removeItem(at: tmp)
    }
    FileManager.default.createFile(atPath: tmp.path, contents: nil)
    let out = try FileHandle(forWritingTo: tmp)
    defer { try? out.close() }
    var writtenCount = Int64(firstBody.count)
    let pacer = Pacer(bps: limitBps)
    if !firstBody.isEmpty {
      await pacer.add(firstBody.count)
      try out.write(contentsOf: firstBody)
    }
    onProgress?(writtenCount, expected > 0 ? expected : writtenCount)
    while expected < 0 || writtenCount < expected {
      let (chunk, eof) = try await receiveOnce()
      if !chunk.isEmpty {
        await pacer.add(chunk.count)
        try out.write(contentsOf: chunk)
        writtenCount += Int64(chunk.count)
        let total = expected > 0 ? expected : writtenCount
        onProgress?(writtenCount, total)
      }
      if eof { break }
      if expected >= 0, writtenCount >= expected { break }
    }
    if expected >= 0, writtenCount > expected {
      try out.truncate(atOffset: UInt64(expected))
    }
    try? out.close()
    if FileManager.default.fileExists(atPath: dest.path) {
      try FileManager.default.removeItem(at: dest)
    }
    try FileManager.default.moveItem(at: tmp, to: dest)
    return (Data(), response)
  }

  private func open(timeout: TimeInterval) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      queue.async { [self] in
        self.readyCont = cont
        let item = DispatchWorkItem { [weak self = self] in
          self?.failReady(APIError(status: 0, message: "Timed out talking to the node", code: nil))
        }
        self.timeoutItem = item
        self.queue.asyncAfter(deadline: .now() + timeout, execute: item)
        self.startReady()
      }
    }
  }

  private func startReady() {
    let useTLS = url.scheme?.lowercased() == "https"
    let portValue = url.port ?? (useTLS ? 443 : 80)
    guard let port = NWEndpoint.Port(rawValue: UInt16(truncatingIfNeeded: portValue)) else {
      failReady(APIError(status: 0, message: "Bad port", code: nil))
      return
    }
    let params: NWParameters = useTLS ? NWParameters(tls: NWProtocolTLS.Options()) : .tcp
    let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: params)
    self.connection = connection
    connection.stateUpdateHandler = { [self] state in
      switch state {
      case .ready:
        self.timeoutItem?.cancel()
        self.timeoutItem = nil
        if let readyCont {
          self.readyCont = nil
          readyCont.resume()
        } else {
          self.sendRequest()
        }
      case .failed(let error):
        self.failReady(mapNWError(error))
        self.fail(mapNWError(error))
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  private func sendChunk(_ data: Data, complete: Bool) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      queue.async {
        guard let connection = self.connection else {
          cont.resume(throwing: APIError(status: 0, message: "Connection dropped", code: nil))
          return
        }
        connection.send(
          content: data.isEmpty ? nil : data,
          contentContext: .defaultMessage,
          isComplete: complete,
          completion: .contentProcessed { error in
            if let error {
              cont.resume(throwing: mapNWError(error))
            } else {
              cont.resume()
            }
          }
        )
      }
    }
  }

  private func receiveOnce() async throws -> (Data, Bool) {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(Data, Bool), Error>) in
      self.queue.async {
        guard let connection = self.connection else {
          cont.resume(throwing: APIError(status: 0, message: "Connection dropped", code: nil))
          return
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { data, _, isComplete, error in
          if let error {
            cont.resume(throwing: mapNWError(error))
            return
          }
          cont.resume(returning: (data ?? Data(), isComplete))
        }
      }
    }
  }

  private func readHeaders() async throws -> (Data, Data) {
    var buf = Data()
    let sep = Data("\r\n\r\n".utf8)
    while true {
      let (chunk, eof) = try await receiveOnce()
      buf.append(chunk)
      if let range = buf.range(of: sep) {
        let head = buf.subdata(in: buf.startIndex ..< range.lowerBound)
        let body = buf.subdata(in: range.upperBound ..< buf.endIndex)
        return (head, body)
      }
      if eof {
        throw APIError(status: 0, message: "Empty response from node", code: nil)
      }
    }
  }

  private func readCompleteMessage() async throws -> Data {
    var buf = Data()
    while true {
      let (chunk, eof) = try await receiveOnce()
      buf.append(chunk)
      if let message = httpMessageIfComplete(buf, eof: eof) {
        return message
      }
      if eof {
        throw APIError(status: 0, message: "Node closed the connection before answering", code: nil)
      }
    }
  }

  private func readRemaining(after existing: Data, headers: [String: String]) async throws -> Data {
    if let rawLen = headers["content-length"], let len = Int(rawLen) {
      var buf = Data()
      while existing.count + buf.count < len {
        let (chunk, eof) = try await receiveOnce()
        buf.append(chunk)
        if eof { break }
      }
      return buf
    }
    var buf = Data()
    while true {
      let (chunk, eof) = try await receiveOnce()
      buf.append(chunk)
      if eof { break }
    }
    return buf
  }

  private func headerData(contentLength: Int) -> Data {
    encodeHeaders(request, url: url, host: host, contentLength: contentLength)
  }

  private func closeStream() {
    timeoutItem?.cancel()
    timeoutItem = nil
    connection?.stateUpdateHandler = nil
    connection?.cancel()
    connection = nil
  }

  private func failReady(_ error: Error) {
    timeoutItem?.cancel()
    timeoutItem = nil
    if let readyCont {
      self.readyCont = nil
      readyCont.resume(throwing: error)
    }
  }

  private var readyCont: CheckedContinuation<Void, Error>?

  private func sendRequest() {
    guard let connection else { return }
    let payload = encodeRequest(request, url: url, host: host)
    connection.send(content: payload, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed { [self] error in
      if let error {
        self.fail(mapNWError(error))
        return
      }
      self.readMore()
    })
  }

  private func readMore() {
    guard let connection else { return }
    connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [self] data, _, isComplete, error in
      if let error {
        self.fail(mapNWError(error))
        return
      }
      if let data {
        self.buffer.append(data)
      }
      if let message = httpMessageIfComplete(self.buffer, eof: isComplete) {
        self.succeed(message)
        return
      }
      if isComplete {
        self.fail(APIError(status: 0, message: "Node closed the connection before answering", code: nil))
        return
      }
      self.readMore()
    }
  }

  private func succeed(_ raw: Data) {
    do {
      let parsed = try parseHTTP(raw, url: url)
      finish(.success(parsed))
    } catch {
      fail(error)
    }
  }

  private func fail(_ error: Error) {
    finish(.failure(error))
  }

  private func finish(_ result: Result<(Data, URLResponse), Error>) {
    timeoutItem?.cancel()
    timeoutItem = nil
    connection?.stateUpdateHandler = nil
    connection?.cancel()
    connection = nil
    guard let continuation else { return }
    self.continuation = nil
    continuation.resume(with: result)
  }
}

private func encodeRequest(_ request: URLRequest, url: URL, host: String) -> Data {
  let method = request.httpMethod ?? "GET"
  var path = url.path.isEmpty ? "/" : url.path
  if let query = url.query, !query.isEmpty { path += "?\(query)" }
  let useTLS = url.scheme?.lowercased() == "https"
  let port = url.port ?? (useTLS ? 443 : 80)
  let defaultPort = useTLS ? 443 : 80
  let hostHeader = port == defaultPort ? host : "\(host):\(port)"
  var lines = [
    "\(method) \(path) HTTP/1.1",
    "Host: \(hostHeader)",
    "Accept: */*",
    "Connection: close",
  ]
  let body = request.httpBody ?? Data()
  if let headers = request.allHTTPHeaderFields {
    for (key, value) in headers {
      if key.caseInsensitiveCompare("Host") == .orderedSame { continue }
      if key.caseInsensitiveCompare("Content-Length") == .orderedSame { continue }
      if key.caseInsensitiveCompare("Connection") == .orderedSame { continue }
      lines.append("\(key): \(value)")
    }
  }
  lines.append("Content-Length: \(body.count)")
  var data = Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
  data.append(body)
  return data
}

private func encodeHeaders(_ request: URLRequest, url: URL, host: String, contentLength: Int) -> Data {
  let method = request.httpMethod ?? "GET"
  var path = url.path.isEmpty ? "/" : url.path
  if let query = url.query, !query.isEmpty { path += "?\(query)" }
  let useTLS = url.scheme?.lowercased() == "https"
  let port = url.port ?? (useTLS ? 443 : 80)
  let defaultPort = useTLS ? 443 : 80
  let hostHeader = port == defaultPort ? host : "\(host):\(port)"
  var lines = [
    "\(method) \(path) HTTP/1.1",
    "Host: \(hostHeader)",
    "Accept: */*",
    "Connection: close",
  ]
  if let headers = request.allHTTPHeaderFields {
    for (key, value) in headers {
      if key.caseInsensitiveCompare("Host") == .orderedSame { continue }
      if key.caseInsensitiveCompare("Content-Length") == .orderedSame { continue }
      if key.caseInsensitiveCompare("Connection") == .orderedSame { continue }
      lines.append("\(key): \(value)")
    }
  }
  if contentLength > 0 || !["GET", "HEAD"].contains((request.httpMethod ?? "GET").uppercased()) {
    lines.append("Content-Length: \(contentLength)")
  }
  return Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
}

private struct ParsedHead {
  var status: Int
  var headers: [String: String]
  var response: HTTPURLResponse
}

private func parseHTTPHead(_ head: Data, url: URL) throws -> ParsedHead {
  guard let headText = String(data: head, encoding: .isoLatin1) else {
    throw APIError(status: 0, message: "Garbled response from node", code: nil)
  }
  let lines = headText.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
  guard let statusLine = lines.first else {
    throw APIError(status: 0, message: "Empty response from node", code: nil)
  }
  let statusParts = statusLine.split(separator: " ")
  guard statusParts.count >= 2, let code = Int(statusParts[1]) else {
    throw APIError(status: 0, message: "Bad HTTP status from node", code: nil)
  }
  let headers = headerMap(headText)
  guard let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers) else {
    throw APIError(status: 0, message: "Bad HTTP status from node", code: nil)
  }
  return ParsedHead(status: code, headers: headers, response: response)
}

private final class Pacer {
  let bps: Int
  private var start = DispatchTime.now()
  private var bytes = 0

  init(bps: Int) {
    self.bps = bps
  }

  func add(_ n: Int) async {
    guard bps > 0, n > 0 else { return }
    bytes += n
    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000_000
    let allowed = Double(bps) * max(elapsed, 0.001)
    if Double(bytes) > allowed {
      let wait = (Double(bytes) / Double(bps)) - elapsed
      if wait > 0.004 {
        let ns = UInt64(min(wait, 2) * 1_000_000_000)
        try? await Task.sleep(nanoseconds: ns)
      }
    }
    if elapsed > 2 {
      start = DispatchTime.now()
      bytes = 0
    }
  }
}

private func httpMessageIfComplete(_ data: Data, eof: Bool) -> Data? {
  guard let sep = data.range(of: Data("\r\n\r\n".utf8)) else { return eof ? data : nil }
  let head = data.subdata(in: data.startIndex ..< sep.lowerBound)
  let body = data.subdata(in: sep.upperBound ..< data.endIndex)
  guard let headText = String(data: head, encoding: .isoLatin1) else { return eof ? data : nil }
  let headers = headerMap(headText)
  if let rawLen = headers["content-length"], let len = Int(rawLen) {
    return body.count >= len || eof ? data : nil
  }
  if (headers["transfer-encoding"] ?? "").lowercased().contains("chunked") {
    return decodeChunked(body) != nil || eof ? data : nil
  }
  return eof ? data : nil
}

private func parseHTTP(_ data: Data, url: URL) throws -> (Data, URLResponse) {
  guard let sep = data.range(of: Data("\r\n\r\n".utf8)) else {
    throw APIError(status: 0, message: "Empty response from node", code: nil)
  }
  let head = data.subdata(in: data.startIndex ..< sep.lowerBound)
  var body = data.subdata(in: sep.upperBound ..< data.endIndex)
  guard let headText = String(data: head, encoding: .isoLatin1) else {
    throw APIError(status: 0, message: "Garbled response from node", code: nil)
  }
  let lines = headText.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
  guard let statusLine = lines.first else {
    throw APIError(status: 0, message: "Empty response from node", code: nil)
  }
  let statusParts = statusLine.split(separator: " ")
  guard statusParts.count >= 2, let code = Int(statusParts[1]) else {
    throw APIError(status: 0, message: "Bad HTTP status from node", code: nil)
  }
  let headers = headerMap(headText)
  if (headers["transfer-encoding"] ?? "").lowercased().contains("chunked") {
    body = decodeChunked(body) ?? body
  } else if let rawLen = headers["content-length"], let len = Int(rawLen), body.count > len {
    body = Data(body.prefix(len))
  }
  guard let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers) else {
    throw APIError(status: 0, message: "Bad HTTP status from node", code: nil)
  }
  return (body, response)
}

private func headerMap(_ head: String) -> [String: String] {
  var headers: [String: String] = [:]
  let lines = head.split(whereSeparator: \.isNewline)
  for line in lines.dropFirst() {
    let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let idx = text.firstIndex(of: ":") else { continue }
    let key = String(text[..<idx]).trimmingCharacters(in: .whitespaces).lowercased()
    let value = String(text[text.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
    headers[key] = value
  }
  return headers
}

private func decodeChunked(_ data: Data) -> Data? {
  var index = data.startIndex
  var out = Data()
  let crlf = Data("\r\n".utf8)
  while index < data.endIndex {
    guard let lineEnd = data[index...].range(of: crlf) else { return nil }
    let sizeLine = String(data: data[index ..< lineEnd.lowerBound], encoding: .ascii) ?? ""
    let sizeText = sizeLine.trimmingCharacters(in: .whitespacesAndNewlines)
      .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: true)
      .first.map(String.init) ?? ""
    guard let size = Int(sizeText, radix: 16) else { return nil }
    index = lineEnd.upperBound
    if size == 0 { return out }
    guard let next = data.index(index, offsetBy: size, limitedBy: data.endIndex) else { return nil }
    out.append(data[index ..< next])
    index = next
    if index.distance(to: data.endIndex) >= 2 {
      let end = data.index(index, offsetBy: 2)
      if data[index ..< end] == crlf {
        index = end
      }
    }
  }
  return nil
}

private func mapNWError(_ error: Error) -> Error {
  guard let nw = error as? NWError else { return error }
  switch nw {
  case .posix(let code) where code == .ECONNREFUSED:
    return APIError(
      status: 0,
      message: "Could not reach the node. Is Storebase running and is that IP/port reachable from this Mac?",
      code: nil
    )
  case .posix(let code) where code == .ETIMEDOUT || code == .EHOSTUNREACH || code == .ENETUNREACH:
    return APIError(status: 0, message: "Could not reach the node. Check the IP, port, and firewall.", code: nil)
  case .dns(_):
    return APIError(status: 0, message: "Could not resolve that hostname.", code: nil)
  default:
    return error
  }
}
