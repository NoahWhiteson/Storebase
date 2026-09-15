import Foundation

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
    let (data, response) = try await URLSession.shared.data(for: request)
    try throwIfNeeded(data: data, response: response)
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
    let (data, response) = try await URLSession.shared.data(for: request)
    try throwIfNeeded(data: data, response: response)
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
    let (data, response) = try await URLSession.shared.data(for: request)
    try throwIfNeeded(data: data, response: response)
  }

  private func get<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
    let request = authorized(path: path)
    let (data, response) = try await URLSession.shared.data(for: request)
    try throwIfNeeded(data: data, response: response)
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

