import AppKit
import Combine
import Foundation
import Network
import SwiftUI

struct TransferItem: Identifiable, Equatable {
  let id: UUID
  var name: String
  var done: Int64
  var total: Int64
  var uploading: Bool

  var fraction: Double {
    guard total > 0 else { return 0 }
    return min(1, Double(done) / Double(total))
  }
}

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
  @Published var onWifi = true
  @Published var transfers: [TransferItem] = []
  private var lastTransferPaint = Date.distantPast

  private var engine: IngestEngine?
  private var cancellable: AnyCancellable?
  private let pathMonitor = NWPathMonitor()
  private var runtimeStarted = false

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

  var remainingBytes: Int64 { max(0, reservedBytes - usedBytes) }

  var remainingLabel: String {
    "\(byteText(remainingBytes)) left"
  }

  var transferLabel: String {
    guard let first = transfers.first else { return "" }
    let pct = Int((first.fraction * 100).rounded())
    if transfers.count == 1 {
      return "\(pct)%"
    }
    return "\(transfers.count) files"
  }

  var menuBarText: String {
    var parts: [String] = []
    if paired, settings.showsMenuBarStorage {
      parts.append(remainingLabel)
    }
    if paired, settings.showsMenuBarTransfers, !transferLabel.isEmpty {
      parts.append(transferLabel)
    }
    return parts.joined(separator: "  ")
  }

  func byteText(_ value: Int64) -> String {
    let f = ByteCountFormatter()
    f.countStyle = .file
    return f.string(fromByteCount: value)
  }

  func beginTransfer(name: String, total: Int64, uploading: Bool) -> UUID {
    let id = UUID()
    transfers.append(TransferItem(id: id, name: name, done: 0, total: total, uploading: uploading))
    return id
  }

  func updateTransfer(id: UUID, done: Int64, total: Int64) {
    guard let index = transfers.firstIndex(where: { $0.id == id }) else { return }
    let finished = total > 0 && done >= total
    let now = Date()
    if !finished, now.timeIntervalSince(lastTransferPaint) < 0.12 { return }
    lastTransferPaint = now
    transfers[index].done = done
    if total > 0 { transfers[index].total = total }
  }

  func endTransfer(id: UUID) {
    transfers.removeAll { $0.id == id }
  }

  func client() -> APIClient? {
    guard paired, let base = URL(string: settings.nodeURL) else { return nil }
    let client = APIClient(baseURL: base, token: settings.token)
    client.limitBytesPerSecond = settings.limitBytesPerSecond(onWifi: onWifi)
    return client
  }

  init() {
    nodeURLDraft = settings.nodeURL
    cancellable = store.objectWillChange.sink { [weak self] _ in
      self?.objectWillChange.send()
    }
    AppRuntime.model = self
  }

  func startRuntime() {
    guard !runtimeStarted else { return }
    runtimeStarted = true
    pathMonitor.pathUpdateHandler = { [weak self] path in
      let wifi = path.usesInterfaceType(.wifi)
      let wired = path.usesInterfaceType(.wiredEthernet)
      Task { @MainActor in
        self?.onWifi = wifi && !wired
      }
    }
    pathMonitor.start(queue: DispatchQueue(label: "app.storebase.path"))
    restartEngine()
    StubAccess.start()
    Task { await CloudStub.flushPending() }
    Task {
      try? await Task.sleep(nanoseconds: 2_000_000_000)
      Notifier.request()
    }
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
    var raw = nodeURLDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    if !raw.isEmpty, !raw.contains("://") { raw = "http://\(raw)" }
    guard let url = URL(string: raw), let scheme = url.scheme, let host = url.host, !scheme.isEmpty else {
      pairingError = "Node link needs a scheme, like http://192.168.1.12:4780"
      return
    }
    if host == "0.0.0.0" || host == "::" || host == "[::]" {
      pairingError = "0.0.0.0 is the listen address, not a URL. Use 127.0.0.1 if the node is on this Mac, or the server’s LAN/public IP."
      return
    }
    var name = settings.deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty { name = "Mac" }
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
    SettingsWindow.show(model: self)
  }
}
