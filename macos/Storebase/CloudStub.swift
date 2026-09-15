import AppKit
import Darwin
import Foundation

enum CloudStub {
  static let xattrName = "app.storebase.placeholder"

  struct Meta: Codable {
    var path: String
    var size: Int64
    var state: String
  }

  static func meta(at url: URL) -> Meta? {
    let path = url.path
    let needed = path.withCString { pth in
      xattrName.withCString { key in
        getxattr(pth, key, nil, 0, 0, 0)
      }
    }
    guard needed > 0 else { return nil }
    var data = Data(count: Int(needed))
    let read = data.withUnsafeMutableBytes { raw in
      path.withCString { pth in
        xattrName.withCString { key in
          getxattr(pth, key, raw.baseAddress, raw.count, 0, 0)
        }
      }
    }
    guard read > 0 else { return nil }
    return try? JSONDecoder().decode(Meta.self, from: data.prefix(Int(read)))
  }

  static func isEvicted(_ url: URL, allocated: Int?) -> Bool {
    guard let meta = meta(at: url), meta.state == "evicted" else { return false }
    if let allocated, allocated > 8192 { return false }
    return true
  }

  static func evict(url: URL, remotePath: String, size: Int64) {
    makeSparse(url, size: size)
    writeMeta(url, Meta(path: remotePath, size: size, state: "evicted"))
    setOpenWith(url)
  }

  @MainActor
  static func open(urls: [URL]) async {
    guard let model = AppRuntime.model, model.paired, let base = URL(string: model.settings.nodeURL) else { return }
    let client = APIClient(baseURL: base, token: model.settings.token)
    for url in urls {
      guard meta(at: url)?.state == "evicted" else { continue }
      do {
        try await hydrate(url, client: client)
        NSWorkspace.shared.open(url)
      } catch {
        Notifier.send(title: "Couldn’t download from Storebase", body: "\(url.lastPathComponent): \(error.localizedDescription)")
      }
    }
  }

  private static func hydrate(_ url: URL, client: APIClient) async throws {
    guard let info = meta(at: url) else { return }
    let tmp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).storebase-tmp")
    try await client.download(path: info.path, to: tmp)
    _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
    writeMeta(url, Meta(path: info.path, size: info.size, state: "hydrated"))
    removexattr(url.path, "com.apple.LaunchServices.OpenWith", 0)
  }

  private static func writeMeta(_ url: URL, _ meta: Meta) {
    guard let data = try? JSONEncoder().encode(meta) else { return }
    _ = url.path.withCString { pth in
      xattrName.withCString { key in
        data.withUnsafeBytes { buf in
          setxattr(pth, key, buf.baseAddress, buf.count, 0, 0)
        }
      }
    }
  }

  private static func makeSparse(_ url: URL, size: Int64) {
    let fd = Darwin.open(url.path, O_RDWR)
    guard fd >= 0 else { return }
    defer { Darwin.close(fd) }
    _ = ftruncate(fd, 0)
    _ = ftruncate(fd, off_t(size))
  }

  private static func setOpenWith(_ url: URL) {
    let payload: [String: Any] = [
      "bundleid": Bundle.main.bundleIdentifier ?? "app.storebase.mac",
      "path": Bundle.main.bundlePath,
      "version": Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0,
    ]
    guard let data = try? PropertyListSerialization.data(fromPropertyList: payload, format: .binary, options: 0) else { return }
    _ = url.path.withCString { pth in
      "com.apple.LaunchServices.OpenWith".withCString { key in
        data.withUnsafeBytes { buf in
          setxattr(pth, key, buf.baseAddress, buf.count, 0, 0)
        }
      }
    }
  }
}

@MainActor
enum AppRuntime {
  static weak var model: AppModel?
}
