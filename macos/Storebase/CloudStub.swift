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
  static let legacyExt = "storebase"
  static let tagLabel = "Storebase"
  private static let openWithKey = "com.apple.LaunchServices.OpenWith"
  private static let userTagsKey = "com.apple.metadata:_kMDItemUserTags"
  private static let commentKey = "com.apple.metadata:kMDItemFinderComment"
  private static let whereFromKey = "com.apple.metadata:kMDItemWhereFroms"

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
  private static var hydrating: Set<String> = []
  private static var holdUntil: [String: Date] = [:]
  private static var selectionHolds: Set<String> = []
  private static var dragHolds: Set<String> = []

  static func meta(at url: URL) -> Meta? {
    if let fromXattr = readXattr(url) { return fromXattr }
    guard url.pathExtension.lowercased() == legacyExt else { return nil }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Meta.self, from: data)
  }

  static func isCloudFile(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == legacyExt || meta(at: url) != nil
  }

  static func isEvicted(_ url: URL, allocated: Int?) -> Bool {
    if url.pathExtension.lowercased() == legacyExt { return true }
    guard let meta = meta(at: url), meta.state == "evicted" else { return false }
    if let allocated, allocated > 8192 { return false }
    return true
  }

  static func isBusy(local path: String) -> Bool {
    gate.sync { sessions.contains { $0.stub.path == path } || hydrating.contains(path) }
  }

  static func hold(_ url: URL, seconds: TimeInterval = 90) {
    let path = url.standardizedFileURL.path
    gate.sync { holdUntil[path] = Date().addingTimeInterval(seconds) }
  }

  static func replaceSelection(_ paths: Set<String>) -> Set<String> {
    gate.sync {
      let gone = selectionHolds.subtracting(paths)
      selectionHolds = paths
      return gone
    }
  }

  static func replaceDrag(_ paths: Set<String>) -> Set<String> {
    gate.sync {
      let gone = dragHolds.subtracting(paths)
      dragHolds = paths
      return gone
    }
  }

  private static func isHeld(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    return gate.sync {
      if selectionHolds.contains(path) || dragHolds.contains(path) { return true }
      if let until = holdUntil[path], until > Date() { return true }
      holdUntil.removeValue(forKey: path)
      return false
    }
  }

  static func requestMaterialize(_ urls: [URL], unpinCopies: Bool = true) {
    for url in urls {
      guard isCloudFile(url) || hasStorebaseTag(url) || TrackedClouds.remote(forLocal: url.path) != nil else { continue }
      Task {
        do {
          let tracked = TrackedClouds.isTracked(local: url.path)
          _ = try await materialize(url, unpin: unpinCopies && !tracked)
          pinBack(url)
        } catch {
          // drag materialize is best-effort; open still shows a notification
        }
      }
    }
  }

  static func pinBack(paths: Set<String>, force: Bool = false) {
    for path in paths {
      pinBack(URL(fileURLWithPath: path), force: force)
    }
  }

  static func pinBack(_ url: URL, force: Bool = false) {
    let path = url.standardizedFileURL.path
    if isBusy(local: path) { return }
    if force {
      gate.sync {
        holdUntil.removeValue(forKey: path)
        dragHolds.remove(path)
      }
    } else if isHeld(url) {
      return
    }
    if isOpen(url) { return }
    guard FileManager.default.fileExists(atPath: path) else { return }
    let info = meta(at: url)
    let remote = info?.path ?? TrackedClouds.remote(forLocal: path) ?? ""
    guard !remote.isEmpty else { return }
    let allocated = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    if allocated <= 8192, info?.state == "evicted" { return }
    let size = info?.size ?? Int64(allocated)
    evict(url: url, remotePath: remote, size: size)
  }

  static func materialize(_ url: URL, unpin: Bool) async throws -> URL {
    let path = url.standardizedFileURL.path
    let claimed: Bool = gate.sync {
      if hydrating.contains(path) { return false }
      hydrating.insert(path)
      return true
    }
    if !claimed {
      for _ in 0 ..< 200 {
        try await Task.sleep(nanoseconds: 50_000_000)
        if gate.sync({ !hydrating.contains(path) }) { break }
      }
      return url
    }
    defer { gate.sync { hydrating.remove(path) } }

    var info = meta(at: url)
    if info == nil, let remote = TrackedClouds.remote(forLocal: url.path) ?? TrackedClouds.remoteMatchingName(url.lastPathComponent) {
      info = Meta(path: remote, size: 0, state: "evicted", name: url.lastPathComponent)
    }
    guard let info, !info.path.isEmpty else {
      throw APIError(status: 0, message: "Not a Storebase cloud copy", code: nil)
    }
    let existing = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    if info.state == "hydrated", existing > 8192 {
      if unpin { unpinCloud(url) }
      return url
    }

    let pair = await MainActor.run { () -> (URL, String, Int)? in
      guard let model = AppRuntime.model, model.paired, let base = URL(string: model.settings.nodeURL) else { return nil }
      return (base, model.settings.token, model.settings.limitBytesPerSecond(onWifi: model.onWifi))
    }
    guard let pair else {
      throw APIError(status: 0, message: "Storebase isn’t paired", code: nil)
    }
    let client = APIClient(baseURL: pair.0, token: pair.1)
    client.limitBytesPerSecond = pair.2
    let transferId = await MainActor.run {
      AppRuntime.model?.beginTransfer(name: url.lastPathComponent, total: info.size, uploading: false)
    }
    defer {
      if let transferId {
        Task { @MainActor in AppRuntime.model?.endTransfer(id: transferId) }
      }
    }
    try FileManager.default.createDirectory(at: cacheRoot(), withIntermediateDirectories: true)
    let tmp = cacheRoot().appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)")
    try await client.download(path: info.path, to: tmp) { done, total in
      if let transferId {
        Task { @MainActor in AppRuntime.model?.updateTransfer(id: transferId, done: done, total: total) }
      }
    }
    do {
      _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp, backupItemName: nil, options: [])
    } catch {
      try? FileManager.default.removeItem(at: url)
      try FileManager.default.moveItem(at: tmp, to: url)
    }
    if unpin {
      unpinCloud(url)
    } else {
      writeMeta(
        url,
        Meta(path: info.path, size: info.size, state: "hydrated", name: info.name ?? url.lastPathComponent)
      )
      bindOpener(url)
      applyFinderTag(url)
      applyComment(url)
    }
    let changed = url.path
    Task { @MainActor in
      NSWorkspace.shared.noteFileSystemChanged(changed)
    }
    return url
  }

  static func scanDroppedCopies() {
    let home = FileManager.default.homeDirectoryForCurrentUser
    let folders = [
      home.appendingPathComponent("Desktop"),
      home.appendingPathComponent("Downloads"),
      home.appendingPathComponent("Documents"),
      home.appendingPathComponent("Pictures"),
    ]
    let fm = FileManager.default
    var found: [URL] = []
    for folder in folders {
      guard let names = try? fm.contentsOfDirectory(atPath: folder.path) else { continue }
      for name in names {
        let url = folder.appendingPathComponent(name)
        let values = try? url.resourceValues(forKeys: [.creationDateKey, .contentModificationDateKey, .fileSizeKey])
        let stamp = values?.creationDate ?? values?.contentModificationDate
        guard let stamp, Date().timeIntervalSince(stamp) < 20 else { continue }
        if TrackedClouds.isTracked(local: url.path) { continue }
        let size = values?.fileSize ?? 0
        let tagged = hasStorebaseTag(url) || readXattr(url) != nil
        let named = TrackedClouds.remoteMatchingName(name) != nil
        if (tagged || named), size < 64 * 1024 {
          found.append(url)
        }
      }
    }
    if !found.isEmpty {
      requestMaterialize(found, unpinCopies: true)
    }
  }

  private static func unpinCloud(_ url: URL) {
    _ = url.path.withCString { pth in
      xattrName.withCString { key in
        removexattr(pth, key, 0)
      }
    }
    stripOpener(url)
    var tags = readStringListXattr(url, userTagsKey) ?? []
    tags.removeAll { tagBase($0).caseInsensitiveCompare(tagLabel) == .orderedSame }
    if tags.isEmpty {
      _ = url.path.withCString { pth in
        userTagsKey.withCString { key in
          removexattr(pth, key, 0)
        }
      }
    } else {
      writePlist(url, userTagsKey, tags)
    }
  }

  static func evict(url: URL, remotePath: String, size: Int64) {
    let display = displayName(url, remote: remotePath)
    let dest = canonicalURL(url, display: display)
    if dest.standardizedFileURL != url.standardizedFileURL {
      if FileManager.default.fileExists(atPath: dest.path) {
        if isCloudFile(dest) {
          try? FileManager.default.removeItem(at: url)
          finishStub(dest, remotePath: remotePath, size: size, display: display)
          return
        }
        return
      }
    }
    let payload = Meta(path: remotePath, size: size, state: "evicted", name: display)
    guard let data = try? JSONEncoder().encode(payload) else { return }
    do {
      try data.write(to: dest, options: .atomic)
    } catch {
      return
    }
    if dest.standardizedFileURL != url.standardizedFileURL {
      try? FileManager.default.removeItem(at: url)
    }
    finishStub(dest, remotePath: remotePath, size: size, display: display)
  }

  static func migrate(in folders: [URL]) {
    let fm = FileManager.default
    for folder in folders {
      guard let names = try? fm.contentsOfDirectory(atPath: folder.path) else { continue }
      for name in names {
        let url = folder.appendingPathComponent(name)
        if url.pathExtension.lowercased() == legacyExt {
          guard let info = meta(at: url), !info.path.isEmpty else { continue }
          evict(url: url, remotePath: info.path, size: info.size)
          continue
        }
        guard let info = readXattr(url), !info.path.isEmpty else { continue }
        if info.state == "hydrated" || isHeld(url) || isBusy(local: url.path) { continue }
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if bytes > 4096 {
          evict(url: url, remotePath: info.path, size: info.size)
        }
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
    guard AppRuntime.model?.paired == true else {
      gate.sync { pending.append(url) }
      Notifier.send(title: "Storebase isn’t paired", body: "Connect the Mac app, then open the file again.")
      return
    }
    let info = meta(at: url)
    let remote = info?.path ?? TrackedClouds.remote(forLocal: url.path) ?? ""
    guard !remote.isEmpty else {
      Notifier.send(title: "Not a Storebase cloud copy", body: url.lastPathComponent)
      return
    }
    do {
      let hydrated = try await materialize(url, unpin: false)
      let values = try? hydrated.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
      hold(hydrated)
      openInDefaultApp(hydrated)
      gate.sync {
        sessions.append(
          Session(
            stub: url,
            cache: hydrated,
            remote: remote,
            size: info?.size ?? Int64(values?.fileSize ?? 0),
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
        if isOpen(url) || isBusy(local: url.path) || isHeld(url) { continue }
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
        let wifi = await MainActor.run { AppRuntime.model?.onWifi ?? true }
        client.limitBytesPerSecond = await MainActor.run {
          AppRuntime.model?.settings.limitBytesPerSecond(onWifi: wifi) ?? 0
        }
        let transferId = await MainActor.run {
          AppRuntime.model?.beginTransfer(name: session.stub.lastPathComponent, total: size, uploading: true)
        }
        defer {
          if let transferId {
            Task { @MainActor in AppRuntime.model?.endTransfer(id: transferId) }
          }
        }
        _ = try await client.upload(fileURL: session.cache, destDir: dest) { done, total in
          if let transferId {
            Task { @MainActor in AppRuntime.model?.updateTransfer(id: transferId, done: done, total: total) }
          }
        }
      } catch {
        Notifier.send(title: "Couldn’t save back to Storebase", body: session.stub.lastPathComponent)
        return
      }
    }
    let inPlace = session.cache.standardizedFileURL == session.stub.standardizedFileURL
    if !inPlace {
      try? FileManager.default.removeItem(at: session.cache)
      try? FileManager.default.removeItem(at: session.cache.deletingLastPathComponent())
    }
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

  private static func canonicalURL(_ url: URL, display: String) -> URL {
    if url.pathExtension.lowercased() == legacyExt {
      return url.deletingLastPathComponent().appendingPathComponent(display)
    }
    return url
  }

  private static func displayName(_ url: URL, remote: String) -> String {
    if let named = meta(at: url)?.name, !named.isEmpty { return named }
    if url.pathExtension.lowercased() == legacyExt {
      let stripped = url.deletingPathExtension().lastPathComponent
      if !stripped.isEmpty { return stripped }
    }
    if !url.lastPathComponent.isEmpty { return url.lastPathComponent }
    return URL(fileURLWithPath: remote).lastPathComponent
  }

  private static func cacheName(_ url: URL, info: Meta, remote: String) -> String {
    var name = info.name ?? url.lastPathComponent
    if url.pathExtension.lowercased() == legacyExt {
      name = info.name ?? url.deletingPathExtension().lastPathComponent
    }
    if (name as NSString).pathExtension.isEmpty {
      let fileExt = (remote as NSString).pathExtension
      if !fileExt.isEmpty { name = "\(name).\(fileExt)" }
    }
    return name
  }

  private static func finishStub(_ url: URL, remotePath: String, size: Int64, display: String) {
    stampCloud(url, remotePath: remotePath, size: size, display: display)
    let path = url.path
    Task { @MainActor in
      NSWorkspace.shared.noteFileSystemChanged(path)
    }
  }

  static func hasStorebaseTag(_ url: URL) -> Bool {
    let tags = readStringListXattr(url, userTagsKey) ?? []
    if tags.contains(where: { tagBase($0).caseInsensitiveCompare(tagLabel) == .orderedSame }) {
      return true
    }
    if let comment = readPlistString(url, commentKey), comment.localizedCaseInsensitiveContains(tagLabel) {
      return true
    }
    return false
  }

  private static func stampCloud(_ url: URL, remotePath: String, size: Int64, display: String) {
    let payload = Meta(path: remotePath, size: size, state: "evicted", name: display)
    writeMeta(url, payload)
    bindOpener(url)
    applyFinderTag(url)
    applyComment(url)
    applyWhereFrom(url, remote: remotePath)
    showExt(url)
    TrackedClouds.remember(local: url.path, remote: remotePath)
  }

  private static func tagBase(_ raw: String) -> String {
    raw.split(separator: "\n").first.map(String.init) ?? raw
  }

  private static func applyFinderTag(_ url: URL) {
    var tags = readStringListXattr(url, userTagsKey) ?? []
    if tags.contains(where: { tagBase($0).caseInsensitiveCompare(tagLabel) == .orderedSame }) {
      return
    }
    tags.append(tagLabel)
    writePlist(url, userTagsKey, tags)
  }

  private static func applyComment(_ url: URL) {
    writePlist(url, commentKey, tagLabel)
  }

  private static func applyWhereFrom(_ url: URL, remote: String) {
    writePlist(url, whereFromKey, ["storebase://\(remote)", tagLabel])
  }

  private static func showExt(_ url: URL) {
    var file = url
    var values = URLResourceValues()
    values.hasHiddenExtension = false
    try? file.setResourceValues(values)
  }

  private static func appURL() -> URL {
    let installed = URL(fileURLWithPath: "/Applications/Storebase.app")
    if FileManager.default.fileExists(atPath: installed.path) { return installed }
    return Bundle.main.bundleURL
  }

  private static func bindOpener(_ url: URL) {
    let dict: [String: Any] = [
      "bundleid": Bundle.main.bundleIdentifier ?? "app.storebase.mac",
      "path": appURL().path,
      "skipcheck": true,
      "version": 0,
    ]
    guard let data = try? PropertyListSerialization.data(fromPropertyList: dict, format: .binary, options: 0) else { return }
    _ = url.path.withCString { pth in
      openWithKey.withCString { key in
        data.withUnsafeBytes { buf in
          setxattr(pth, key, buf.baseAddress, buf.count, 0, 0)
        }
      }
    }
    _ = url.path.withCString { pth in
      "com.apple.quarantine".withCString { key in
        removexattr(pth, key, 0)
      }
    }
  }

  private static func writePlist(_ url: URL, _ key: String, _ value: Any) {
    guard let data = try? PropertyListSerialization.data(fromPropertyList: value, format: .binary, options: 0) else { return }
    _ = url.path.withCString { pth in
      key.withCString { xkey in
        data.withUnsafeBytes { buf in
          setxattr(pth, xkey, buf.baseAddress, buf.count, 0, 0)
        }
      }
    }
  }

  private static func readStringListXattr(_ url: URL, _ key: String) -> [String]? {
    readPlist(url, key) as? [String]
  }

  private static func readPlistString(_ url: URL, _ key: String) -> String? {
    readPlist(url, key) as? String
  }

  private static func readPlist(_ url: URL, _ key: String) -> Any? {
    let needed = url.path.withCString { pth in
      key.withCString { xkey in
        getxattr(pth, xkey, nil, 0, 0, 0)
      }
    }
    guard needed > 0 else { return nil }
    var data = Data(count: Int(needed))
    let read = data.withUnsafeMutableBytes { raw in
      url.path.withCString { pth in
        key.withCString { xkey in
          getxattr(pth, xkey, raw.baseAddress, raw.count, 0, 0)
        }
      }
    }
    guard read > 0 else { return nil }
    return try? PropertyListSerialization.propertyList(from: Data(data.prefix(Int(read))), options: [], format: nil)
  }

  private static func isOpen(_ url: URL) -> Bool {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    proc.arguments = ["-t", "-n", "-P", "--", url.path]
    let out = Pipe()
    proc.standardOutput = out
    proc.standardError = FileHandle.nullDevice
    do {
      try proc.run()
    } catch {
      return true
    }
    let deadline = Date().addingTimeInterval(0.25)
    while proc.isRunning, Date() < deadline {
      Thread.sleep(forTimeInterval: 0.01)
    }
    if proc.isRunning {
      proc.terminate()
      return true
    }
    let raw = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let pids = raw.split(whereSeparator: \.isNewline).compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    if pids.isEmpty { return false }
    let ignore = Set(
      NSWorkspace.shared.runningApplications.compactMap { app -> Int? in
        let id = app.bundleIdentifier ?? ""
        if id == "com.apple.finder" || id == "app.storebase.mac" { return Int(app.processIdentifier) }
        if app.bundleURL?.lastPathComponent.caseInsensitiveCompare("Storebase.app") == .orderedSame {
          return Int(app.processIdentifier)
        }
        return nil
      }
    )
    return pids.contains { !ignore.contains($0) }
  }

  @MainActor
  private static func openInDefaultApp(_ url: URL) {
    stripOpener(url)
    let ours = Bundle.main.bundleIdentifier ?? "app.storebase.mac"
    let apps = NSWorkspace.shared.urlsForApplications(toOpen: url).filter { app in
      let id = Bundle(url: app)?.bundleIdentifier
      return id != ours && app.lastPathComponent.caseInsensitiveCompare("Storebase.app") != .orderedSame
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    if let chosen = apps.first {
      NSWorkspace.shared.open([url], withApplicationAt: chosen, configuration: config, completionHandler: nil)
      return
    }
    let preview = URL(fileURLWithPath: "/System/Applications/Preview.app")
    if FileManager.default.fileExists(atPath: preview.path) {
      NSWorkspace.shared.open([url], withApplicationAt: preview, configuration: config, completionHandler: nil)
    }
  }

  private static func stripOpener(_ url: URL) {
    _ = url.path.withCString { pth in
      openWithKey.withCString { key in
        removexattr(pth, key, 0)
      }
    }
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
  private static var lastIndexAt: TimeInterval = 0

  struct Item: Codable, Equatable {
    var local: String
    var remote: String
  }

  static func remember(local: String, remote: String) {
    gate.sync {
      var items = loadLocked()
      items.removeAll { $0.local == local || $0.remote == remote }
      items.append(Item(local: local, remote: remote))
      saveLocked(items)
    }
  }

  static func remote(forLocal path: String) -> String? {
    gate.sync { loadLocked().first { $0.local == path }?.remote }
  }

  static func isTracked(local path: String) -> Bool {
    gate.sync { loadLocked().contains { $0.local == path } }
  }

  static func remoteMatchingName(_ name: String) -> String? {
    gate.sync {
      loadLocked().reversed().first { URL(fileURLWithPath: $0.local).lastPathComponent == name }?.remote
    }
  }

  static func reconcile(base: URL, token: String, folders: [URL], mirrorLocal: Bool) async {
    let snapshot: [Item]? = gate.sync {
      if reconciling { return nil }
      reconciling = true
      return loadLocked()
    }
    guard let snapshot else { return }
    let client = APIClient(baseURL: base, token: token)
    var live: Set<String>?
    let pullIndex: Bool = gate.sync {
      let now = Date().timeIntervalSince1970
      if now - lastIndexAt < 3 { return false }
      lastIndexAt = now
      return true
    }
    if pullIndex {
      live = try? await client.livePaths()
      if live == nil {
        gate.sync { lastIndexAt = 0 }
      }
    }
    var keep: [Item] = []
    var dropped = Set<String>()
    for item in snapshot {
      if CloudStub.isBusy(local: item.local) {
        keep.append(item)
        continue
      }
      let localURL = URL(fileURLWithPath: item.local)
      if FileManager.default.fileExists(atPath: item.local) {
        if let live, !live.contains(item.remote) {
          try? FileManager.default.removeItem(at: localURL)
          dropped.insert(item.remote)
          continue
        }
        keep.append(item)
        continue
      }
      if let moved = locate(remote: item.remote, folders: folders) {
        if let live, !live.contains(item.remote) {
          try? FileManager.default.removeItem(at: moved)
          dropped.insert(item.remote)
          continue
        }
        keep.append(Item(local: moved.path, remote: item.remote))
        continue
      }
      if let live, !live.contains(item.remote) {
        dropped.insert(item.remote)
        continue
      }
      guard mirrorLocal else { continue }
      do {
        try await client.trash(item.remote)
      } catch let err as APIError where err.status == 404 {
        continue
      } catch let err as APIError where err.status == 409 {
        Notifier.send(
          title: "Couldn’t remove from Storebase",
          body: "\(URL(fileURLWithPath: item.local).lastPathComponent) is over 20 GB — delete it on the site."
        )
        keep.append(item)
      } catch {
        keep.append(item)
      }
    }
    if let live {
      for folder in folders {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { continue }
        for name in names {
          let url = folder.appendingPathComponent(name)
          guard CloudStub.isCloudFile(url), let remote = CloudStub.meta(at: url)?.path, !remote.isEmpty else { continue }
          if live.contains(remote) || CloudStub.isBusy(local: url.path) { continue }
          try? FileManager.default.removeItem(at: url)
          dropped.insert(remote)
        }
      }
    }
    gate.sync {
      let extra = loadLocked().filter { liveItem in
        !snapshot.contains(where: { $0.local == liveItem.local }) && !dropped.contains(liveItem.remote)
      }
      saveLocked(keep.filter { !dropped.contains($0.remote) } + extra)
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

enum StubAccess {
  private static let gate = Gate()
  private static var started = false
  private static var timer: DispatchSourceTimer?
  private static var monitors: [Any] = []

  static func start() {
    let already = gate.sync { () -> Bool in
      if started { return true }
      started = true
      return false
    }
    guard !already else { return }
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "app.storebase.access"))
    timer.schedule(deadline: .now() + 0.35, repeating: 0.35, leeway: .milliseconds(80))
    timer.setEventHandler {
      CloudStub.scanDroppedCopies()
      DispatchQueue.main.async {
        pollDrag()
        pollFinderSelection()
      }
    }
    timer.resume()
    self.timer = timer
    DispatchQueue.main.async { installMonitors() }
  }

  private static func installMonitors() {
    let ping: (NSEvent) -> Void = { _ in
      pollDrag()
      pollFinderSelection()
    }
    if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged], handler: ping) {
      monitors.append(monitor)
    }
    if let monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged], handler: { event in
      ping(event)
      return event
    }) {
      monitors.append(monitor)
    }
  }

  private static func pollDrag() {
    let pasteboard = NSPasteboard(name: .drag)
    var urls: [URL] = []
    if let names = pasteboard.propertyList(forType: NSPasteboard.PasteboardType("NSFilenamesPboardType")) as? [String] {
      urls.append(contentsOf: names.map { URL(fileURLWithPath: $0) })
    }
    if let items = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] {
      urls.append(contentsOf: items)
    }
    let paths = Set(urls.map { $0.standardizedFileURL.path })
    let gone = CloudStub.replaceDrag(paths)
    if !urls.isEmpty {
      CloudStub.requestMaterialize(urls)
    }
    CloudStub.pinBack(paths: gone)
  }

  private static func pollFinderSelection() {
    guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.finder" else { return }
    DispatchQueue.global(qos: .userInitiated).async {
      let source = """
      tell application "Finder"
        try
          set sel to (get selection)
          set out to ""
          repeat with f in sel
            try
              set out to out & POSIX path of (f as alias) & linefeed
            end try
          end repeat
          return out
        on error
          return "__sb_sel_error__"
        end try
      end tell
      """
      var err: NSDictionary?
      guard let script = NSAppleScript(source: source) else { return }
      let result = script.executeAndReturnError(&err)
      guard err == nil, let text = result.stringValue, text != "__sb_sel_error__" else { return }
      let urls = text
        .split(whereSeparator: \.isNewline)
        .map { URL(fileURLWithPath: String($0)) }
      let paths = Set(urls.map { $0.standardizedFileURL.path })
      let gone = CloudStub.replaceSelection(paths)
      if !urls.isEmpty {
        CloudStub.requestMaterialize(urls, unpinCopies: false)
      }
      CloudStub.pinBack(paths: gone, force: true)
    }
  }
}

@MainActor
enum AppRuntime {
  static weak var model: AppModel?
}
