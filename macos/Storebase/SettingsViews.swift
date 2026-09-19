import AppKit
import SwiftUI

enum SettingsPane: String, CaseIterable, Identifiable {
  case general, connection, folders, routing, notifications, storage, transfer, advanced
  var id: String { rawValue }
  var title: String {
    switch self {
    case .general: return "General"
    case .connection: return "Connection"
    case .folders: return "Folders"
    case .routing: return "Temp & routing"
    case .notifications: return "Notifications"
    case .storage: return "Storage"
    case .transfer: return "Transfer"
    case .advanced: return "Advanced"
    }
  }
}

struct SettingsRootView: View {
  @EnvironmentObject var model: AppModel
  @State private var pane: SettingsPane = .connection

  var body: some View {
    HStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 2) {
        ForEach(SettingsPane.allCases) { item in
          Button {
            pane = item
          } label: {
            Text(item.title)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 10)
              .padding(.vertical, 7)
              .background(pane == item ? Color.primary.opacity(0.08) : Color.clear)
              .clipShape(RoundedRectangle(cornerRadius: 6))
          }
          .buttonStyle(.plain)
        }
        Spacer()
      }
      .padding(12)
      .frame(width: 180)
      Divider()
      Group {
        switch pane {
        case .general: GeneralPane()
        case .connection: ConnectionPane()
        case .folders: FoldersPane()
        case .routing: RoutingPane()
        case .notifications: NotificationsPane()
        case .storage: StoragePane()
        case .transfer: TransferPane()
        case .advanced: AdvancedPane()
        }
      }
      .formStyle(.grouped)
      .padding()
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .environmentObject(model)
  }
}

struct GeneralPane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section("Capture") {
        Toggle("Capture files into Storebase", isOn: bind(\.captureEnabled))
          .onChange(of: model.settings.captureEnabled) { _, _ in model.restartEngine() }
        Toggle("Launch at login", isOn: bind(\.launchAtLogin))
        Toggle("Pause capture when the node is full", isOn: bind(\.pauseWhenFull))
      }
      Section("This Mac") {
        TextField("Device name", text: bind(\.deviceName))
        LabeledContent("Signed in as") {
          Text(model.settings.userEmail.isEmpty ? "—" : model.settings.userEmail)
        }
      }
      Section("Mounted disk") {
        Toggle("Mount Storebase as a disk", isOn: mountBind)
          .onChange(of: model.settings.mountsDisk) { _, _ in model.restartVolume() }
        Text("Finder gets a Storebase volume. Apps read byte ranges from the node through a local cache — they do not wait for a full download. Path: \(model.volumePath).")
          .font(.caption)
          .foregroundStyle(.secondary)
        Button("Open Storebase disk") { model.openVolume() }
          .disabled(!model.paired || !model.settings.mountsDisk)
      }
    }
  }

  private func bind<T>(_ key: WritableKeyPath<AppSettings, T>) -> Binding<T> {
    Binding(
      get: { model.settings[keyPath: key] },
      set: { model.settings[keyPath: key] = $0 }
    )
  }

  private var mountBind: Binding<Bool> {
    Binding(
      get: { model.settings.mountsDisk },
      set: { model.settings.mountDisk = $0 }
    )
  }
}

struct ConnectionPane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section("Pair with your node") {
        TextField("Node link", text: $model.nodeURLDraft, prompt: Text("http://192.168.1.12:4780"))
        SecureField("Pairing code", text: $model.pairCodeDraft, prompt: Text("ABCD-EFGH"))
        if let err = model.pairingError {
          Text(err).foregroundStyle(.red).font(.caption)
        }
        HStack {
          Button(model.paired ? "Reconnect" : "Connect") {
            Task { await model.pair() }
          }
          .disabled(model.pairingBusy)
          if model.paired {
            Button("Disconnect", role: .destructive, action: model.unpair)
          }
        }
        Text("Copy the link and code from Storebase → Settings → Mac app.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      if model.paired {
        Section("Session") {
          LabeledContent("Node") { Text(model.settings.nodeName.isEmpty ? model.settings.nodeURL : model.settings.nodeName) }
          LabeledContent("URL") { Text(model.settings.nodeURL) }
        }
      }
    }
  }
}

struct FoldersPane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section("Watch these folders") {
        Toggle("Downloads", isOn: bind(\.watchDownloads))
        Toggle("Desktop", isOn: bind(\.watchDesktop))
        Toggle("Documents", isOn: bind(\.watchDocuments))
        Toggle("Screenshots & screen recordings", isOn: bind(\.captureScreenshots))
      }
      Section("Extra folders") {
        ForEach(Array(model.settings.customFolders.enumerated()), id: \.offset) { index, path in
          HStack {
            Text(path).lineLimit(1)
            Spacer()
            Button("Remove") {
              model.settings.customFolders.remove(at: index)
            }
          }
        }
        Button("Add folder…") { pickFolder() }
      }
      Section {
        Text("New files in these folders are uploaded to Storebase. With cloud copies on, they stay in the folder with the same name but take no disk until you open them.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  private func pickFolder() {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = true
    panel.begin { result in
      guard result == .OK else { return }
      for url in panel.urls {
        if !model.settings.customFolders.contains(url.path) {
          model.settings.customFolders.append(url.path)
        }
      }
    }
  }

  private func bind(_ key: WritableKeyPath<AppSettings, Bool>) -> Binding<Bool> {
    Binding(
      get: { model.settings[keyPath: key] },
      set: { model.settings[keyPath: key] = $0 }
    )
  }
}

struct RoutingPane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section("Default destination") {
        Picker("New files go to", selection: bind(\.defaultDestination)) {
          Text("My files").tag(AppSettings.Destination.myFiles)
          Text("Temp (auto-delete)").tag(AppSettings.Destination.temp)
        }
        TextField("Folder on the node", text: bind(\.destFolder))
      }
      Section("Send to Temp") {
        TextField("Extensions", text: bind(\.tempExtensions), prompt: Text("dmg, pkg, zip"))
        TextField("Never Temp", text: bind(\.neverTempExtensions), prompt: Text("jpg, png, pdf"))
        HStack {
          Text("Files larger than")
          TextField("MB", value: bind(\.largeFilesToTempMB), format: .number)
            .frame(width: 72)
          Text("MB go to Temp (0 = off)")
        }
      }
      Section {
        Text("Temp uses the timer you set in the web app. Installers and torrents default to Temp; photos and PDFs stay in My files unless you change that.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  private func bind<T>(_ key: WritableKeyPath<AppSettings, T>) -> Binding<T> {
    Binding(
      get: { model.settings[keyPath: key] },
      set: { model.settings[keyPath: key] = $0 }
    )
  }
}

struct NotificationsPane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section {
        Toggle("Notify when the node is full", isOn: bind(\.notifyQuota))
        Toggle("Notify on capture errors", isOn: bind(\.notifyErrors))
        Toggle("Notify on every captured file", isOn: bind(\.notifyUploads))
        HStack {
          Text("Warn at")
          Slider(value: bind(\.quotaWarnPercent), in: 50 ... 99, step: 1)
          Text("\(Int(model.settings.quotaWarnPercent))%")
            .monospacedDigit()
            .frame(width: 40, alignment: .trailing)
        }
      }
    }
  }

  private func bind<T>(_ key: WritableKeyPath<AppSettings, T>) -> Binding<T> {
    Binding(
      get: { model.settings[keyPath: key] },
      set: { model.settings[keyPath: key] = $0 }
    )
  }
}

struct StoragePane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section("This account") {
        ProgressView(value: model.usedPercent)
        LabeledContent("Used") { Text(byteText(model.usedBytes)) }
        LabeledContent("Cap") { Text(byteText(model.reservedBytes)) }
        Text("If capture hits the cap you’ll get a macOS notification and, if enabled, capture pauses.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Section("After upload") {
        Toggle("Keep files in the folder as cloud copies", isOn: placeholdersBind)
        Text("Keeps the real name and icon. Each cloud copy is tagged Storebase in Finder (and Get Info). Double-click always opens Storebase, which downloads then hands off to Preview or whatever owns that type. Close it and the local bytes disappear.")
          .font(.caption)
          .foregroundStyle(.secondary)
        Toggle("Keep deletes in sync", isOn: mirrorDeletesBind)
        Text("Delete a captured file here → trash on Storebase. Delete it on the site → it leaves this Mac too.")
          .font(.caption)
          .foregroundStyle(.secondary)
        Toggle("Remove the local file after it’s on Storebase", isOn: bind(\.removeLocalAfterUpload))
          .disabled(model.settings.usesPlaceholders)
        Toggle("Move to Trash instead of deleting forever", isOn: bind(\.trashInsteadOfDelete))
          .disabled(model.settings.usesPlaceholders || !model.settings.removeLocalAfterUpload)
      }
    }
  }

  private func bind(_ key: WritableKeyPath<AppSettings, Bool>) -> Binding<Bool> {
    Binding(
      get: { model.settings[keyPath: key] },
      set: { model.settings[keyPath: key] = $0 }
    )
  }

  private var placeholdersBind: Binding<Bool> {
    Binding(
      get: { model.settings.usesPlaceholders },
      set: { model.settings.cloudPlaceholders = $0 }
    )
  }

  private var mirrorDeletesBind: Binding<Bool> {
    Binding(
      get: { model.settings.usesMirrorDeletes },
      set: { model.settings.mirrorDeletes = $0 }
    )
  }

  private func byteText(_ value: Int64) -> String {
    let f = ByteCountFormatter()
    f.countStyle = .file
    return f.string(fromByteCount: value)
  }
}

struct TransferPane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section("Speed") {
        Picker("Cap", selection: speedBind) {
          ForEach(AppSettings.TransferSpeed.allCases) { mode in
            Text(mode.title).tag(mode)
          }
        }
        Text(speedHelp)
          .font(.caption)
          .foregroundStyle(.secondary)
        if model.settings.speed == .wifi {
          capSlider(title: "Wi-Fi cap", kbps: wifiBind)
        }
        if model.settings.speed == .custom {
          capSlider(title: "Cap", kbps: customBind)
        }
        LabeledContent("This Mac") {
          Text(model.onWifi ? "Wi-Fi" : "Ethernet or other")
        }
      }
      Section("Menu bar") {
        Toggle("Show storage left next to the clock", isOn: storageChip)
        Toggle("Show a transfer chip while files move", isOn: transferChip)
        Text("These sit with battery and Wi-Fi. Storage shows what’s left on the node. The transfer chip appears only while a file is moving.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  private var speedHelp: String {
    switch model.settings.speed {
    case .unlimited:
      return "Use the full link. Fine on Ethernet; can saturate a shared Wi-Fi radio."
    case .wifi:
      return "On Wi-Fi, hold to the cap below so calls and browsing still work. Ethernet stays unlimited."
    case .custom:
      return "Always hold to this cap, Wi-Fi or not."
    }
  }

  private var speedBind: Binding<AppSettings.TransferSpeed> {
    Binding(
      get: { model.settings.speed },
      set: { model.settings.speed = $0 }
    )
  }

  private var wifiBind: Binding<Int> {
    Binding(
      get: { model.settings.wifiCapKBps },
      set: { model.settings.wifiCapKBps = $0 }
    )
  }

  private var customBind: Binding<Int> {
    Binding(
      get: { model.settings.customCapKBps },
      set: { model.settings.customCapKBps = $0 }
    )
  }

  private var storageChip: Binding<Bool> {
    Binding(
      get: { model.settings.showsMenuBarStorage },
      set: { model.settings.showsMenuBarStorage = $0 }
    )
  }

  private var transferChip: Binding<Bool> {
    Binding(
      get: { model.settings.showsMenuBarTransfers },
      set: { model.settings.showsMenuBarTransfers = $0 }
    )
  }

  @ViewBuilder
  private func capSlider(title: String, kbps: Binding<Int>) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(title)
        Spacer()
        Text(rateLabel(kbps.wrappedValue))
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
      Slider(
        value: Binding(
          get: { Double(kbps.wrappedValue) },
          set: { kbps.wrappedValue = Int($0) }
        ),
        in: 64 ... 32768,
        step: 64
      )
    }
  }

  private func rateLabel(_ kbps: Int) -> String {
    if kbps >= 1024 {
      let mb = Double(kbps) / 1024
      return String(format: mb >= 10 ? "%.0f MB/s" : "%.1f MB/s", mb)
    }
    return "\(kbps) KB/s"
  }
}

struct AdvancedPane: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Form {
      Section {
        HStack {
          Text("Wait for the file to finish writing")
          Spacer()
          TextField("sec", value: bind(\.settleSeconds), format: .number)
            .frame(width: 56)
          Text("sec")
        }
        HStack {
          Text("Uploads at once")
          Spacer()
          Stepper(value: bind(\.maxConcurrent), in: 1 ... 8) {
            Text("\(model.settings.maxConcurrent)")
          }
        }
        Toggle("Skip hidden files", isOn: bind(\.skipHidden))
        Toggle("Skip incomplete browser downloads", isOn: bind(\.skipIncomplete))
      }
    }
  }

  private func bind<T>(_ key: WritableKeyPath<AppSettings, T>) -> Binding<T> {
    Binding(
      get: { model.settings[keyPath: key] },
      set: { model.settings[keyPath: key] = $0 }
    )
  }
}

@MainActor
enum SettingsWindow {
  private static var window: NSWindow?

  static func show(model: AppModel) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    if let window {
      window.makeKeyAndOrderFront(nil)
      window.orderFrontRegardless()
      NSApp.activate(ignoringOtherApps: true)
      return
    }
    let host = NSHostingController(rootView: SettingsRootView().environmentObject(model))
    let window = NSWindow(contentViewController: host)
    window.title = "Settings"
    window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
    window.setContentSize(NSSize(width: 760, height: 560))
    window.minSize = NSSize(width: 640, height: 420)
    window.center()
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    Self.window = window
  }
}
