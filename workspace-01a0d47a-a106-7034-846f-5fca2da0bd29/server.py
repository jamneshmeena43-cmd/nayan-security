#!/usr/bin/env python3
"""Static server for the NAYAN SECURITY preview. SPA routes fall back to index.html."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
ROUTES = [
    "/", "/services", "/shop", "/shops", "/professionals", "/cart", "/checkout",
    "/orders", "/profile", "/support", "/auth", "/about", "/contact", "/search",
    "/book", "/quote/request", "/quote/sample", "/terms", "/privacy", "/refund",
    "/warranty", "/amc",
]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/sitemap.xml":
            host = self.headers.get("Host", "localhost")
            proto = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
            base = f"{proto}://{host}"
            urls = ROUTES + [
                "/services/cctv-installation",
                "/services/cctv-repair",
                "/product/bullet-4mp",
                "/packages/pkg-4",
            ]
            body = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"]
            body += [f"<url><loc>{base}{u}</loc></url>" for u in urls]
            body.append("</urlset>")
            data = "\n".join(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/xml; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        local = self.translate_path(path)
        if path != "/" and not os.path.exists(local):
            name = os.path.basename(path)
            if "." not in name:
                self.path = "/index.html"
        return super().do_GET()

if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    print("NAYAN SECURITY preview on http://0.0.0.0:8080", flush=True)
    server.serve_forever()
