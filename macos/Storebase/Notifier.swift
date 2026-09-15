import UserNotifications

enum Notifier {
  static func request() {
    Task { @MainActor in
      _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }
  }

  static func send(id: String = UUID().uuidString, title: String, body: String) {
    Task { @MainActor in
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
      try? await UNUserNotificationCenter.current().add(req)
    }
  }

  static func quotaFull(file: String) {
    send(
      id: "quota-full",
      title: "Storebase is out of storage",
      body: "Couldn’t capture \(file). Free space on the node or raise the cap, then turn capture back on."
    )
  }

  static func quotaWarn(percent: Int) {
    send(
      id: "quota-warn",
      title: "Storebase is almost full",
      body: "You’re at \(percent)% of your storage. Capture will stop when the node is full."
    )
  }
}
