// Command Centre - native macOS shell for the AI-OS command centre.
// A thin WKWebView window onto the locally running server (http://localhost:3000).
// The server itself is supervised by the local Command Centre launcher;
// this app is just the window, with auto-retry while the server cold-starts.

import Cocoa
import WebKit

let TARGET_URL = "http://localhost:3000"

final class WebVC: NSViewController, WKNavigationDelegate {
    var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1400, height: 900), configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        self.view = webView
        // Wipe any stale HTTP cache (CSS/JS) on launch so the app can never show
        // an old build. localStorage is kept, so theme + workspace persist.
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeFetchCache,
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: cacheTypes, modifiedSince: Date(timeIntervalSince1970: 0)) { [weak self] in
            self?.load()
        }
    }

    func load() {
        if let url = URL(string: TARGET_URL) {
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    func reload() { webView.reloadFromOrigin() }

    // Server may be cold-starting (launchd dev server). Retry on failure.
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retry() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retry() }

    private func retry() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.load() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var vc: WebVC!

    func applicationDidFinishLaunching(_ notification: Notification) {
        vc = WebVC()
        window = NSWindow(contentViewController: vc)
        window.title = "Command Centre"
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.setContentSize(NSSize(width: 1400, height: 900))
        window.minSize = NSSize(width: 480, height: 600)
        window.setFrameAutosaveName("CommandCentreMainWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    @objc func reload(_ sender: Any?) { vc.reload() }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate

// Menu bar: app (Quit), Edit (copy/paste so the chat inputs work), View (Reload).
let mainMenu = NSMenu()

let appItem = NSMenuItem()
mainMenu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(withTitle: "Hide Command Centre", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Quit Command Centre", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu

let editItem = NSMenuItem()
mainMenu.addItem(editItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
editMenu.addItem(NSMenuItem.separator())
editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
editItem.submenu = editMenu

let viewItem = NSMenuItem()
mainMenu.addItem(viewItem)
let viewMenu = NSMenu(title: "View")
let reloadItem = NSMenuItem(title: "Reload", action: #selector(AppDelegate.reload(_:)), keyEquivalent: "r")
reloadItem.target = delegate
viewMenu.addItem(reloadItem)
viewItem.submenu = viewMenu

app.mainMenu = mainMenu
app.run()
