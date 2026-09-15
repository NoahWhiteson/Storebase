import SwiftUI

@main
struct StorebaseApp: App {
  @StateObject private var model = AppModel()

  var body: some Scene {
    MenuBarExtra {
      MenuBarView()
        .environmentObject(model)
    } label: {
      Image(systemName: model.menuSymbol)
        .symbolRenderingMode(.monochrome)
    }
    .menuBarExtraStyle(.window)

    Settings {
      SettingsRootView()
        .environmentObject(model)
        .frame(minWidth: 680, minHeight: 520)
    }
  }
}
