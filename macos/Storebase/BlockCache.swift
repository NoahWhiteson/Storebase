import CryptoKit
import Foundation

final class BlockCache: @unchecked Sendable {
  static let chunk: Int64 = 1_048_576
  private let root: URL
  private let maxBytes: Int64
  private let gate = NSLock()

  init(maxBytes: Int64 = 4 * 1024 * 1024 * 1024) {
    self.maxBytes = maxBytes
    root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("app.storebase.mac/blocks", isDirectory: true)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  }

  func get(path: String, offset: Int64) -> Data? {
    let url = fileURL(path: path, offset: offset)
    guard let data = try? Data(contentsOf: url), data.count == Int(Self.chunk) || !data.isEmpty else {
      return try? Data(contentsOf: url)
    }
    return data
  }

  func put(path: String, offset: Int64, data: Data) {
    let url = fileURL(path: path, offset: offset)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? data.write(to: url, options: .atomic)
    trim()
  }

  func drop(path: String) {
    let dir = root.appendingPathComponent(digest(path), isDirectory: true)
    try? FileManager.default.removeItem(at: dir)
  }

  func dropAll() {
    try? FileManager.default.removeItem(at: root)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  }

  private func fileURL(path: String, offset: Int64) -> URL {
    root.appendingPathComponent(digest(path), isDirectory: true)
      .appendingPathComponent("\(offset).blk")
  }

  private func digest(_ path: String) -> String {
    SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func trim() {
    gate.lock()
    defer { gate.unlock() }
    let fm = FileManager.default
    guard let walker = fm.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else {
      return
    }
    var files: [(url: URL, size: Int64, at: Date)] = []
    var total: Int64 = 0
    while let url = walker.nextObject() as? URL {
      let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey])
      guard values?.isRegularFile == true else { continue }
      let size = Int64(values?.fileSize ?? 0)
      total += size
      files.append((url, size, values?.contentModificationDate ?? .distantPast))
    }
    guard total > maxBytes else { return }
    files.sort { $0.at < $1.at }
    for file in files {
      if total <= maxBytes { break }
      try? fm.removeItem(at: file.url)
      total -= file.size
    }
  }
}
