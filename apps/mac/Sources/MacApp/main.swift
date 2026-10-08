import AppKit

/// Minimal windowed shell so `swift run MacApp` shows a real window. The
/// editor view lands here once EditorCore passes the bench gate — this target
/// stays a stub until then, per plans/native-plan-of-plans.md.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.title = "Fregat"
    window.titlebarAppearsTransparent = true
    window.center()
    window.makeKeyAndOrderFront(nil)
    self.window = window
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate()
app.run()
