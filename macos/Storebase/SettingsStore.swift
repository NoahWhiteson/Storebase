import Foundation
import ServiceManagement

final class SettingsStore: ObservableObject {
  @Published var settings: AppSettings {
    didSet { persist() }
  }

  private let key = "storebase.settings.v1"

  init() {
    if let data = UserDefaults.standard.data(forKey: key),
       let decoded = try? JSONDecoder().decode(AppSettings.self, from: data)
    {
      settings = decoded
    } else {
      settings = AppSettings()
    }
  }

  func persist() {
    if let data = try? JSONEncoder().encode(settings) {
      UserDefaults.standard.set(data, forKey: key)
    }
    syncLoginItem()
  }

  private func syncLoginItem() {
    do {
      if settings.launchAtLogin {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    } catch {
      // login item is best-effort
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
  var lastFingerprint: [String] = []

  enum Destination: String, Codable, CaseIterable {
    case myFiles
    case temp
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
