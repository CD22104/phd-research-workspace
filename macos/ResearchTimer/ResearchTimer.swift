import AppKit
import WebKit

final class ResearchTimer: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSMenuDelegate {
    private let site = URL(string: "https://choose-project-name.pages.dev")!
    private var status: NSStatusItem!
    private var bridgeLoaded = false
    private var bridgeReady = false
    private var lastBridgeError = ""
    private var iconOnly = UserDefaults.standard.bool(forKey: "menuIconOnly")
    private let statusSummary = NSTextField(labelWithString: "正在准备菜单栏…")
    private var iconToggle: NSButton!
    private var lastDiagnostic = ""
    private var window: NSWindow!
    private var web: WKWebView!
    private var ticker: Timer?
    private var poller: Timer?
    private var focus: [String: Any]?
    private var background: [[String: Any]] = []
    private var lastSync: Date?
    private var elapsedAtSync: Double = 0
    private var serverAtSync = Date()
    private var message = "请打开工作台登录"
    private let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildApplicationMenu()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "researchTimer")
        if let path = Bundle.main.path(forResource: "bridge", ofType: "js"), let script = try? String(contentsOfFile: path, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            bridgeLoaded = true
        }
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1140, height: 780), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "研究工作台 · 菜单栏计时"
        window.minSize = NSSize(width: 780, height: 480)
        installWindowContent()
        window.isReleasedWhenClosed = false; window.center()
        installStatusItem()
        web.load(URLRequest(url: site))
        ticker = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.renderTitle() }
        poller = Timer(timeInterval: 30, repeats: true) { [weak self] _ in self?.sync() }
        RunLoop.main.add(ticker!, forMode: .common); RunLoop.main.add(poller!, forMode: .common)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(woke), name: NSWorkspace.didWakeNotification, object: nil)
        renderTitle(); rebuildMenu()
        // Show the repair controls on the first launch of this version, even for existing users.
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.1.0"
        if !UserDefaults.standard.bool(forKey: "hasAuthenticated") || UserDefaults.standard.string(forKey: "shownVersion") != version {
            showWorkspace(); UserDefaults.standard.set(version, forKey: "shownVersion")
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWorkspace(); return true }
    func applicationWillTerminate(_ notification: Notification) {
        ticker?.invalidate(); poller?.invalidate(); NSWorkspace.shared.notificationCenter.removeObserver(self)
    }
    private func date(_ value: Any?) -> Date? {
        guard let s = value as? String else { return nil }
        return formatter.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
    private func clock(_ seconds: Double) -> String {
        let n = Int(max(0, seconds)); return n >= 3600 ? String(format: "%d:%02d:%02d", n / 3600, n / 60 % 60, n % 60) : String(format: "%02d:%02d", n / 60, n % 60)
    }
    private var connected: Bool { message.isEmpty && lastSync.map { Date().timeIntervalSince($0) < 95 } == true }
    private var paused: Bool { focus?["paused"] as? Bool ?? false }
    private var focusSeconds: Double { elapsedAtSync + (paused ? 0 : max(0, Date().timeIntervalSince(lastSync ?? Date()))) }
    private func label(_ row: [String: Any]) -> String { row["label"] as? String ?? row["task_title"] as? String ?? "专注计时" }
    private func installStatusItem() {
        if let old = status { NSStatusBar.system.removeStatusItem(old) }
        // A positive initial width avoids relying on text-driven layout before the first sync.
        let item = NSStatusBar.system.statusItem(withLength: 54)
        item.autosaveName = NSStatusItem.AutosaveName("ResearchTimer.Main.v2")
        item.isVisible = true
        status = item
        status.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        status.button?.setAccessibilityLabel("研究工作台计时")
        renderTitle(); rebuildMenu()
    }
    private func renderTitle() {
        guard let status = status, let button = status.button else { return }
        let hasFocus = connected && focus != nil
        // Keep the menu bar compact; task names and background counts stay in the menu.
        let title = hasFocus && !iconOnly ? clock(focusSeconds) : ""
        let symbol: String? = title.isEmpty ? (hasFocus && paused ? "pause.circle" : "timer") : (paused ? "pause.fill" : nil)
        if let symbol = symbol {
            let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "研究计时")
            image?.isTemplate = true; image?.size = NSSize(width: 14, height: 14); button.image = image
        } else { button.image = nil }
        button.imagePosition = title.isEmpty ? .imageOnly : .imageLeft
        button.title = title
        let font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        let textWidth = (title as NSString).size(withAttributes: [.font: font]).width
        status.length = title.isEmpty ? 26 : max(44, ceil(textWidth + (symbol == nil ? 16 : 34)))
        button.needsDisplay = true
        let syncDescription = connected ? "同步正常" : (message.isEmpty ? "同步已过期" : message)
        let focusDescription = hasFocus ? "\(paused ? "已暂停" : "专注") \(clock(focusSeconds))" : (connected ? "无专注计时" : "未收到计时")
        button.toolTip = "研究工作台 · " + focusDescription + " · " + syncDescription + (background.isEmpty ? "" : " · 后台 \(background.count) 项")
        statusSummary.stringValue = "菜单栏：" + focusDescription + " · " + syncDescription
        statusSummary.toolTip = button.toolTip
        window?.subtitle = "v1.1.0 · " + focusDescription
        saveDiagnosticsIfChanged()
    }
    private func installWindowContent() {
        let container = NSView()
        let bar = NSVisualEffectView(); bar.material = .headerView; bar.blendingMode = .withinWindow
        statusSummary.font = NSFont.systemFont(ofSize: 12)
        statusSummary.lineBreakMode = .byTruncatingTail
        statusSummary.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        statusSummary.setContentHuggingPriority(.defaultLow, for: .horizontal)
        iconToggle = NSButton(checkboxWithTitle: "仅图标", target: self, action: #selector(toggleIconOnly(_:)))
        iconToggle.state = iconOnly ? .on : .off
        iconToggle.toolTip = "菜单栏拥挤时缩成一个图标；完整计时仍可在菜单内查看"
        let restore = NSButton(title: "重新显示菜单栏", target: self, action: #selector(restoreStatusItem))
        let diagnostic = NSButton(title: "复制诊断", target: self, action: #selector(copyDiagnostics))
        let quitButton = NSButton(title: "退出", target: self, action: #selector(quit))
        let controls = NSStackView(views: [statusSummary, iconToggle, restore, diagnostic, quitButton])
        controls.orientation = .horizontal; controls.alignment = .centerY; controls.spacing = 10
        container.addSubview(bar); bar.addSubview(controls); container.addSubview(web)
        bar.translatesAutoresizingMaskIntoConstraints = false
        controls.translatesAutoresizingMaskIntoConstraints = false
        web.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: container.topAnchor), bar.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: container.trailingAnchor), bar.heightAnchor.constraint(equalToConstant: 46),
            controls.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 12), controls.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -12),
            controls.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            web.topAnchor.constraint(equalTo: bar.bottomAnchor), web.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: container.trailingAnchor), web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        window.contentView = container
    }
    private func buildApplicationMenu() {
        let main = NSMenu()
        let appEntry = NSMenuItem(); let appMenu = NSMenu()
        let quitItem = item("退出 Research Timer", action: #selector(quit)); quitItem.keyEquivalent = "q"
        appMenu.addItem(quitItem); appEntry.submenu = appMenu; main.addItem(appEntry)
        let editEntry = NSMenuItem(title: "编辑", action: nil, keyEquivalent: ""); let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("剪切", "cut:", "x"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: NSSelectorFromString(selector), keyEquivalent: key))
        }
        editEntry.submenu = editMenu; main.addItem(editEntry); NSApp.mainMenu = main
    }
    @objc private func toggleIconOnly(_ sender: Any?) {
        iconOnly.toggle(); UserDefaults.standard.set(iconOnly, forKey: "menuIconOnly")
        iconToggle?.state = iconOnly ? .on : .off; renderTitle(); rebuildMenu()
    }
    @objc private func restoreStatusItem() { installStatusItem(); sync() }
    private var diagnosticsURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "ResearchTimer").appendingPathComponent("menu-diagnostics.txt")
    }
    private func diagnostics() -> String {
        let statusFrame = (status?.button?.window).map { NSStringFromRect($0.frame) } ?? "none"
        let buttonFrame = (status?.button).map { NSStringFromRect($0.frame) } ?? "none"
        let screens = NSScreen.screens.map { NSStringFromRect($0.frame) }.joined(separator: "; ")
        let synced = lastSync.map { formatter.string(from: $0) } ?? "never"
        // No cookies, tokens, task titles or website content are collected.
        return """
        Research Timer \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown")
        macOS: \(ProcessInfo.processInfo.operatingSystemVersionString)
        statusCreated: \(status != nil)
        statusVisibleFlag: \(status?.isVisible ?? false) (does not prove unobstructed screen visibility)
        statusLength: \(status?.length ?? 0)
        buttonFrame: \(buttonFrame)
        statusWindowFrame: \(statusFrame)
        screens: \(screens)
        iconOnly: \(iconOnly)
        bridgeResourceLoaded: \(bridgeLoaded)
        bridgeReady: \(bridgeReady)
        bridgeError: \(lastBridgeError)
        pageHost: \(web?.url?.host ?? "none")
        lastSync: \(synced)
        connected: \(connected)
        focusPresent: \(focus != nil)
        paused: \(paused)
        """
    }
    private func saveDiagnosticsIfChanged() {
        let report = diagnostics(); guard report != lastDiagnostic else { return }; lastDiagnostic = report
        let url = diagnosticsURL
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try report.write(to: url, atomically: true, encoding: .utf8)
        } catch { /* Diagnostics must not prevent timing or the interface from running. */ }
    }
    @objc private func copyDiagnostics() {
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(diagnostics(), forType: .string)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert(); alert.messageText = "诊断信息已复制"; alert.informativeText = "可以直接粘贴发来排查；不包含登录凭证或任务内容。"
        alert.beginSheetModal(for: window)
    }
    private func item(_ title: String, action: Selector? = nil, represented: Any? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: ""); i.target = self; i.representedObject = represented; return i
    }
    private func rebuildMenu() {
        let menu = status.menu ?? NSMenu(); menu.removeAllItems(); menu.delegate = self
        if connected, let r = focus, let id = r["id"] as? Int {
            menu.addItem(item(String(label(r).prefix(70))))
            menu.addItem(item("专注 \(clock(focusSeconds))\(paused ? " · 已暂停" : "")"))
            menu.addItem(item(paused ? "继续计时" : "暂停计时", action: #selector(command(_:)), represented: ["action": paused ? "resume" : "pause", "id": id]))
            menu.addItem(item("停止并保存", action: #selector(command(_:)), represented: ["action": "stop", "id": id]))
        } else { menu.addItem(item(connected ? "没有正在进行的专注计时" : (message.isEmpty ? "连接已过期，请刷新" : message))) }
        if connected && !background.isEmpty {
            menu.addItem(.separator())
            menu.addItem(item("后台任务 · 时长单列"))
            for row in background {
                guard let id = row["id"] as? Int else { continue }
                let elapsed = serverAtSync.timeIntervalSince(date(row["start_at"]) ?? serverAtSync) + Date().timeIntervalSince(lastSync ?? Date())
                let entry = item("\(String(label(row).prefix(45))) · \(clock(elapsed))")
                let sub = NSMenu(); sub.addItem(item("结束这项后台任务", action: #selector(command(_:)), represented: ["action": "backgroundStop", "id": id])); entry.submenu = sub; menu.addItem(entry)
            }
        }
        menu.addItem(.separator())
        menu.addItem(item("打开工作台 / 登录", action: #selector(showWorkspace)))
        menu.addItem(item("立即同步", action: #selector(sync)))
        let compact = item("仅显示图标", action: #selector(toggleIconOnly(_:))); compact.state = iconOnly ? .on : .off; menu.addItem(compact)
        menu.addItem(item("重新显示菜单栏", action: #selector(restoreStatusItem)))
        menu.addItem(item("复制诊断", action: #selector(copyDiagnostics)))
        menu.addItem(item("退出小工具（计时保留）", action: #selector(quit)))
        status.menu = menu
    }
    func menuWillOpen(_ menu: NSMenu) { rebuildMenu(); sync() }
    @objc private func showWorkspace() {
        if !message.isEmpty && web.url?.host == site.host { web.reload() }
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func woke() { lastSync = nil; message = "唤醒后正在同步"; renderTitle(); sync() }
    @objc private func sync() {
        guard web.url?.host == site.host else { message = "请打开工作台登录"; renderTitle(); return }
        web.evaluateJavaScript("typeof window.researchTimer === 'object'") { [weak self] value, error in
            guard let self = self else { return }
            self.bridgeReady = value as? Bool == true
            if error != nil || !self.bridgeReady {
                self.lastBridgeError = error == nil ? "bridge_missing" : "bridge_check_failed"
                self.message = "计时连接未就绪，请刷新工作台"; self.renderTitle(); return
            }
            self.web.evaluateJavaScript("window.researchTimer.sync(); void 0") { [weak self] _, error in
                if error != nil { self?.lastBridgeError = "sync_call_failed"; self?.message = "连接中断，请打开工作台重试"; self?.renderTitle() }
            }
        }
    }
    @objc private func command(_ sender: NSMenuItem) {
        guard connected, let payload = sender.representedObject as? [String: Any], let action = payload["action"] as? String, let id = payload["id"] as? Int,
              ["pause", "resume", "stop", "backgroundStop"].contains(action), id > 0 else { return }
        // Only fixed commands and the exact displayed session ID; no credentials leave WebKit.
        web.evaluateJavaScript("window.researchTimer.command('\(action)', \(id)); void 0") { [weak self] _, error in
            if error != nil { self?.message = "操作未确认，请打开工作台核对"; self?.renderTitle() }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https", message.frameInfo.securityOrigin.host == site.host,
              let data = message.body as? [String: Any] else { return }
        guard data["ok"] as? Bool == true else {
            self.message = data["reason"] as? String ?? "同步失败"; renderTitle(); rebuildMenu(); return
        }
        bridgeReady = true; lastBridgeError = ""
        focus = data["running"] as? [String: Any]; background = data["background"] as? [[String: Any]] ?? []
        serverAtSync = date(data["now"]) ?? Date(); lastSync = Date(); self.message = ""
        elapsedAtSync = ((focus?["elapsed_before_ms"] as? NSNumber)?.doubleValue ?? 0) / 1000
        if let r = focus, !paused { elapsedAtSync += max(0, serverAtSync.timeIntervalSince(date(r["start_at"]) ?? serverAtSync)) }
        UserDefaults.standard.set(true, forKey: "hasAuthenticated")
        renderTitle(); rebuildMenu()
    }
    private func allowed(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host else { return false }
        return host == site.host || host.hasSuffix(".cloudflareaccess.com")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if allowed(url) { decisionHandler(.allow) }
        else { if ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { if allowed(url) { web.load(URLRequest(url: url)) } else if ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) } }; return nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { sync() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { message = "连接中断，请打开工作台重试"; renderTitle() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { message = "正在重新连接"; renderTitle(); webView.reload() }
}
let application = NSApplication.shared
let delegate = ResearchTimer()
application.delegate = delegate
application.run()
