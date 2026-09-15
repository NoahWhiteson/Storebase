import AppKit
import SwiftUI

struct MenuBarView: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 14) {
        Button(action: model.toggleCapture) {
          ZStack {
            Circle()
              .fill(model.paired && model.settings.captureEnabled ? Color.white : Color.white.opacity(0.12))
              .frame(width: 56, height: 56)
            Image(systemName: model.paired && model.settings.captureEnabled ? "pause.fill" : "play.fill")
              .font(.system(size: 20, weight: .semibold))
              .foregroundStyle(model.paired && model.settings.captureEnabled ? Color.black : Color.white)
          }
        }
        .buttonStyle(.plain)
        .disabled(!model.paired)
        .help(model.settings.captureEnabled ? "Pause capture" : "Start capture")

        VStack(alignment: .leading, spacing: 4) {
          Text(statusTitle)
            .font(.system(size: 15, weight: .semibold))
          Text(statusSubtitle)
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }

      VStack(alignment: .leading, spacing: 6) {
        GeometryReader { geo in
          ZStack(alignment: .leading) {
            Capsule().fill(Color.white.opacity(0.12))
            Capsule()
              .fill(Color.white)
              .frame(width: geo.size.width * model.usedPercent)
          }
        }
        .frame(height: 4)
        Text(storageLabel)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
      }

      Text(model.lastEvent)
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        .lineLimit(2)

      Divider().overlay(Color.white.opacity(0.12))

      Button("Settings") { model.openSettings() }
        .buttonStyle(MenuRowButton())
      Button("Open Storebase") { model.openWeb() }
        .buttonStyle(MenuRowButton())
        .disabled(!model.paired)
      Button("Quit Storebase") { NSApp.terminate(nil) }
        .buttonStyle(MenuRowButton())
    }
    .padding(16)
    .frame(width: 320)
    .background(Color.black.opacity(0.001))
  }

  private var statusTitle: String {
    if !model.paired { return "Not paired" }
    if model.settings.captureEnabled { return "Capture on" }
    return "Paused"
  }

  private var statusSubtitle: String {
    if !model.paired { return "Open Settings and paste your node link plus pairing code." }
    let node = model.settings.nodeName.isEmpty ? model.settings.nodeURL : model.settings.nodeName
    return node
  }

  private var storageLabel: String {
    "\(byteText(model.usedBytes)) of \(byteText(model.reservedBytes)) used"
  }

  private func byteText(_ value: Int64) -> String {
    let f = ByteCountFormatter()
    f.countStyle = .file
    return f.string(fromByteCount: value)
  }
}

private struct MenuRowButton: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 13))
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 6)
      .opacity(configuration.isPressed ? 0.6 : 1)
  }
}
