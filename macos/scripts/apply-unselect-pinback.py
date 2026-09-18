#!/usr/bin/env python3
"""Patch CloudStub.swift so Finder unselect evicts the stub. Run from ~/Storebase."""
from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
path = root / "macos/Storebase/CloudStub.swift"
text = path.read_text()
if "enum CloudStub" not in text:
    sys.exit(f"Not CloudStub.swift: {path}")


def has(old: str) -> bool:
    return old in text


def sub(old: str, new: str, required: bool = True) -> bool:
    global text
    if old not in text:
        if required:
            sys.exit(f"Could not find expected code in {path}:\n{old[:160]}")
        return False
    text = text.replace(old, new, 1)
    return True


def replace_between(start: str, end: str, new: str) -> None:
    global text
    a = text.find(start)
    b = text.find(end, a)
    if a < 0 or b < 0:
        sys.exit(f"Could not find block starting {start!r}")
    text = text[:a] + new + text[b:]


if "draggingFiles" in text and "retryPinBack" in text and "isWanted" in text:
    print("Already patched:", path)
else:
    if "replaceSelection" not in text:
        sub(
            "  private static var holdUntil: [String: Date] = [:]\n",
            "  private static var holdUntil: [String: Date] = [:]\n  private static var selectionHolds: Set<String> = []\n  private static var dragHolds: Set<String> = []\n",
        )
        sub(
            """  private static func isHeld(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    return gate.sync {
      if let until = holdUntil[path], until > Date() { return true }
      holdUntil.removeValue(forKey: path)
      return false
    }
  }

  static func requestMaterialize(_ urls: [URL], unpinCopies: Bool = true) {
    for url in urls {
      guard isCloudFile(url) || hasStorebaseTag(url) || TrackedClouds.remote(forLocal: url.path) != nil else { continue }
      hold(url)
      Task {
        do {
          let tracked = TrackedClouds.isTracked(local: url.path)
          _ = try await materialize(url, unpin: unpinCopies && !tracked)
        } catch {
          // drag materialize is best-effort; open still shows a notification
        }
      }
    }
  }
""",
            """  static func replaceSelection(_ paths: Set<String>) -> Set<String> {
    gate.sync {
      let gone = selectionHolds.subtracting(paths)
      selectionHolds = paths
      return gone
    }
  }

  static func replaceDrag(_ paths: Set<String>) -> Set<String> {
    gate.sync {
      let gone = dragHolds.subtracting(paths)
      dragHolds = paths
      return gone
    }
  }

  private static func isHeld(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    return gate.sync {
      if selectionHolds.contains(path) || dragHolds.contains(path) { return true }
      if let until = holdUntil[path], until > Date() { return true }
      holdUntil.removeValue(forKey: path)
      return false
    }
  }

  static func requestMaterialize(_ urls: [URL], unpinCopies: Bool = true) {
    for url in urls {
      guard isCloudFile(url) || hasStorebaseTag(url) || TrackedClouds.remote(forLocal: url.path) != nil else { continue }
      Task {
        do {
          let tracked = TrackedClouds.isTracked(local: url.path)
          _ = try await materialize(url, unpin: unpinCopies && !tracked)
          pinBack(url)
        } catch {
          // drag materialize is best-effort; open still shows a notification
        }
      }
    }
  }

  static func pinBack(paths: Set<String>, force: Bool = false) {
    for path in paths {
      pinBack(URL(fileURLWithPath: path), force: force)
    }
  }

  static func pinBack(_ url: URL, force: Bool = false) {
    let path = url.standardizedFileURL.path
    if isBusy(local: path) { return }
    if force {
      gate.sync {
        holdUntil.removeValue(forKey: path)
        dragHolds.remove(path)
      }
    } else if isHeld(url) {
      return
    }
    if isOpen(url) { return }
    guard FileManager.default.fileExists(atPath: path) else { return }
    let info = meta(at: url)
    let remote = info?.path ?? TrackedClouds.remote(forLocal: path) ?? ""
    guard !remote.isEmpty else { return }
    let allocated = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    if allocated <= 8192, info?.state == "evicted" { return }
    let size = info?.size ?? Int64(allocated)
    evict(url: url, remotePath: remote, size: size)
  }
""",
        )
        sub("    hold(url)\n    let changed = url.path\n", "    let changed = url.path\n", required=False)

    if "private static func isWanted" not in text:
        sub(
            """  private static func isHeld(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    return gate.sync {
      if selectionHolds.contains(path) || dragHolds.contains(path) { return true }
      if let until = holdUntil[path], until > Date() { return true }
      holdUntil.removeValue(forKey: path)
      return false
    }
  }
""",
            """  private static func isHeld(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    return gate.sync {
      if selectionHolds.contains(path) || dragHolds.contains(path) { return true }
      if let until = holdUntil[path], until > Date() { return true }
      holdUntil.removeValue(forKey: path)
      return false
    }
  }

  private static func isWanted(_ url: URL) -> Bool {
    let path = url.standardizedFileURL.path
    return gate.sync { selectionHolds.contains(path) || dragHolds.contains(path) }
  }
""",
        )

    if "if !isWanted(url)" not in text:
        sub(
            "          _ = try await materialize(url, unpin: unpinCopies && !tracked)\n          pinBack(url)\n",
            "          _ = try await materialize(url, unpin: unpinCopies && !tracked)\n          if !isWanted(url) {\n            pinBack(url, force: true)\n          }\n",
            required=False,
        )
        sub(
            "          _ = try await materialize(url, unpin: unpinCopies && !tracked)\n        } catch {",
            "          _ = try await materialize(url, unpin: unpinCopies && !tracked)\n          if !isWanted(url) {\n            pinBack(url, force: true)\n          }\n        } catch {",
            required=False,
        )

    if "retryPinBack" not in text:
        sub(
            """  static func pinBack(_ url: URL, force: Bool = false) {
    let path = url.standardizedFileURL.path
    if isBusy(local: path) { return }
    if force {
      gate.sync {
        holdUntil.removeValue(forKey: path)
        dragHolds.remove(path)
      }
    } else if isHeld(url) {
      return
    }
    if isOpen(url) { return }
    guard FileManager.default.fileExists(atPath: path) else { return }
    let info = meta(at: url)
    let remote = info?.path ?? TrackedClouds.remote(forLocal: path) ?? ""
    guard !remote.isEmpty else { return }
    let allocated = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    if allocated <= 8192, info?.state == "evicted" { return }
    let size = info?.size ?? Int64(allocated)
    evict(url: url, remotePath: remote, size: size)
  }
""",
            """  static func pinBack(_ url: URL, force: Bool = false, attempt: Int = 0) {
    let path = url.standardizedFileURL.path
    if isBusy(local: path) {
      if force, attempt < 10 {
        retryPinBack(url, attempt: attempt)
      }
      return
    }
    if force {
      let stillSelected: Bool = gate.sync {
        holdUntil.removeValue(forKey: path)
        dragHolds.remove(path)
        return selectionHolds.contains(path)
      }
      if stillSelected { return }
    } else if isHeld(url) {
      return
    }
    if isOpen(url) {
      if force, attempt < 10 {
        retryPinBack(url, attempt: attempt)
      }
      return
    }
    guard FileManager.default.fileExists(atPath: path) else { return }
    let info = meta(at: url)
    let remote = info?.path ?? TrackedClouds.remote(forLocal: path) ?? ""
    guard !remote.isEmpty else { return }
    let allocated = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    if allocated <= 8192, info?.state == "evicted" { return }
    let size = info?.size ?? Int64(allocated)
    evict(url: url, remotePath: remote, size: size)
  }

  private static func retryPinBack(_ url: URL, attempt: Int) {
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.35) {
      pinBack(url, force: true, attempt: attempt + 1)
    }
  }
""",
        )

    if "ignoreHolders" not in text:
        replace_between(
            "  private static func isOpen(_ url: URL) -> Bool {",
            "\n  @MainActor\n",
            """  private static let ignoreHolders: Set<String> = [
    "finder",
    "storebase",
    "quicklookd",
    "quicklooksatellite",
    "quicklooksatellite-macos",
    "quicklookuiservice",
    "com.apple.quicklook.thumbnail",
    "qlthumbnailgenerationextension",
    "mds",
    "mds_stores",
    "mdworker",
    "mdworker_shared",
    "iconservicesagent",
    "iconservicesd",
  ]

  private static func isOpen(_ url: URL) -> Bool {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    proc.arguments = ["-n", "-P", "-F", "pc", "--", url.path]
    let out = Pipe()
    proc.standardOutput = out
    proc.standardError = FileHandle.nullDevice
    do {
      try proc.run()
    } catch {
      return false
    }
    let deadline = Date().addingTimeInterval(0.25)
    while proc.isRunning, Date() < deadline {
      Thread.sleep(forTimeInterval: 0.01)
    }
    if proc.isRunning {
      proc.terminate()
    }
    let raw = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    var command = ""
    for token in raw.split(whereSeparator: \\.isNewline) {
      guard let flag = token.first else { continue }
      let value = String(token.dropFirst())
      if flag == "c" {
        command = value
      } else if flag == "p" {
        command = ""
      }
      if flag == "c", isRealHolder(command) {
        return true
      }
    }
    return false
  }

  private static func isRealHolder(_ command: String) -> Bool {
    let name = URL(fileURLWithPath: command).lastPathComponent.lowercased()
    if ignoreHolders.contains(name) { return false }
    if name.contains("quicklook") || name.contains("thumbnail") { return false }
    if name.contains("storebase") { return false }
    return !name.isEmpty
  }

""",
        )

    if "draggingFiles" not in text:
        replace_between(
            "enum StubAccess {",
            "\n@MainActor\n",
            r'''enum StubAccess {
  private static let gate = Gate()
  private static var started = false
  private static var timer: DispatchSourceTimer?
  private static var monitors: [Any] = []
  private static var draggingFiles = false

  static func start() {
    let already = gate.sync { () -> Bool in
      if started { return true }
      started = true
      return false
    }
    guard !already else { return }
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "app.storebase.access"))
    timer.schedule(deadline: .now() + 0.35, repeating: 0.35, leeway: .milliseconds(80))
    timer.setEventHandler {
      CloudStub.scanDroppedCopies()
      DispatchQueue.main.async {
        pollDrag()
        pollFinderSelection()
      }
    }
    timer.resume()
    self.timer = timer
    DispatchQueue.main.async { installMonitors() }
  }

  private static func installMonitors() {
    let dragged: (NSEvent) -> Void = { _ in
      draggingFiles = true
      pollDrag()
      pollFinderSelection()
    }
    let clicked: (NSEvent) -> Void = { _ in
      pollFinderSelection()
    }
    if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDragged], handler: dragged) {
      monitors.append(monitor)
    }
    if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp], handler: clicked) {
      monitors.append(monitor)
    }
    if let monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged], handler: { event in
      dragged(event)
      return event
    }) {
      monitors.append(monitor)
    }
    if let monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp], handler: { event in
      clicked(event)
      return event
    }) {
      monitors.append(monitor)
    }
  }

  private static func pollDrag() {
    let mouseDown = (NSEvent.pressedMouseButtons & 1) != 0
    let pasteboard = NSPasteboard(name: .drag)
    var urls: [URL] = []
    if mouseDown, draggingFiles {
      if let names = pasteboard.propertyList(forType: NSPasteboard.PasteboardType("NSFilenamesPboardType")) as? [String] {
        urls.append(contentsOf: names.map { URL(fileURLWithPath: $0) })
      }
      if let items = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] {
        urls.append(contentsOf: items)
      }
    }
    if !mouseDown {
      draggingFiles = false
    }
    let paths = Set(urls.map { $0.standardizedFileURL.path })
    let gone = CloudStub.replaceDrag(paths)
    if !urls.isEmpty {
      CloudStub.requestMaterialize(urls, unpinCopies: false)
    }
    CloudStub.pinBack(paths: gone, force: !mouseDown)
  }

  private static func pollFinderSelection() {
    DispatchQueue.global(qos: .userInitiated).async {
      let source = """
      tell application "Finder"
        try
          set sel to (get selection)
          set out to ""
          repeat with f in sel
            try
              set out to out & POSIX path of (f as alias) & linefeed
            end try
          end repeat
          return out
        on error
          return "__sb_sel_error__"
        end try
      end tell
      """
      var err: NSDictionary?
      guard let script = NSAppleScript(source: source) else { return }
      let result = script.executeAndReturnError(&err)
      guard err == nil, let text = result.stringValue, text != "__sb_sel_error__" else { return }
      let urls = text
        .split(whereSeparator: \.isNewline)
        .map { URL(fileURLWithPath: String($0)) }
      let paths = Set(urls.map { $0.standardizedFileURL.path })
      let gone = CloudStub.replaceSelection(paths)
      if !urls.isEmpty {
        CloudStub.requestMaterialize(urls, unpinCopies: false)
      }
      CloudStub.pinBack(paths: gone, force: true)
    }
  }
}
''',
        )

    path.write_text(text)
    print("Patched", path)

text = path.read_text()
if "bindOpener(url)\n      applyFinderTag(url)\n      applyComment(url)" in text:
    text = text.replace(
        "      bindOpener(url)\n      applyFinderTag(url)\n      applyComment(url)",
        "      stripOpener(url)\n      applyFinderTag(url)\n      applyComment(url)",
        1,
    )
    path.write_text(text)
    print("Stopped binding Open With on hydrated files")

app = root / "macos/Storebase/StorebaseApp.swift"
if app.exists():
    app_text = app.read_text()
    if "hideForFileHandoff" not in app_text:
        app_text = app_text.replace(
            "    NSApp.setActivationPolicy(.regular)\n    Task { @MainActor in\n      self.installStatusItem()\n    }",
            """    NSApp.setActivationPolicy(.regular)
    if let model = AppRuntime.model {
      attach(model)
      model.startRuntime()
    }
    Task { @MainActor in
      self.installStatusItem()
    }""",
        )
        app_text = app_text.replace(
            """  func application(_ application: NSApplication, open urls: [URL]) {
    CloudStub.enqueue(urls)
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag {
      NSApp.windows.first(where: { $0.title == "Storebase" })?.makeKeyAndOrderFront(nil)
    }
    sender.activate(ignoringOtherApps: true)
    return true
  }
""",
            """  func application(_ application: NSApplication, open urls: [URL]) {
    hideForFileHandoff()
    CloudStub.enqueue(urls)
  }

  func hideForFileHandoff() {
    for window in NSApp.windows where window.title == "Storebase" || window.identifier?.rawValue == "main" {
      window.orderOut(nil)
    }
    NSApp.hide(nil)
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    NSApp.unhide(nil)
    NSApp.windows.first(where: { $0.title == "Storebase" })?.makeKeyAndOrderFront(nil)
    sender.activate(ignoringOtherApps: true)
    return true
  }
""",
        )
        app.write_text(app_text)
        print("Patched", app)

text = path.read_text()
if "AppDelegate.shared?.hideForFileHandoff()" not in text and "completionHandler: nil)" in text:
    text = text.replace(
        "completionHandler: nil)",
        """completionHandler: { _, _ in
      DispatchQueue.main.async { AppDelegate.shared?.hideForFileHandoff() }
    })""",
    )
    path.write_text(text)
    print("Hide Storebase after handing the file off")

dmg = root / "macos/make-dmg.sh"
if dmg.exists():
    dmg_text = dmg.read_text()
    old = """osascript -e 'tell application "Storebase" to quit' >/dev/null 2>&1 || true
killall -9 Storebase >/dev/null 2>&1 || true
sleep 1
"""
    new = """echo "Stopping any running Storebase…"
killall -9 Storebase >/dev/null 2>&1 || true
killall -9 xcodebuild >/dev/null 2>&1 || true
sleep 1
"""
    if old in dmg_text:
        dmg.write_text(dmg_text.replace(old, new, 1))
        print("Patched", dmg)

for rel in (
    "macos/Storebase/Info.plist",
    "macos/Storebase/MainWindow.swift",
    "macos/make-dmg.sh",
    "macos/README.md",
):
    target = root / rel
    if not target.exists():
        continue
    body = target.read_text()
    updated = body.replace("1.14", "1.16").replace("1.15", "1.16")
    if "<string>23</string>" in updated and "CFBundleVersion" in updated:
        updated = updated.replace("<string>23</string>", "<string>25</string>")
    if "<string>24</string>" in updated and "CFBundleVersion" in updated:
        updated = updated.replace("<string>24</string>", "<string>25</string>")
    if updated != body:
        target.write_text(updated)
        print("Bumped", target)

pbx = root / "macos/Storebase.xcodeproj/project.pbxproj"
if pbx.exists():
    body = pbx.read_text()
    updated = (
        body.replace("CURRENT_PROJECT_VERSION = 23;", "CURRENT_PROJECT_VERSION = 25;")
        .replace("CURRENT_PROJECT_VERSION = 24;", "CURRENT_PROJECT_VERSION = 25;")
        .replace("MARKETING_VERSION = 1.14;", "MARKETING_VERSION = 1.16;")
        .replace("MARKETING_VERSION = 1.15;", "MARKETING_VERSION = 1.16;")
    )
    if updated != body:
        pbx.write_text(updated)
        print("Bumped", pbx)
