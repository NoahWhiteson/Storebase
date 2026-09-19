import Foundation

final class CloudFS: @unchecked Sendable {
  let client: APIClient
  let cache = BlockCache()
  private let gate = NSLock()
  private var listings: [String: (at: Date, items: [APIClient.DriveItem])] = [:]
  private var stats: [String: (at: Date, item: APIClient.DriveItem)] = [:]

  init(client: APIClient) {
    self.client = client
  }

  func invalidate(_ path: String) {
    let prefix = path
    gate.lock()
    listings = listings.filter { key, _ in key != prefix && !key.hasPrefix(prefix.isEmpty ? "\u{0}" : prefix + "/") }
    listings.removeValue(forKey: parentOf(path))
    listings.removeValue(forKey: path)
    stats.removeValue(forKey: path)
    gate.unlock()
    cache.drop(path: path)
  }

  func list(_ path: String) async throws -> [APIClient.DriveItem] {
    if let hit = gate.sync({ listings[path] }), Date().timeIntervalSince(hit.at) < 2 {
      return hit.items
    }
    let items = try await client.list(path: path)
    gate.sync { listings[path] = (Date(), items) }
    return items
  }

  func stat(_ path: String) async throws -> APIClient.DriveItem {
    if path.isEmpty {
      return APIClient.DriveItem(path: "", name: "", type: "folder", size: 0, modifiedAt: "1970-01-01T00:00:00.000Z")
    }
    if let hit = gate.sync({ stats[path] }), Date().timeIntervalSince(hit.at) < 2 {
      return hit.item
    }
    if let fromList = cachedChild(path) {
      gate.sync { stats[path] = (Date(), fromList) }
      return fromList
    }
    let item = try await client.stat(path: path)
    gate.sync { stats[path] = (Date(), item) }
    return item
  }

  func read(path: String, offset: Int64, length: Int) async throws -> Data {
    guard length > 0, offset >= 0 else { return Data() }
    let item = try await stat(path)
    if item.isFolder { throw APIError(status: 400, message: "Not a file", code: nil) }
    let size = item.size
    if offset >= size { return Data() }
    let want = Int(min(Int64(length), size - offset))
    var out = Data()
    out.reserveCapacity(want)
    var cursor = offset
    while out.count < want {
      let aligned = cursor - (cursor % BlockCache.chunk)
      let chunk = try await chunkAt(path: path, aligned: aligned, size: size)
      let inner = Int(cursor - aligned)
      if inner >= chunk.count { break }
      let take = min(want - out.count, chunk.count - inner)
      out.append(chunk.subdata(in: inner ..< (inner + take)))
      cursor += Int64(take)
    }
    return out
  }

  func write(path: String, offset: Int64, data: Data, total: Int64?) async throws {
    if data.isEmpty, offset == 0, total == nil || total == 0 {
      _ = try await client.putRange(path: path, offset: 0, data: Data(), total: 0)
      invalidate(path)
      return
    }
    var cursor = offset
    var slice = data
    while !slice.isEmpty {
      let aligned = cursor - (cursor % BlockCache.chunk)
      let inner = Int(cursor - aligned)
      let take = min(slice.count, Int(BlockCache.chunk) - inner)
      let piece = slice.prefix(take)
      if inner == 0, take == Int(BlockCache.chunk) || (total != nil && cursor + Int64(take) == total) {
        cache.put(path: path, offset: aligned, data: Data(piece))
      } else {
        cache.drop(path: path)
      }
      _ = try await client.putRange(path: path, offset: cursor, data: Data(piece), total: total)
      slice = slice.dropFirst(take)
      cursor += Int64(take)
    }
    invalidate(path)
  }

  func mkdir(_ path: String) async throws {
    try await client.mkdir(path)
    invalidate(path)
  }

  func remove(_ path: String) async throws {
    try await client.trash(path)
    invalidate(path)
  }

  func move(from: String, to: String) async throws {
    if parentOf(from) == parentOf(to), fileName(from) != fileName(to) {
      try await client.rename(path: from, name: fileName(to))
    } else {
      try await client.move(path: from, destDir: parentOf(to))
      if fileName(from) != fileName(to) {
        try await client.rename(path: "\(parentOf(to).isEmpty ? "" : parentOf(to) + "/")\(fileName(from))", name: fileName(to))
      }
    }
    invalidate(from)
    invalidate(to)
  }

  private func chunkAt(path: String, aligned: Int64, size: Int64) async throws -> Data {
    if let hit = cache.get(path: path, offset: aligned), !hit.isEmpty {
      return hit
    }
    let length = Int(min(BlockCache.chunk, max(0, size - aligned)))
    let data = try await client.getRange(path: path, offset: aligned, length: length)
    if data.count == length {
      cache.put(path: path, offset: aligned, data: data)
    }
    return data
  }

  private func cachedChild(_ path: String) -> APIClient.DriveItem? {
    let parent = parentOf(path)
    guard let hit = gate.sync({ listings[parent] }), Date().timeIntervalSince(hit.at) < 2 else { return nil }
    return hit.items.first { $0.path == path }
  }

  private func parentOf(_ path: String) -> String {
    guard let slash = path.lastIndex(of: "/") else { return "" }
    return String(path[..<slash])
  }

  private func fileName(_ path: String) -> String {
    URL(fileURLWithPath: path).lastPathComponent
  }
}

private extension NSLock {
  func sync<T>(_ body: () -> T) -> T {
    lock()
    defer { unlock() }
    return body()
  }
}
