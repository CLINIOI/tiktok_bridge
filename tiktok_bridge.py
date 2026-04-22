#!/usr/bin/env python3
"""
TikTok Studio Local Bridge
Runs on 127.0.0.1:8765
Token: 1224444
"""

import http.server
import os
import mimetypes
import json
import urllib.parse

TOKEN = "1224444"
HOST = "127.0.0.1"
PORT = 8765


class BridgeHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"[Bridge] {self.address_string()} - {format % args}")

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")

    def check_token(self):
        token = self.headers.get("X-Token", "")
        if token != TOKEN:
            self.send_response(403)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid token"}).encode())
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # Health check — no token required
        if path == "/health":
            self.send_response(200)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "bridge": "TikTok Studio Bridge v1.0"}).encode())
            return

        if not self.check_token():
            return

        # Check if file exists
        if path == "/check":
            file_path = qs.get("path", [""])[0]
            file_path = urllib.parse.unquote(file_path)
            if not file_path:
                self.send_response(400)
                self.send_cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "No path provided"}).encode())
                return
            exists = os.path.isfile(file_path)
            size = os.path.getsize(file_path) if exists else 0
            self.send_response(200)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "exists": exists,
                "path": file_path,
                "size": size
            }).encode())
            return

        # Serve video file
        if path == "/file":
            file_path = qs.get("path", [""])[0]
            file_path = urllib.parse.unquote(file_path)
            if not file_path or not os.path.isfile(file_path):
                self.send_response(404)
                self.send_cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "File not found", "path": file_path}).encode())
                return
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                mime_type = "application/octet-stream"
            file_size = os.path.getsize(file_path)
            filename = os.path.basename(file_path)
            self.send_response(200)
            self.send_cors()
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Content-Disposition", f'inline; filename="{filename}"')
            self.end_headers()
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return

        # Unknown route
        self.send_response(404)
        self.send_cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Unknown endpoint"}).encode())


if __name__ == "__main__":
    server = http.server.HTTPServer((HOST, PORT), BridgeHandler)
    print(f"[Bridge] TikTok Studio Bridge started on http://{HOST}:{PORT}")
    print(f"[Bridge] Token: {TOKEN}")
    print(f"[Bridge] Endpoints:")
    print(f"  GET /health          — проверка работы (без токена)")
    print(f"  GET /check?path=...  — проверить существование файла")
    print(f"  GET /file?path=...   — отдать видеофайл браузеру")
    print(f"[Bridge] Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Bridge] Stopped.")
