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
    return try await NodeCall(request: request, url: url, host: host).run(timeout: timeout)
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
      queue.async {
        self.continuation = cont
        let item = DispatchWorkItem { [weak self] in
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
