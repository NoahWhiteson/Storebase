import AppKit
import SwiftUI

@main
struct StorebaseApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var model = AppModel()

  var body: some Scene {
    Window("Storebase", id: "main") {
      MainWindow()
        .environmentObject(model)
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

    MenuBarExtra {
      MenuBarView()
        .environmentObject(model)
    } label: {
      Image("MenuBarIcon")
    }
    .menuBarExtraStyle(.window)

    MenuBarExtra(isInserted: storageChip) {
      MenuBarView()
        .environmentObject(model)
    } label: {
      Text(model.remainingLabel)
        .monospacedDigit()
    }
    .menuBarExtraStyle(.menu)

    MenuBarExtra(isInserted: transferChip) {
      MenuBarView()
        .environmentObject(model)
    } label: {
      Text(model.transferLabel.isEmpty ? "—" : model.transferLabel)
        .monospacedDigit()
    }
    .menuBarExtraStyle(.menu)
  }

  private var storageChip: Binding<Bool> {
    Binding(
      get: { model.paired && model.settings.showsMenuBarStorage },
      set: { model.settings.showsMenuBarStorage = $0 }
    )
  }

  private var transferChip: Binding<Bool> {
    Binding(
      get: { model.paired && model.settings.showsMenuBarTransfers },
      set: { model.settings.showsMenuBarTransfers = $0 }
    )
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
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
