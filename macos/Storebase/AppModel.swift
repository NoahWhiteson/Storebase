import AppKit
import Combine
import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
  let store = SettingsStore()
  @Published var lastEvent = "Waiting for files"
  @Published var usedBytes: Int64 = 0
  @Published var reservedBytes: Int64 = 1
  @Published var pairingBusy = false
  @Published var pairingError: String?
  @Published var pairCodeDraft = ""
  @Published var nodeURLDraft = ""

  private var engine: IngestEngine?
  private var cancellable: AnyCancellable?

  var settings: AppSettings {
    get { store.settings }
    set { store.settings = newValue }
  }

  var paired: Bool { !settings.token.isEmpty && !settings.nodeURL.isEmpty }

  var menuSymbol: String {
    if !paired { return "externaldrive.badge.questionmark" }
    if settings.captureEnabled { return "externaldrive.fill.badge.checkmark" }
    return "externaldrive.badge.xmark"
  }

  var usedPercent: Double {
    guard reservedBytes > 0 else { return 0 }
    return min(1, Double(usedBytes) / Double(reservedBytes))
  }

  init() {
    nodeURLDraft = settings.nodeURL
    cancellable = store.objectWillChange.sink { [weak self] _ in
      self?.objectWillChange.send()
    }
    Notifier.request()
    restartEngine()
  }

  func toggleCapture() {
    settings.captureEnabled.toggle()
    restartEngine()
  }

  func restartEngine() {
    engine?.stop()
    let next = IngestEngine(store: store)
    next.onStatus = { [weak self] text in
      Task { @MainActor in self?.lastEvent = text }
    }
    next.onStorage = { [weak self] status in
      Task { @MainActor in
        self?.usedBytes = status.usedBytes
        self?.reservedBytes = status.quotaBytes ?? status.reservedBytes
        if let name = status.nodeName, !name.isEmpty { self?.settings.nodeName = name }
      }
    }
    next.onQuotaFull = { [weak self] in
      Task { @MainActor in self?.lastEvent = "Paused — node is full" }
    }
    engine = next
    next.start()
  }

  func pair() async {
    pairingBusy = true
    pairingError = nil
    defer { pairingBusy = false }
    let raw = nodeURLDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: raw), url.scheme != nil else {
      pairingError = "Node link needs a scheme, like http://192.168.1.12:4780"
      return
    }
    var name = settings.deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty { name = Host.current().localizedName ?? "Mac" }
    do {
      let result = try await APIClient.pair(baseURL: url, code: pairCodeDraft, deviceName: name)
      settings.nodeURL = raw
      settings.token = result.token
      settings.userName = result.user.name
      settings.userEmail = result.user.email
      settings.nodeName = result.nodeName ?? ""
      settings.deviceName = name
      usedBytes = result.usedBytes
      reservedBytes = result.quotaBytes ?? result.reservedBytes
      lastEvent = "Paired with \(settings.nodeName.isEmpty ? "Storebase" : settings.nodeName)"
      restartEngine()
    } catch {
      pairingError = error.localizedDescription
    }
  }

  func unpair() {
    settings.token = ""
    lastEvent = "Disconnected"
    restartEngine()
  }

  func openWeb() {
    guard let url = URL(string: settings.nodeURL) else { return }
    NSWorkspace.shared.open(url)
  }

  func openSettings() {
    NSApp.activate(ignoringOtherApps: true)
    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
  }
}
