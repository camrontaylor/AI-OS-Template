// Renders the command-centre app/launcher icon as a generic AI-OS mark.
// Usage: swift make-icon.swift <output.png> (default: logo.png)

import Cocoa
import WebKit

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "logo.png"
let size: CGFloat = 1024

let svg = """
<svg width="\(Int(size))" height="\(Int(size))" viewBox="0 0 \(Int(size)) \(Int(size))" xmlns="http://www.w3.org/2000/svg">
  <rect width="\(Int(size))" height="\(Int(size))" rx="228" fill="#0b0b0c"/>
  <rect x="184" y="184" width="656" height="656" rx="168" fill="none" stroke="#ffffff" stroke-width="72"/>
  <path d="M342 688L456 336H568L682 688" fill="none" stroke="#ffffff" stroke-width="76" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M400 552H624" stroke="#ffffff" stroke-width="72" stroke-linecap="round"/>
</svg>
"""

let html = "<html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>\(svg)</body></html>"

final class Renderer: NSObject, WKNavigationDelegate {
    let window: NSWindow
    let webView: WKWebView

    override init() {
        let frame = NSRect(x: 0, y: 0, width: size, height: size)
        webView = WKWebView(frame: frame)
        webView.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = webView
        super.init()
        webView.navigationDelegate = self
    }

    func render() {
        window.orderFrontRegardless()
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            let config = WKSnapshotConfiguration()
            config.rect = NSRect(x: 0, y: 0, width: size, height: size)
            webView.takeSnapshot(with: config) { image, _ in
                guard let image = image,
                      let tiff = image.tiffRepresentation,
                      let bitmap = NSBitmapImageRep(data: tiff),
                      let png = bitmap.representation(using: .png, properties: [:]) else {
                    FileHandle.standardError.write("snapshot failed\n".data(using: .utf8)!)
                    exit(1)
                }

                do {
                    try png.write(to: URL(fileURLWithPath: outPath))
                    print("wrote \(outPath) (\(bitmap.pixelsWide)x\(bitmap.pixelsHigh))")
                    exit(0)
                } catch {
                    FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!)
                    exit(1)
                }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let renderer = Renderer()
renderer.render()
app.run()
