import Foundation
import AppKit

final class IngestEngine: @unchecked Sendable {
  private let store: SettingsStore
  private var timer: Timer?
  private var seen: Set<String>
  private var inflight = 0
  private var lastQuotaWarnBucket = 0
  var onStatus: ((String) -> Void)?
  var onStorage: ((StatusResponse) -> Void)?
  var onQuotaFull: (() -> Void)?

  init(store: SettingsStore) {
    self.store = store
    self.seen = Set(store.settings.lastFingerprint)
  }

  func start() {
    stop()
    timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
      self?.tick()
    }
    timer?.tolerance = 0.4
    if let timer { RunLoop.main.add(timer, forMode: .common) }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  func tick() {
    let settings = store.settings
    guard !settings.token.isEmpty, let base = URL(string: settings.nodeURL) else { return }
    let folders = watchFolders(settings)
    if settings.usesPlaceholders {
      CloudStub.migrate(in: folders)
      CloudStub.reclaimHydrated(in: folders)
      Task { await CloudStub.sweep(base: base, token: settings.token) }
    }
    if settings.usesMirrorDeletes {
      Task { await TrackedClouds.reconcile(base: base, token: settings.token, folders: folders) }
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
    guard let info = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .fileResourceIdentifierKey, .totalFileAllocatedSizeKey]) else { return }
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
    Task {
      defer { Task { @MainActor in self.inflight -= 1 } }
      do {
        let client = APIClient(baseURL: base, token: settings.token)
        if dest != ".temp", !settings.destFolder.isEmpty {
          try? await client.mkdir(settings.destFolder)
        }
        let remote = try await client.upload(fileURL: url, destDir: dest)
        await MainActor.run {
          self.onStatus?("Captured \(name)")
          if settings.notifyUploads {
            Notifier.send(title: "Saved to Storebase", body: name)
          }
        }
        self.afterUpload(url, remotePath: remote, size: size, settings: settings)
      } catch let err as APIError where err.isQuota {
        await MainActor.run {
          if settings.notifyQuota { Notifier.quotaFull(file: name) }
          if settings.pauseWhenFull { self.store.settings.captureEnabled = false }
          self.onQuotaFull?()
          self.seen.remove(fingerprint)
          self.persistSeen()
        }
      } catch {
        await MainActor.run {
          if settings.notifyErrors {
            Notifier.send(title: "Storebase couldn’t capture a file", body: "\(name): \(error.localizedDescription)")
          }
          self.seen.remove(fingerprint)
          self.persistSeen()
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
    store.settings.lastFingerprint = trimmed
  }

  private static func incomplete(_ name: String) -> Bool {
    let lower = name.lowercased()
    let suffixes = [".crdownload", ".download", ".part", ".partial", ".tmp", ".aria2", ".osdownload", ".!ut", ".bc!"]
    return suffixes.contains { lower.hasSuffix($0) } || lower.hasSuffix(".part.nzb")
  }
}
