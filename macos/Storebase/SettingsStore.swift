import Foundation
import ServiceManagement

final class SettingsStore: ObservableObject, @unchecked Sendable {
  @Published var settings: AppSettings {
    didSet { persist() }
  }

  private let key = "storebase.settings.v1"
  private var syncedLaunchAtLogin: Bool

  init() {
    let loaded: AppSettings
    if let data = UserDefaults.standard.data(forKey: key),
       let decoded = try? JSONDecoder().decode(AppSettings.self, from: data)
    {
      loaded = decoded
    } else {
      loaded = AppSettings()
    }
    settings = loaded
    syncedLaunchAtLogin = loaded.launchAtLogin
  }

  func persist() {
    if let data = try? JSONEncoder().encode(settings) {
      UserDefaults.standard.set(data, forKey: key)
    }
    syncLoginItemIfNeeded()
  }

  private func syncLoginItemIfNeeded() {
    let launch = settings.launchAtLogin
    guard launch != syncedLaunchAtLogin else { return }
    syncedLaunchAtLogin = launch
    Task.detached {
      do {
        if launch {
          try SMAppService.mainApp.register()
        } else {
          try SMAppService.mainApp.unregister()
        }
      } catch {
        // login item is best-effort
      }
    }
  }
}

struct AppSettings: Codable, Equatable {
  var captureEnabled = true
  var nodeURL = ""
  var token = ""
  var deviceName = ""
  var userName = ""
  var userEmail = ""
  var nodeName = ""
  var watchDownloads = true
  var watchDesktop = false
  var watchDocuments = false
  var customFolders: [String] = []
  var settleSeconds = 2.0
  var removeLocalAfterUpload = true
  var trashInsteadOfDelete = true
  var defaultDestination = Destination.myFiles
  var tempExtensions = "dmg,pkg,zip,iso,torrent,exe,msi,apk"
  var neverTempExtensions = "jpg,jpeg,png,heic,webp,gif,mov,mp4,pdf"
  var largeFilesToTempMB: Double = 500
  var destFolder = "Downloads"
  var notifyUploads = false
  var notifyQuota = true
  var notifyErrors = true
  var quotaWarnPercent = 80.0
  var launchAtLogin = false
  var skipHidden = true
  var skipIncomplete = true
  var maxConcurrent = 2
  var pauseWhenFull = true
  var captureScreenshots = false
  var cloudPlaceholders: Bool? = true
  var mirrorDeletes: Bool? = true
  var lastFingerprint: [String] = []
  var transferMode: String? = nil
  var wifiKBps: Int? = nil
  var customKBps: Int? = nil
  var menuBarStorage: Bool? = nil
  var menuBarTransfers: Bool? = nil

  enum Destination: String, Codable, CaseIterable {
    case myFiles
    case temp
  }

  enum TransferSpeed: String, CaseIterable, Identifiable {
    case unlimited
    case wifi
    case custom
    var id: String { rawValue }
    var title: String {
      switch self {
      case .unlimited: return "Unlimited"
      case .wifi: return "Match Wi-Fi"
      case .custom: return "Custom cap"
      }
    }
  }

  var usesPlaceholders: Bool { cloudPlaceholders ?? true }

  var usesMirrorDeletes: Bool { mirrorDeletes ?? true }

  var speed: TransferSpeed {
    get { TransferSpeed(rawValue: transferMode ?? TransferSpeed.wifi.rawValue) ?? .wifi }
    set { transferMode = newValue.rawValue }
  }

  var wifiCapKBps: Int {
    get { max(64, wifiKBps ?? 4096) }
    set { wifiKBps = max(64, newValue) }
  }

  var customCapKBps: Int {
    get { max(64, customKBps ?? 8192) }
    set { customKBps = max(64, newValue) }
  }

  var showsMenuBarStorage: Bool {
    get { menuBarStorage ?? true }
    set { menuBarStorage = newValue }
  }

  var showsMenuBarTransfers: Bool {
    get { menuBarTransfers ?? true }
    set { menuBarTransfers = newValue }
  }

  func limitBytesPerSecond(onWifi: Bool) -> Int {
    switch speed {
    case .unlimited:
      return 0
    case .wifi:
      return onWifi ? wifiCapKBps * 1024 : 0
    case .custom:
      return customCapKBps * 1024
    }
  }

  func tempExtSet() -> Set<String> {
    Self.splitExt(tempExtensions)
  }

  func neverTempSet() -> Set<String> {
    Self.splitExt(neverTempExtensions)
  }

  static func splitExt(_ raw: String) -> Set<String> {
    Set(
      raw
        .split(whereSeparator: { ",; ".contains($0) })
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().trimmingCharacters(in: ["."]) }
        .filter { !$0.isEmpty }
    )
  }
}
