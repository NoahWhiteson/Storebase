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

  private struct Session {
    var stub: URL
    var cache: URL
    var remote: String
    var size: Int64
    var snapshotSize: Int64
    var snapshotMtime: Date?
    var quietTicks: Int
  }

  private static let lock = NSLock()
  private static var sessions: [Session] = []
  private static var sweeping = false

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
      let info = meta(at: url)
      let remote = info?.path
      let size = info?.size ?? Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
      guard let remote, !remote.isEmpty else { continue }
      if info?.state == "hydrated" {
        NSWorkspace.shared.open(url)
        continue
      }
      do {
        try FileManager.default.createDirectory(at: cacheRoot(), withIntermediateDirectories: true)
        let cache = cacheRoot().appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)")
        try await client.download(path: remote, to: cache)
        let values = try? cache.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        NSWorkspace.shared.open(cache)
        lock.lock()
        sessions.append(
          Session(
            stub: url,
            cache: cache,
            remote: remote,
            size: size,
            snapshotSize: Int64(values?.fileSize ?? 0),
            snapshotMtime: values?.contentModificationDate,
            quietTicks: 0
          )
        )
        lock.unlock()
      } catch {
        Notifier.send(title: "Couldn’t open from Storebase", body: "\(url.lastPathComponent): \(error.localizedDescription)")
      }
    }
  }

  static func sweep(base: URL, token: String) async {
    lock.lock()
    if sweeping {
      lock.unlock()
      return
    }
    sweeping = true
    let current = sessions
    lock.unlock()
    guard !current.isEmpty else {
      lock.lock()
      sweeping = false
      lock.unlock()
      return
    }
    let client = APIClient(baseURL: base, token: token)
    var keep: [Session] = []
    for session in current {
      if isOpen(session.cache) {
        var next = session
        next.quietTicks = 0
        keep.append(next)
        continue
      }
      var next = session
      next.quietTicks += 1
      if next.quietTicks < 2 {
        keep.append(next)
        continue
      }
      await close(session, client: client)
    }
    lock.lock()
    let extra = sessions.filter { live in !current.contains(where: { $0.cache.path == live.cache.path }) }
    sessions = keep + extra
    sweeping = false
    lock.unlock()
  }

  static func reclaimHydrated(in folders: [URL]) {
    let fm = FileManager.default
    for folder in folders {
      guard let names = try? fm.contentsOfDirectory(atPath: folder.path) else { continue }
      for name in names {
        let url = folder.appendingPathComponent(name)
        guard let info = meta(at: url), info.state == "hydrated" else { continue }
        if isOpen(url) { continue }
        evict(url: url, remotePath: info.path, size: info.size)
      }
    }
  }

  private static func close(_ session: Session, client: APIClient) async {
    let values = try? session.cache.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
    let size = Int64(values?.fileSize ?? 0)
    let mtime = values?.contentModificationDate
    let dirty =
      size != session.snapshotSize ||
      (mtime != nil && session.snapshotMtime != nil && mtime! > session.snapshotMtime!.addingTimeInterval(1))
    if dirty {
      let dest = parentPath(session.remote)
      do {
        _ = try await client.upload(fileURL: session.cache, destDir: dest)
      } catch {
        Notifier.send(title: "Couldn’t save back to Storebase", body: session.stub.lastPathComponent)
        return
      }
    }
    try? FileManager.default.removeItem(at: session.cache)
    if FileManager.default.fileExists(atPath: session.stub.path) {
      evict(url: session.stub, remotePath: session.remote, size: dirty ? size : session.size)
    }
  }

  private static func parentPath(_ remote: String) -> String {
    guard let slash = remote.lastIndex(of: "/") else { return "" }
    return String(remote[..<slash])
  }

  private static func cacheRoot() -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("app.storebase.mac/open", isDirectory: true)
  }

  private static func isOpen(_ url: URL) -> Bool {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    proc.arguments = ["-t", "--", url.path]
    let out = Pipe()
    proc.standardOutput = out
    proc.standardError = Pipe()
    do {
      try proc.run()
      proc.waitUntilExit()
      return !(out.fileHandleForReading.readDataToEndOfFile().isEmpty)
    } catch {
      return true
    }
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
