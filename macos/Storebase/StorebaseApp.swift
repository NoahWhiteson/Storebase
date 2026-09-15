import AppKit
import Combine
import SwiftUI

@main
struct StorebaseApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var model = AppModel()

  var body: some Scene {
    WindowGroup("Storebase") {
      MainWindow()
        .environmentObject(model)
        .onAppear {
          AppDelegate.shared?.attach(model)
          model.startRuntime()
        }
    }
    .windowResizability(.contentSize)
    .defaultSize(width: 400, height: 540)
    .commands {
      CommandGroup(replacing: .appSettings) {
        Button("Settings…") {
          model.openSettings()
        }
        .keyboardShortcut(",", modifiers: .command)
      }
      CommandGroup(replacing: .newItem) {}
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  static var shared: AppDelegate?

  private var model: AppModel?
  private var statusItem: NSStatusItem?
  private var popover: NSPopover?
  private var cancellable: AnyCancellable?
  private var lastTitle = ""

  override init() {
    super.init()
    AppDelegate.shared = self
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    DispatchQueue.main.async { [weak self] in
      self?.installStatusItem()
    }
  }

  func attach(_ model: AppModel) {
    self.model = model
    installStatusItem()
    cancellable = model.objectWillChange.sink { [weak self] _ in
      DispatchQueue.main.async { self?.refreshTitle() }
    }
    refreshTitle()
  }

  private func installStatusItem() {
    guard statusItem == nil else { return }
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    guard let button = item.button else { return }
    let image = NSImage(named: "MenuBarIcon")
    image?.isTemplate = true
    button.image = image
    button.imagePosition = .imageLeft
    button.target = self
    button.action = #selector(togglePopover(_:))
    button.sendAction(on: [.leftMouseUp])
    button.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
    statusItem = item
  }

  private func refreshTitle() {
    let text = model?.menuBarText ?? ""
    guard text != lastTitle else { return }
    lastTitle = text
    statusItem?.button?.title = text.isEmpty ? "" : " \(text)"
  }

  @objc private func togglePopover(_ sender: Any?) {
    guard let button = statusItem?.button else { return }
    if let popover, popover.isShown {
      popover.performClose(nil)
      return
    }
    guard let model else { return }
    let host = NSHostingController(rootView: MenuBarView().environmentObject(model))
    let popover = NSPopover()
    popover.behavior = .transient
    popover.animates = false
    popover.contentSize = NSSize(width: 320, height: 400)
    popover.contentViewController = host
    self.popover = popover
    popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    CloudStub.enqueue(urls)
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag {
      NSApp.windows.first(where: { $0.title == "Storebase" })?.makeKeyAndOrderFront(nil)
    }
    sender.activate(ignoringOtherApps: true)
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }
}
