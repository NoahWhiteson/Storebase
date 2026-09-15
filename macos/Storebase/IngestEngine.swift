import AppKit
import Foundation

final class IngestEngine: @unchecked Sendable {
  private let store: SettingsStore
  private let queue = DispatchQueue(label: "app.storebase.ingest")
  private var timer: DispatchSourceTimer?
  private var seen: Set<String>
  private var inflight = 0
  private var lastQuotaWarnBucket = 0
  private var ticking = false
  private var lastMigrate = Date.distantPast
  var onStatus: ((String) -> Void)?
  var onStorage: ((StatusResponse) -> Void)?
  var onQuotaFull: (() -> Void)?

  init(store: SettingsStore) {
    self.store = store
    self.seen = Set(store.settings.lastFingerprint)
  }

  func start() {
    stop()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 2.5, repeating: 2.5, leeway: .milliseconds(500))
    timer.setEventHandler { [weak self] in
      self?.tick()
    }
    timer.resume()
    self.timer = timer
  }

  func stop() {
    timer?.setEventHandler {}
    timer?.cancel()
    timer = nil
  }

  private func tick() {
    if ticking { return }
    ticking = true
    defer { ticking = false }
    let settings = store.settings
    guard !settings.token.isEmpty, let base = URL(string: settings.nodeURL) else { return }
    let folders = watchFolders(settings)
    if settings.usesPlaceholders, Date().timeIntervalSince(lastMigrate) > 30 {
      lastMigrate = Date()
      CloudStub.migrate(in: folders)
      CloudStub.reclaimHydrated(in: folders)
    }
    if settings.usesPlaceholders {
      Task { await CloudStub.sweep(base: base, token: settings.token) }
    }
    Task {
      await TrackedClouds.reconcile(
        base: base,
        token: settings.token,
        folders: folders,
        mirrorLocal: settings.usesMirrorDeletes
      )
    }
    guard settings.captureEnabled else { return }
    refreshStatus(base: base, token: settings.token, settings: settings)
    guard inflight < max(1, settings.maxConcurrent) else { return }
    for folder in folders {
      ingestFolder(folder, settings: settings, base: base)
    }
  }

  private func refreshStatus(base: URL, token: String, settings: AppSettings) {
    Task {
      do {
        let client = APIClient(baseURL: base, token: token)
        let status = try await client.status()
        await MainActor.run {
          self.onStorage?(status)
          let cap = status.quotaBytes ?? status.reservedBytes
          guard cap > 0 else { return }
          let pct = Int((Double(status.usedBytes) / Double(cap)) * 100)
          if status.availableBytes <= 0 {
            if settings.notifyQuota { Notifier.quotaFull(file: "new files") }
            if settings.pauseWhenFull {
              self.store.settings.captureEnabled = false
              self.onQuotaFull?()
            }
          } else if settings.notifyQuota, pct >= Int(settings.quotaWarnPercent) {
            let bucket = pct / 5
            if bucket != self.lastQuotaWarnBucket {
              self.lastQuotaWarnBucket = bucket
              Notifier.quotaWarn(percent: pct)
            }
          }
        }
      } catch {
        // status poll is quiet
      }
    }
  }

  private func ingestFolder(_ folder: URL, settings: AppSettings, base: URL) {
    let fm = FileManager.default
    guard let names = try? fm.contentsOfDirectory(atPath: folder.path) else { return }
    for name in names {
      let url = folder.appendingPathComponent(name)
      consider(url, settings: settings, base: base)
    }
  }

  private func consider(_ url: URL, settings: AppSettings, base: URL) {
    let name = url.lastPathComponent
    if settings.skipHidden, name.hasPrefix(".") { return }
    if !settings.captureScreenshots, name.hasPrefix("Screen Recording") || name.hasPrefix("Screenshot") { return }
    if settings.skipIncomplete, Self.incomplete(name) { return }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else { return }
    guard let info = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .totalFileAllocatedSizeKey]) else { return }
    let size = Int64(info.fileSize ?? 0)
    let allocated = info.totalFileAllocatedSize
    if CloudStub.isCloudFile(url) { return }
    if CloudStub.isEvicted(url, allocated: allocated) { return }
    guard size > 0 else { return }
    if let modified = info.contentModificationDate, Date().timeIntervalSince(modified) < settings.settleSeconds { return }
    let fingerprint = "\(url.path)|\(size)|\(info.contentModificationDate?.timeIntervalSince1970 ?? 0)"
    if seen.contains(fingerprint) { return }
    guard inflight < max(1, settings.maxConcurrent) else { return }
    seen.insert(fingerprint)
    persistSeen()
    inflight += 1
    let dest = destination(for: url, size: size, settings: settings)
    Task.detached { [self] in
      defer { self.queue.async { self.inflight -= 1 } }
      let transferId = await MainActor.run {
        AppRuntime.model?.beginTransfer(name: name, total: size, uploading: true)
      }
      defer {
        if let transferId {
          Task { @MainActor in AppRuntime.model?.endTransfer(id: transferId) }
        }
      }
      do {
        let client = APIClient(baseURL: base, token: settings.token)
        let wifi = await MainActor.run { AppRuntime.model?.onWifi ?? true }
        client.limitBytesPerSecond = settings.limitBytesPerSecond(onWifi: wifi)
        if dest != ".temp", !settings.destFolder.isEmpty {
          try? await client.mkdir(settings.destFolder)
        }
        let remote = try await client.upload(fileURL: url, destDir: dest) { done, total in
          if let transferId {
            Task { @MainActor in AppRuntime.model?.updateTransfer(id: transferId, done: done, total: total) }
          }
        }
        await MainActor.run {
          self.onStatus?("Captured \(name)")
          if settings.notifyUploads {
            Notifier.send(title: "Saved to Storebase", body: name)
          }
        }
        self.afterUpload(url, remotePath: remote, size: size, settings: settings)
      } catch let err as APIError where err.isQuota {
        self.queue.async {
          self.seen.remove(fingerprint)
          self.persistSeen()
        }
        await MainActor.run {
          if settings.notifyQuota { Notifier.quotaFull(file: name) }
          if settings.pauseWhenFull { self.store.settings.captureEnabled = false }
          self.onQuotaFull?()
        }
      } catch {
        self.queue.async {
          self.seen.remove(fingerprint)
          self.persistSeen()
        }
        await MainActor.run {
          if settings.notifyErrors {
            Notifier.send(title: "Storebase couldn’t capture a file", body: "\(name): \(error.localizedDescription)")
          }
        }
      }
    }
  }

  private func destination(for url: URL, size: Int64, settings: AppSettings) -> String {
    let ext = url.pathExtension.lowercased()
    if settings.neverTempSet().contains(ext) {
      return settings.destFolder
    }
    var toTemp = settings.defaultDestination == .temp
    if settings.tempExtSet().contains(ext) { toTemp = true }
    if settings.largeFilesToTempMB > 0, Double(size) >= settings.largeFilesToTempMB * 1_000_000 {
      toTemp = true
    }
    return toTemp ? ".temp" : settings.destFolder
  }

  private func afterUpload(_ url: URL, remotePath: String, size: Int64, settings: AppSettings) {
    if settings.usesPlaceholders {
      CloudStub.evict(url: url, remotePath: remotePath, size: size)
      return
    }
    if !settings.removeLocalAfterUpload {
      TrackedClouds.remember(local: url.path, remote: remotePath)
    }
    removeLocal(url, settings: settings)
  }

  private func removeLocal(_ url: URL, settings: AppSettings) {
    guard settings.removeLocalAfterUpload else { return }
    if settings.trashInsteadOfDelete {
      let target = url
      Task { @MainActor in
        NSWorkspace.shared.recycle([target], completionHandler: nil)
      }
    } else {
      try? FileManager.default.removeItem(at: url)
    }
  }

  private func watchFolders(_ settings: AppSettings) -> [URL] {
    var urls: [URL] = []
    let home = FileManager.default.homeDirectoryForCurrentUser
    if settings.watchDownloads { urls.append(home.appendingPathComponent("Downloads")) }
    if settings.watchDesktop { urls.append(home.appendingPathComponent("Desktop")) }
    if settings.watchDocuments { urls.append(home.appendingPathComponent("Documents")) }
    urls.append(contentsOf: settings.customFolders.map { URL(fileURLWithPath: $0) })
    return urls.filter { FileManager.default.fileExists(atPath: $0.path) }
  }

  private func persistSeen() {
    let trimmed = Array(seen.suffix(4000))
    seen = Set(trimmed)
    let fingerprints = trimmed
    DispatchQueue.main.async {
      self.store.settings.lastFingerprint = fingerprints
    }
  }

  private static func incomplete(_ name: String) -> Bool {
    let lower = name.lowercased()
    let suffixes = [".crdownload", ".download", ".part", ".partial", ".tmp", ".aria2", ".osdownload", ".!ut", ".bc!"]
    return suffixes.contains { lower.hasSuffix($0) } || lower.hasSuffix(".part.nzb")
  }
}
