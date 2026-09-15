import AppKit
import SwiftUI

struct MainWindow: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider().overlay(Color.white.opacity(0.08))
      if model.paired {
        captureBody
      } else {
        pairBody
      }
    }
    .frame(width: 400)
    .background(Color(red: 26 / 255, green: 26 / 255, blue: 26 / 255))
    .preferredColorScheme(.dark)
  }

  private var header: some View {
    HStack(spacing: 12) {
      Image("Logo")
        .resizable()
        .interpolation(.high)
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      VStack(alignment: .leading, spacing: 2) {
        Text("Storebase")
          .font(.system(size: 16, weight: .semibold))
        Text(model.paired ? statusTitle : "1.2 — paste your pairing code")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
      }
      Spacer()
    }
    .padding(18)
  }

  private var pairBody: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Paste the node link and pairing code from Storebase → Settings → Mac app.")
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)

      TextField("http://192.168.1.12:4780", text: $model.nodeURLDraft)
        .textFieldStyle(.roundedBorder)
      SecureField("ABCD-EFGH", text: $model.pairCodeDraft)
        .textFieldStyle(.roundedBorder)

      if let err = model.pairingError {
        Text(err)
          .font(.system(size: 12))
          .foregroundStyle(.red)
      }

      Button {
        Task { await model.pair() }
      } label: {
        Text(model.pairingBusy ? "Connecting…" : "Connect")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(.white)
      .foregroundStyle(.black)
      .disabled(model.pairingBusy)

      Spacer(minLength: 8)
    }
    .padding(18)
    .frame(minHeight: 280, alignment: .top)
  }

  private var captureBody: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .center, spacing: 14) {
        Button(action: model.toggleCapture) {
          ZStack {
            Circle()
              .fill(model.settings.captureEnabled ? Color.white : Color.white.opacity(0.12))
              .frame(width: 56, height: 56)
            Image(systemName: model.settings.captureEnabled ? "pause.fill" : "play.fill")
              .font(.system(size: 20, weight: .semibold))
              .foregroundStyle(model.settings.captureEnabled ? Color.black : Color.white)
          }
        }
        .buttonStyle(.plain)
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
        .lineLimit(3)

      Divider().overlay(Color.white.opacity(0.12))

      Button("Settings") { model.openSettings() }
        .buttonStyle(MenuRowButton())
      Button("Open Storebase") { model.openWeb() }
        .buttonStyle(MenuRowButton())
      Button("Disconnect", role: .destructive, action: model.unpair)
        .buttonStyle(MenuRowButton())
    }
    .padding(18)
  }

  private var statusTitle: String {
    if !model.paired { return "Not paired" }
    if model.settings.captureEnabled { return "Capture on" }
    return "Paused"
  }

  private var statusSubtitle: String {
    if !model.paired { return "Pair this Mac with your node." }
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
