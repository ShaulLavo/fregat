import AppKit
import CryptoKit
import WebKit
import UniformTypeIdentifiers

// A negligible behind-window effect keeps live wallpaper updating.
private let liveDesktopAlpha: CGFloat = 0.0001

private func emit(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
    FileHandle.standardOutput.write(data + Data([0x0a]))
}

private func diagnostic(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

@MainActor
private func persistentStore(_ directory: String) -> WKWebsiteDataStore {
    guard #available(macOS 14.0, *) else { return .default() }
    let canonical = (directory as NSString).standardizingPath
    let path = (canonical as NSString).resolvingSymlinksInPath
    var bytes = Array(SHA256.hash(data: Data(path.utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x80
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    let identifier = UUID(uuid: (
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    ))
    // WebKit owns the disk location; the state home selects its persistent store.
    return WKWebsiteDataStore(forIdentifier: identifier)
}

private struct WindowOptions {
    let directory: String
    let vibrant: Bool

    init?(_ arguments: ArraySlice<String>) {
        var directory: String?
        var vibrant = false
        var remaining = arguments.makeIterator()
        while let option = remaining.next() {
            if option == "--data-dir", directory == nil, let value = remaining.next() {
                directory = value
                continue
            }
            if option == "--vibrancy", !vibrant {
                vibrant = true
                continue
            }
            return nil
        }
        guard let directory, (directory as NSString).isAbsolutePath else { return nil }
        self.directory = directory
        self.vibrant = vibrant
    }
}

@MainActor
private final class PlatformHost: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow?
    private var view: WKWebView?
    private var effect: NSVisualEffectView?
    private var glassEffect: NSView?
    private var fullscreenTarget: Bool?
    private var appURL: URL?
    private var startupScript: WKUserScript?
    private var picker: NSOpenPanel?
    private var mouseDown: NSEvent?
    private var mouseMonitor: Any?
    private var input: DispatchSourceRead?
    private var pendingInput = Data()
    private var cancelling = false
    private var closed = false
    var standalone = false
    private(set) var exitCode: Int32 = 0

    private func mountContentView(_ child: NSView) {
        guard let content = window?.contentView else { return }
        // Outset the glass rim beyond the content layer's clip.
        let outset: CGFloat = child === glassEffect ? 4 : 0
        child.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(child)
        NSLayoutConstraint.activate([
            child.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: -outset),
            child.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: outset),
            child.topAnchor.constraint(equalTo: content.topAnchor, constant: -outset),
            child.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: outset),
        ])
    }

    private func windowStateSource() -> String? {
        guard let window, let appURL,
              let data = try? JSONSerialization.data(withJSONObject: appURL.absoluteString, options: .fragmentsAllowed),
              let url = String(data: data, encoding: .utf8) else { return nil }
        // AppKit's style mask settles after animation; Will callbacks carry the target.
        let fullscreen = fullscreenTarget ?? window.styleMask.contains(.fullScreen)
        return """
        (() => { if (location.origin !== new URL(\(url)).origin) return;
        const apply = () => { document.documentElement.toggleAttribute('data-native-fullscreen', \(fullscreen)); window.dispatchEvent(new Event('platform-native-window-state')); };
        if (document.documentElement) { apply(); return; }
        const observer = new MutationObserver(() => { if (!document.documentElement) return; observer.disconnect(); apply(); });
        observer.observe(document, { childList: true }); })()
        """
    }

    private func refreshWindowStateScript() {
        guard !closed, let view, let startupScript, let source = windowStateSource() else { return }
        let controller = view.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addUserScript(startupScript)
    }

    private func publishWindowState() {
        guard !closed, let source = windowStateSource() else { return }
        view?.evaluateJavaScript(source, completionHandler: nil)
    }

    private func fullscreenChanged(_ target: Bool?) {
        fullscreenTarget = target
        refreshWindowStateScript()
        publishWindowState()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        refreshWindowStateScript()
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { publishWindowState() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { publishWindowState() }
    func windowWillEnterFullScreen(_ notification: Notification) { fullscreenChanged(true) }
    func windowWillExitFullScreen(_ notification: Notification) { fullscreenChanged(false) }
    func windowDidEnterFullScreen(_ notification: Notification) { fullscreenChanged(nil) }
    func windowDidExitFullScreen(_ notification: Notification) { fullscreenChanged(nil) }
    func windowDidFailToEnterFullScreen(_ window: NSWindow) { fullscreenChanged(nil) }
    func windowDidFailToExitFullScreen(_ window: NSWindow) { fullscreenChanged(nil) }

    func finish() {
        guard !closed else { return }
        closed = true
        input?.cancel()
        input = nil
        picker?.cancel(nil)
        if NSApp.modalWindow != nil { NSApp.abortModal() }
        view?.configuration.userContentController.removeScriptMessageHandler(forName: "platformShell")
        if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
        mouseMonitor = nil
        emit(["event": "closed"])
        NSApp.stop(nil)
        // Wake an idle event loop when stdin closes.
        if let event = NSEvent.otherEvent(with: .applicationDefined, location: .zero,
            modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
            subtype: 0, data1: 0, data2: 0) {
            NSApp.postEvent(event, atStart: false)
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        finish()
        return .terminateCancel
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        finish()
        return true
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        diagnostic("Native web process stopped")
        exitCode = 1
        finish()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        emit(["event": "message", "body": message.body])
    }

    func pick(_ options: [String: Any]) {
        guard picker == nil else { return }
        let panel = NSOpenPanel()
        picker = panel
        let folder = options["mode"] as? String == "folder"
        panel.canChooseDirectories = folder
        panel.canChooseFiles = !folder
        panel.allowsMultipleSelection = options["multiple"] as? Bool ?? false
        panel.title = folder ? "Choose folder" : "Choose file"
        setStartingPath(panel, options: options)
        if !folder, let accept = options["accept"] as? [String] {
            let types = accept.compactMap { item in
                item.hasPrefix(".") ? UTType(filenameExtension: String(item.dropFirst())) : UTType(mimeType: item)
            }
            if !types.isEmpty { panel.allowedContentTypes = types }
        }
        let completed: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            self?.picked(panel, response: response)
        }
        NSApp.activate(ignoringOtherApps: true)
        if let window {
            panel.beginSheetModal(for: window, completionHandler: completed)
            return
        }
        panel.begin(completionHandler: completed)
    }

    private func setStartingPath(_ panel: NSOpenPanel, options: [String: Any]) {
        guard let starting = options["startingPath"] as? String, !starting.isEmpty else { return }
        var directory: ObjCBool = false
        FileManager.default.fileExists(atPath: starting, isDirectory: &directory)
        let path = starting as NSString
        panel.directoryURL = URL(fileURLWithPath: directory.boolValue ? starting : path.deletingLastPathComponent)
        if !directory.boolValue { panel.nameFieldStringValue = path.lastPathComponent }
    }

    private func picked(_ panel: NSOpenPanel, response: NSApplication.ModalResponse) {
        picker = nil
        guard !closed else { return }
        let paths = response == .OK ? panel.urls.filter(\.isFileURL).map(\.path) : []
        if cancelling { emit(["event": "pickCancelled"]) }
        else { emit(["event": "picked", "paths": paths]) }
        cancelling = false
        if standalone { finish() }
    }

    private func setAppearance(_ value: Any) {
        guard let appearance = value as? [String: Any],
              let opacity = appearance["opacity"] as? NSNumber,
              CFGetTypeID(opacity) != CFBooleanGetTypeID(),
              let material = appearance["material"] as? String,
              ["none", "frosted", "glass"].contains(material) else { return }
        let number = opacity.doubleValue
        guard number.isFinite, (0...100).contains(number) else { return }
        let glass = material == "glass" && glassEffect != nil
        // The page owns pane opacity; native materials render at full strength.
        effect?.alphaValue = material == "none" ? liveDesktopAlpha : 1
        effect?.isHidden = glass
        glassEffect?.isHidden = !glass
    }

    private func command(_ command: [String: Any]) {
        guard !closed else { return }
        if let appearance = command["windowAppearance"] { setAppearance(appearance); return }
        if let script = command["eval"] as? String { view?.evaluateJavaScript(script, completionHandler: nil); return }
        if let options = command["pick"] as? [String: Any] { pick(options); return }
        if command["cancelPick"] != nil {
            guard let picker else { emit(["event": "pickCancelled"]); return }
            cancelling = true
            picker.cancel(nil)
            return
        }
        if command["drag"] != nil, let mouseDown {
            window?.performDrag(with: mouseDown)
            self.mouseDown = nil
            return
        }
        if command["close"] != nil { finish() }
    }

    func readCommands() {
        let flags = fcntl(STDIN_FILENO, F_GETFL)
        guard flags >= 0, fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) == 0 else {
            diagnostic("Native input unavailable")
            exitCode = 1
            finish()
            return
        }
        let source = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.readInput() }
        }
        input = source
        source.resume()
    }

    private func readInput() {
        var buffer = [UInt8](repeating: 0, count: 4096)
        let count = read(STDIN_FILENO, &buffer, buffer.count)
        if count == 0 { finish(); return }
        if count < 0 {
            if errno == EAGAIN || errno == EINTR { return }
            exitCode = 1
            finish()
            return
        }
        pendingInput.append(contentsOf: buffer.prefix(count))
        while let newline = pendingInput.firstIndex(of: 0x0a) {
            let line = pendingInput[..<newline]
            let value = try? JSONSerialization.jsonObject(with: line)
            pendingInput.removeSubrange(...newline)
            if let value = value as? [String: Any] { command(value) }
            if closed { return }
        }
    }

    private func mountEffects(_ window: NSWindow) {
        window.isOpaque = false
        window.backgroundColor = .clear
        guard let content = window.contentView else { return }
        content.wantsLayer = true
        content.layer?.isOpaque = false
        content.layer?.backgroundColor = NSColor.clear.cgColor
        content.layer?.masksToBounds = true
        let effect = NSVisualEffectView(frame: content.bounds)
        effect.material = .underWindowBackground
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.alphaValue = liveDesktopAlpha
        effect.isHidden = false
        self.effect = effect
        mountContentView(effect)
        guard #available(macOS 26.0, *),
              let glassClass = NSClassFromString("NSGlassEffectView") as? NSView.Type else { return }
        let glass = glassClass.init(frame: content.bounds)
        // Runtime lookup keeps builds against older SDKs working.
        glass.setValue(0, forKey: "style")
        glass.setValue(0, forKey: "cornerRadius")
        glass.isHidden = true
        glassEffect = glass
        mountContentView(glass)
    }

    func open(_ url: URL, script: String, options: WindowOptions) {
        appURL = url
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 960),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        self.window = window
        window.delegate = self
        window.title = "Fregat"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        if options.vibrant { mountEffects(window) }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = persistentStore(options.directory)
        let source = script + "\n;if (globalThis.platformBridge) globalThis.platformBridge.capabilities.windowGlass = \(glassEffect != nil);"
        startupScript = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        configuration.userContentController.add(self, name: "platformShell")
        let view = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: configuration)
        self.view = view
        view.navigationDelegate = self
        if #available(macOS 13.3, *) { view.isInspectable = true }
        if options.vibrant {
            view.setValue(false, forKey: "drawsBackground")
            if #available(macOS 12.0, *) { view.underPageBackgroundColor = .clear }
            view.layer?.isOpaque = false
            view.layer?.backgroundColor = NSColor.clear.cgColor
        }
        mountContentView(view)
        mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            if event.window === self?.window { self?.mouseDown = event }
            return event
        }
        readCommands()
        refreshWindowStateScript()
        view.load(URLRequest(url: url))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        emit(["event": "ready"])
        NSApp.run()
        window.orderOut(nil)
    }
}

@MainActor
private func installMenu() {
    let menu = NSMenu()
    let appItem = NSMenuItem()
    menu.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Quit Fregat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    let editItem = NSMenuItem()
    menu.addItem(editItem)
    let editMenu = NSMenu(title: "Edit")
    for (title, action, key) in [
        ("Undo", "undo:", "z"), ("Redo", "redo:", "z"), ("Cut", "cut:", "x"),
        ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select all", "selectAll:", "a"),
    ] {
        let item = editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        if title == "Redo" { item.keyEquivalentModifierMask = [.command, .shift] }
    }
    editItem.submenu = editMenu
    NSApp.mainMenu = menu
}

@main
private struct PlatformWebview {
    @MainActor static func main() {
        exit(run())
    }

    @MainActor private static func run() -> Int32 {
        let arguments = CommandLine.arguments
        guard arguments.count >= 3 else {
            diagnostic("usage: platform-webview <url> <init-script-file> --data-dir <absolute-path> [--vibrancy] | pick <options-json> | message <text-file>")
            return 2
        }
        let mode = arguments[1]
        let input = arguments[2]
        let options = WindowOptions(arguments.dropFirst(3))
        if mode != "pick", mode != "message", options == nil {
            diagnostic("Native window options invalid")
            return 2
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let host = PlatformHost()
        app.delegate = host
        installMenu()
        if mode == "pick" {
            guard let value = try? JSONSerialization.jsonObject(with: Data(input.utf8)),
                  let options = value as? [String: Any] else { return 2 }
            host.standalone = true
            host.pick(options)
            host.readCommands()
            app.run()
            return host.exitCode
        }
        guard let text = try? String(contentsOfFile: input, encoding: .utf8) else {
            diagnostic("Native input unavailable")
            return 2
        }
        if mode == "message" {
            let alert = NSAlert()
            alert.messageText = "Fregat could not open"
            alert.informativeText = text
            alert.addButton(withTitle: "Close")
            host.readCommands()
            app.activate(ignoringOtherApps: true)
            alert.runModal()
            host.finish()
            return host.exitCode
        }
        guard let options, let url = URL(string: mode),
              url.scheme == "http" || url.scheme == "https" else { return 2 }
        host.open(url, script: text, options: options)
        return host.exitCode
    }
}
