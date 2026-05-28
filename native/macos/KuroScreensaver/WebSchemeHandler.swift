import Foundation
import WebKit

/// Serves the bundled `web/` folder under `kuro://local/` so the WebView can
/// load ES modules with a real query string. Loading from `file://` blocks
/// module scripts, and a query string on a file URL is unreliable — a custom
/// scheme avoids both. This mirrors the Windows host's virtual-host mapping.
final class WebSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "kuro"

    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        // kuro://local/<path> → <root>/<path> (query ignored for file lookup).
        var rel = url.path
        if rel.hasPrefix("/") { rel.removeFirst() }
        if rel.isEmpty { rel = "screensaver.html" }

        let fileURL = root.appendingPathComponent(rel).standardizedFileURL

        // Never serve outside the bundled web root.
        guard fileURL.path.hasPrefix(root.path) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }
        guard let data = try? Data(contentsOf: fileURL) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": Self.mime(for: fileURL.pathExtension),
                "Content-Length": String(data.count),
                "Cache-Control": "no-store",
            ]
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // Synchronous handler — nothing to cancel.
    }

    private static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs":   return "text/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "wasm":        return "application/wasm"
        case "svg":         return "image/svg+xml"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif":         return "image/gif"
        case "ico":         return "image/x-icon"
        case "woff2":       return "font/woff2"
        case "woff":        return "font/woff"
        case "ttf":         return "font/ttf"
        default:            return "application/octet-stream"
        }
    }
}
