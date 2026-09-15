import AppKit
import Darwin
import Foundation

private final class Gate: @unchecked Sendable {
  private let mutex = NSLock()
  func sync<T>(_ body: () -> T) -> T {
    mutex.lock()
    defer { mutex.unlock() }
    return body()
  }
}

enum CloudStub {
  static let xattrName = "app.storebase.placeholder"
  static let ext = "storebase"

  struct Meta: Codable {
    var path: String
    var size: Int64
    var state: String
    var name: String?
  }

  private struct Session: Sendable {
    var stub: URL
    var cache: URL
    var remote: String
    var size: Int64
    var snapshotSize: Int64
    var snapshotMtime: Date?
    var quietTicks: Int
  }

  private static let gate = Gate()
  private static var sessions: [Session] = []
  private static var sweeping = false
  private static var pending: [URL] = []

  static func meta(at url: URL) -> Meta? {
    if let fromXattr = readXattr(url) { return fromXattr }
    guard url.pathExtension.lowercased() == ext else { return nil }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Meta.self, from: data)
  }

  static func isCloudFile(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == ext || meta(at: url) != nil
  }

  static func isEvicted(_ url: URL, allocated: Int?) -> Bool {
    if url.pathExtension.lowercased() == ext { return true }
    guard let meta = meta(at: url), meta.state == "evicted" else { return false }
    if let allocated, allocated > 8192 { return false }
    return true
  }

  static func isBusy(local path: String) -> Bool {
    gate.sync { sessions.contains { $0.stub.path == path } }
  }

  static func evict(url: URL, remotePath: String, size: Int64) {
    let display = displayName(url, remote: remotePath)
    let dest = placeholderURL(url)
    let payload = Meta(path: remotePath, size: size, state: "evicted", name: display)
    guard let data = try? JSONEncoder().encode(payload) else { return }
    if dest.standardizedFileURL != url.standardizedFileURL, FileManager.default.fileExists(atPath: dest.path) {
      try? FileManager.default.removeItem(at: dest)
    }
    do {
      try data.write(to: dest, options: .atomic)
    } catch {
      return
    }
    writeMeta(dest, payload)
    hideExt(dest)
    if dest.standardizedFileURL != url.standardizedFileURL {
      try? FileManager.default.removeItem(at: url)
    }
    Task { @MainActor in
      if let icon = NSImage(named: "AppIcon") ?? NSApp.applicationIconImage {
        NSWorkspace.shared.setIcon(icon, forFile: dest.path, options: [])
      }
    }
    TrackedClouds.remember(local: dest.path, remote: remotePath)
  }

  static func migrate(in folders: [URL]) {
    let fm = FileManager.default
    for folder in folders {
      guard let names = try? fm.contentsOfDirectory(atPath: folder.path) else { continue }
      for name in names {
        let url = folder.appendingPathComponent(name)
        if url.pathExtension.lowercased() == ext {
          hideExt(url)
          continue
        }
        guard let info = meta(at: url) else { continue }
        evict(url: url, remotePath: info.path, size: info.size)
      }
    }
  }

  static func enqueue(_ urls: [URL]) {
    Task { @MainActor in
      if AppRuntime.model?.paired == true {
        await open(urls: urls)
        return
      }
      gate.sync { pending.append(contentsOf: urls) }
    }
  }

  @MainActor
  static func flushPending() async {
    let urls = gate.sync { () -> [URL] in
      let copy = pending
      pending = []
      return copy
    }
    guard !urls.isEmpty else { return }
    await open(urls: urls)
  }

  @MainActor
  static func open(urls: [URL]) async {
    for url in urls {
      if url.standardizedFileURL.path.hasPrefix(cacheRoot().path) {
        openInDefaultApp(url)
        continue
      }
      await openOne(url)
    }
  }

  @MainActor
  private static func openOne(_ url: URL) async {
    guard let model = AppRuntime.model, model.paired, let base = URL(string: model.settings.nodeURL) else {
      gate.sync { pending.append(url) }
      Notifier.send(title: "Storebase isn’t paired", body: "Connect the Mac app, then open the file again.")
      return
    }
    guard let info = meta(at: url), !info.path.isEmpty else {
      Notifier.send(title: "Not a Storebase cloud copy", body: url.lastPathComponent)
      return
    }
    let remote = info.path
    let size = info.size
    let client = APIClient(baseURL: base, token: model.settings.token)
    do {
      try FileManager.default.createDirectory(at: cacheRoot(), withIntermediateDirectories: true)
      let dir = cacheRoot().appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      var name = info.name ?? url.deletingPathExtension().lastPathComponent
      if (name as NSString).pathExtension.isEmpty {
        let fileExt = (remote as NSString).pathExtension
        if !fileExt.isEmpty { name = "\(name).\(fileExt)" }
      }
      let cache = dir.appendingPathComponent(name)
      try await client.download(path: remote, to: cache)
      let values = try? cache.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
      openInDefaultApp(cache)
      gate.sync {
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
      }
    } catch {
      Notifier.send(title: "Couldn’t open from Storebase", body: "\(displayName(url, remote: remote)): \(error.localizedDescription)")
    }
  }

  static func sweep(base: URL, token: String) async {
    let current: [Session] = gate.sync {
      if sweeping { return [] }
      sweeping = true
      if sessions.isEmpty {
        sweeping = false
        return []
      }
      return sessions
    }
    guard !current.isEmpty else { return }
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
    gate.sync {
      let extra = sessions.filter { live in !current.contains(where: { $0.cache.path == live.cache.path }) }
      sessions = keep + extra
      sweeping = false
    }
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
    if !FileManager.default.fileExists(atPath: session.stub.path) {
      try? FileManager.default.removeItem(at: session.cache)
      try? FileManager.default.removeItem(at: session.cache.deletingLastPathComponent())
      return
    }
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
    try? FileManager.default.removeItem(at: session.cache.deletingLastPathComponent())
    if FileManager.default.fileExists(atPath: session.stub.path) {
      evict(url: session.stub, remotePath: session.remote, size: dirty ? size : session.size)
    }
  }

  private static func parentPath(_ remote: String) -> String {
    guard let slash = remote.lastIndex(of: "/") else { return "" }
    return String(remote[..<slash])
  }

  static func cacheRoot() -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("app.storebase.mac/open", isDirectory: true)
  }

  private static func placeholderURL(_ url: URL) -> URL {
    url.pathExtension.lowercased() == ext ? url : url.appendingPathExtension(ext)
  }

  private static func displayName(_ url: URL, remote: String) -> String {
    if url.pathExtension.lowercased() == ext {
      return url.deletingPathExtension().lastPathComponent
    }
    if !url.lastPathComponent.isEmpty { return url.lastPathComponent }
    return URL(fileURLWithPath: remote).lastPathComponent
  }

  private static func hideExt(_ url: URL) {
    var file = url
    var values = URLResourceValues()
    values.hasHiddenExtension = true
    try? file.setResourceValues(values)
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

  private static func openInDefaultApp(_ url: URL) {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    proc.arguments = [url.path]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    try? proc.run()
  }

  private static func readXattr(_ url: URL) -> Meta? {
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
}

enum TrackedClouds {
  private static let gate = Gate()
  private static var reconciling = false

  struct Item: Codable, Equatable {
    var local: String
    var remote: String
  }

  static func remember(local: String, remote: String) {
    gate.sync {
      var items = loadLocked()
      items.removeAll { $0.local == local }
      items.append(Item(local: local, remote: remote))
      saveLocked(items)
    }
  }

  static func reconcile(base: URL, token: String, folders: [URL]) async {
    let snapshot: [Item]? = gate.sync {
      if reconciling { return nil }
      reconciling = true
      return loadLocked()
    }
    guard let snapshot else { return }
    let client = APIClient(baseURL: base, token: token)
    var keep: [Item] = []
    for item in snapshot {
      if CloudStub.isBusy(local: item.local) {
        keep.append(item)
        continue
      }
      if FileManager.default.fileExists(atPath: item.local) {
        keep.append(item)
        continue
      }
      if let moved = locate(remote: item.remote, folders: folders) {
        keep.append(Item(local: moved.path, remote: item.remote))
        continue
      }
      do {
        try await client.trash(item.remote)
      } catch let err as APIError where err.status == 404 {
        continue
      } catch let err as APIError where err.status == 409 {
        Notifier.send(
          title: "Couldn’t remove from Storebase",
          body: "\(URL(fileURLWithPath: item.local).lastPathComponent) is over 20 GB — delete it on the site."
        )
      } catch {
        keep.append(item)
      }
    }
    gate.sync {
      let extra = loadLocked().filter { live in !snapshot.contains(where: { $0.local == live.local }) }
      saveLocked(keep + extra)
      reconciling = false
    }
  }

  private static func locate(remote: String, folders: [URL]) -> URL? {
    for folder in folders {
      guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { continue }
      for name in names {
        let url = folder.appendingPathComponent(name)
        if CloudStub.meta(at: url)?.path == remote { return url }
      }
    }
    return nil
  }

  private static func fileURL() -> URL {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("app.storebase.mac", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("tracked-cloud.json")
  }

  private static func loadLocked() -> [Item] {
    guard let data = try? Data(contentsOf: fileURL()) else { return [] }
    return (try? JSONDecoder().decode([Item].self, from: data)) ?? []
  }

  private static func saveLocked(_ items: [Item]) {
    guard let data = try? JSONEncoder().encode(items) else { return }
    try? data.write(to: fileURL(), options: .atomic)
  }
}

@MainActor
enum AppRuntime {
  static weak var model: AppModel?
}
