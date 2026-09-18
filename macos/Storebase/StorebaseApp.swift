import AppKit
import Combine
import SwiftUI

@main
struct StorebaseApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var model = AppModel()

  var body: some Scene {
    Window("Storebase", id: "main") {
      MainWindow()
        .environmentObject(model)
        .onAppear {
          AppDelegate.shared?.attach(model)
          model.startRuntime()
        }
    }
    .windowResizability(.contentSize)
    .defaultSize(width: 400, height: 540)
    .handlesExternalEvents(matching: [])
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

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  static var shared: AppDelegate?

  private var model: AppModel?
  private var statusItem: NSStatusItem?
  private var popover: NSPopover?
  private var cancellable: AnyCancellable?
  private var lastTitle = ""
  private var openedFromFiles = false

  func applicationWillFinishLaunching(_ notification: Notification) {
    if let event = NSAppleEventManager.shared().currentAppleEvent,
       event.eventID == 0x6F646F63 {
      openedFromFiles = true
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    AppDelegate.shared = self
    NSApp.setActivationPolicy(.regular)
    if let model = AppRuntime.model {
      attach(model)
      model.startRuntime()
    }
    Task { @MainActor in
      self.installStatusItem()
      if self.openedFromFiles {
        self.hideForFileHandoff()
      }
    }
  }

  func attach(_ model: AppModel) {
    self.model = model
    installStatusItem()
    cancellable = model.objectWillChange.sink { [weak self] _ in
      Task { @MainActor in
        self?.refreshTitle()
      }
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
    openedFromFiles = true
    hideForFileHandoff()
    CloudStub.enqueue(urls)
  }

  func hideForFileHandoff() {
    for window in NSApp.windows where isMainWindow(window) {
      window.orderOut(nil)
    }
    NSApp.hide(nil)
  }

  func showMainWindow() {
    NSApp.unhide(nil)
    if let window = NSApp.windows.first(where: isMainWindow) {
      window.makeKeyAndOrderFront(nil)
    }
    NSApp.activate(ignoringOtherApps: true)
  }

  private func isMainWindow(_ window: NSWindow) -> Bool {
    if window.title == "Storebase" { return true }
    if window.identifier?.rawValue == "main" { return true }
    return false
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showMainWindow()
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }
}
