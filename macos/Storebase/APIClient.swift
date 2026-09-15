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

final class APIClient {
  var baseURL: URL
  var token: String

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
    var request = authorized(path: "/api/files/mkdir")
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["path": path])
    let (data, response) = try await NodeHTTP.data(for: request)
    try Self.throwIfNeeded(data: data, response: response)
  }

  func upload(fileURL: URL, destDir: String) async throws {
    var comps = URLComponents(url: baseURL.appendingPathComponent("api/files/upload"), resolvingAgainstBaseURL: false)!
    comps.queryItems = [URLQueryItem(name: "path", value: destDir)]
    var request = URLRequest(url: comps.url!)
    request.httpMethod = "POST"
    request.timeoutInterval = 60 * 30
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let boundary = "sb-\(UUID().uuidString)"
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.httpBody = try Self.multipart(fileURL: fileURL, boundary: boundary)
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

  private static func throwIfNeeded(data: Data, response: URLResponse) throws {
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

  private static func multipart(fileURL: URL, boundary: String) throws -> Data {
    var data = Data()
    let name = fileURL.lastPathComponent
    let file = try Data(contentsOf: fileURL)
    data.append("--\(boundary)\r\n".data(using: .utf8)!)
    data.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\n".data(using: .utf8)!)
    data.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
    data.append(file)
    data.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
    return data
  }
}

enum NodeHTTP {
  static func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    guard let url = request.url, let host = url.host, !host.isEmpty else {
      throw APIError(status: 0, message: "Bad node URL", code: nil)
    }
    let timeout = request.timeoutInterval > 0 ? request.timeoutInterval : 20
    return try await withThrowingTimeout(seconds: timeout) {
      try await perform(request, url: url, host: host)
    }
  }

  private static func perform(_ request: URLRequest, url: URL, host: String) async throws -> (Data, URLResponse) {
    let scheme = url.scheme?.lowercased() ?? "http"
    let useTLS = scheme == "https"
    let port = UInt16(url.port ?? (useTLS ? 443 : 80))
    guard let nwPort = NWEndpoint.Port(rawValue: port) else {
      throw APIError(status: 0, message: "Bad port", code: nil)
    }
    let tcp = NWProtocolTCP.Options()
    let params: NWParameters
    if useTLS {
      params = NWParameters(tls: NWProtocolTLS.Options(), tcp: tcp)
    } else {
      params = NWParameters(tls: nil, tcp: tcp)
    }
    let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: params)
    try await withTaskCancellationHandler {
      try await connect(connection)
      try await send(connection, encode(request, url: url, host: host, port: port))
      let raw = try await receiveResponse(connection)
      connection.cancel()
      return try parse(raw, url: url)
    } onCancel: {
      connection.cancel()
    }
  }

  private static func connect(_ connection: NWConnection) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      let lock = ResumeOnce()
      connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
          connection.stateUpdateHandler = nil
          lock.resume { cont.resume() }
        case .failed(let error):
          connection.stateUpdateHandler = nil
          lock.resume { cont.resume(throwing: mapNWError(error)) }
        case .cancelled:
          connection.stateUpdateHandler = nil
          lock.resume { cont.resume(throwing: CancellationError()) }
        default:
          break
        }
      }
      connection.start(queue: .global(qos: .userInitiated))
    }
  }

  private static func send(_ connection: NWConnection, _ data: Data) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      let lock = ResumeOnce()
      connection.send(content: data, isComplete: true, completion: .contentProcessed { error in
        if let error {
          lock.resume { cont.resume(throwing: mapNWError(error)) }
        } else {
          lock.resume { cont.resume() }
        }
      })
    }
  }

  private static func receiveResponse(_ connection: NWConnection) async throws -> Data {
    var buffer = Data()
    while true {
      let (chunk, complete) = try await receiveChunk(connection)
      buffer.append(chunk)
      if let parsed = try completeHTTPMessage(buffer) {
        return parsed
      }
      if complete {
        if let parsed = try completeHTTPMessage(buffer, eof: true) {
          return parsed
        }
        throw APIError(status: 0, message: "Node closed the connection before answering", code: nil)
      }
    }
  }

  private static func receiveChunk(_ connection: NWConnection) async throws -> (Data, Bool) {
    try await withCheckedThrowingContinuation { cont in
      let lock = ResumeOnce()
      connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { data, _, isComplete, error in
        if let error {
          lock.resume { cont.resume(throwing: mapNWError(error)) }
          return
        }
        lock.resume { cont.resume(returning: (data ?? Data(), isComplete)) }
      }
    }
  }

  private static func encode(_ request: URLRequest, url: URL, host: String, port: UInt16) throws -> Data {
    let method = request.httpMethod ?? "GET"
    var path = url.path.isEmpty ? "/" : url.path
    if let query = url.query, !query.isEmpty { path += "?\(query)" }
    let defaultPort: UInt16 = (url.scheme?.lowercased() == "https") ? 443 : 80
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

  private static func completeHTTPMessage(_ data: Data, eof: Bool = false) throws -> Data? {
    guard let sep = data.range(of: Data("\r\n\r\n".utf8)) else { return eof ? data : nil }
    let head = data.subdata(in: data.startIndex ..< sep.lowerBound)
    let body = data.subdata(in: sep.upperBound ..< data.endIndex)
    guard let headText = String(data: head, encoding: .isoLatin1) else {
      throw APIError(status: 0, message: "Garbled response from node", code: nil)
    }
    let headers = headerMap(headText)
    if let rawLen = headers["content-length"], let len = Int(rawLen) {
      if body.count >= len { return data }
      return eof ? data : nil
    }
    if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
      if decodeChunked(body) != nil { return data }
      return eof ? data : nil
    }
    return eof ? data : nil
  }

  private static func parse(_ data: Data, url: URL) throws -> (Data, URLResponse) {
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
    if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
      body = decodeChunked(body) ?? body
    } else if let rawLen = headers["content-length"], let len = Int(rawLen), body.count > len {
      body = body.prefix(len)
    }
    let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers)
    guard let response else {
      throw APIError(status: 0, message: "Bad HTTP status from node", code: nil)
    }
    return (Data(body), response)
  }

  private static func headerMap(_ head: String) -> [String: String] {
    var headers: [String: String] = [:]
    let lines = head.split(whereSeparator: \.isNewline)
    for line in lines.dropFirst() {
      let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
      guard let idx = text.firstIndex(of: ":") else { continue }
      let key = text[..<idx].trimmingCharacters(in: .whitespaces).lowercased()
      let value = text[text.index(after: idx)...].trimmingCharacters(in: .whitespaces)
      headers[key] = value
    }
    return headers
  }

  private static func decodeChunked(_ data: Data) -> Data? {
    var index = data.startIndex
    var out = Data()
    while index < data.endIndex {
      guard let lineEnd = data[index...].range(of: Data("\r\n".utf8)) else { return nil }
      let sizeText = String(data: data[index ..< lineEnd.lowerBound], encoding: .ascii)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .split(separator: ";").first
        .map(String.init) ?? ""
      guard let size = Int(sizeText, radix: 16) else { return nil }
      index = lineEnd.upperBound
      if size == 0 { return out }
      let next = data.index(index, offsetBy: size, limitedBy: data.endIndex)
      guard let next, data.distance(from: index, to: next) == size else { return nil }
      out.append(data[index ..< next])
      index = next
      if data[index...].starts(with: Data("\r\n".utf8)) {
        index = data.index(index, offsetBy: 2)
      }
    }
    return nil
  }
}

private final class ResumeOnce: @unchecked Sendable {
  private let lock = NSLock()
  private var done = false

  func resume(_ body: () -> Void) {
    lock.lock()
    defer { lock.unlock() }
    if done { return }
    done = true
    body()
  }
}

private func mapNWError(_ error: Error) -> Error {
  guard let nw = error as? NWError else { return error }
  if case .posix(let code) = nw, code == .ECONNREFUSED {
    return APIError(status: 0, message: "Could not reach the node. Is Storebase running and is that IP/port reachable from this Mac?", code: nil)
  }
  if case .posix(let code) = nw, code == .ETIMEDOUT || code == .EHOSTUNREACH || code == .ENETUNREACH {
    return APIError(status: 0, message: "Could not reach the node. Check the IP, port, and firewall.", code: nil)
  }
  if case .dns = nw {
    return APIError(status: 0, message: "Could not resolve that hostname.", code: nil)
  }
  return error
}

private func withThrowingTimeout<T>(
  seconds: TimeInterval,
  operation: @escaping () async throws -> T
) async throws -> T {
  try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask { try await operation() }
    group.addTask {
      let nanos = UInt64(max(1, seconds) * 1_000_000_000)
      try await Task.sleep(nanoseconds: nanos)
      throw APIError(status: 0, message: "Timed out talking to the node", code: nil)
    }
    defer { group.cancelAll() }
    guard let result = try await group.next() else {
      throw APIError(status: 0, message: "Timed out talking to the node", code: nil)
    }
    return result
  }
}
