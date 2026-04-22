#!/usr/bin/env python3
"""
TikTok Studio Local Bridge
-------------------------------------------------
Локальный HTTP-сервер, который отдаёт видеофайл с диска
в TikTok Studio через userscript (tiktok_studio_helper_light.user.js).

По умолчанию слушает 127.0.0.1:8765.

Конфигурация через переменные окружения (все опциональны):
  TIKTOK_BRIDGE_TOKEN — токен для заголовка X-Token (по умолчанию "1224444")
  TIKTOK_BRIDGE_HOST  — адрес (по умолчанию "127.0.0.1")
  TIKTOK_BRIDGE_PORT  — порт  (по умолчанию 8765)

Endpoints:
  GET /health           — проверка работы (без токена)
  GET /check?path=...   — проверить существование файла
  GET /file?path=...    — отдать видеофайл (поддерживает Range)
"""

from __future__ import annotations

import http.server
import json
import mimetypes
import os
import socketserver
import sys
import urllib.parse
from datetime import datetime

TOKEN = os.environ.get("TIKTOK_BRIDGE_TOKEN", "1224444")
HOST = os.environ.get("TIKTOK_BRIDGE_HOST", "127.0.0.1")
try:
    PORT = int(os.environ.get("TIKTOK_BRIDGE_PORT", "8765"))
except ValueError:
    PORT = 8765

ALLOWED_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg"}
MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024  # 4 GB — лимит TikTok Studio
CHUNK_SIZE = 64 * 1024


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def _log(level: str, msg: str) -> None:
    print(f"[{_ts()}] [{level}] {msg}", flush=True)


class BridgeHandler(http.server.BaseHTTPRequestHandler):
    server_version = "TikTokBridge/1.1"

    # silence default stderr logging — we have our own
    def log_message(self, format, *args):
        return

    # ---------- helpers ----------
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type, Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _check_token(self) -> bool:
        token = self.headers.get("X-Token", "")
        if token != TOKEN:
            _log("WARN", f"Invalid token from {self.address_string()}")
            self._json(403, {"error": "Invalid token"})
            return False
        return True

    @staticmethod
    def _validate_path(raw: str) -> tuple[bool, str, str]:
        """Возвращает (ok, absolute_path, error_message)."""
        if not raw:
            return False, "", "No path provided"
        # Защита от NUL-символов
        if "\x00" in raw:
            return False, "", "Invalid path"
        try:
            abs_path = os.path.abspath(raw)
        except Exception as e:
            return False, "", f"Bad path: {e}"
        if not os.path.isfile(abs_path):
            return False, abs_path, "File not found"
        ext = os.path.splitext(abs_path)[1].lower()
        if ext and ext not in ALLOWED_EXT:
            return False, abs_path, f"Extension {ext!r} not allowed"
        try:
            if os.path.getsize(abs_path) > MAX_FILE_SIZE:
                return False, abs_path, "File too large"
        except OSError as e:
            return False, abs_path, f"Stat failed: {e}"
        return True, abs_path, ""

    # ---------- HTTP methods ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            qs = urllib.parse.parse_qs(parsed.query)

            if path == "/health":
                self._json(200, {
                    "status": "ok",
                    "bridge": "TikTok Studio Bridge v1.1",
                    "time": datetime.now().isoformat(timespec="seconds"),
                })
                return

            if not self._check_token():
                return

            if path == "/check":
                file_path = urllib.parse.unquote(qs.get("path", [""])[0])
                ok, abs_path, err = self._validate_path(file_path)
                if not ok and err == "No path provided":
                    self._json(400, {"error": err})
                    return
                size = os.path.getsize(abs_path) if os.path.isfile(abs_path) else 0
                self._json(200, {
                    "exists": ok,
                    "path": abs_path,
                    "size": size,
                    "error": err or None,
                })
                return

            if path == "/file":
                file_path = urllib.parse.unquote(qs.get("path", [""])[0])
                ok, abs_path, err = self._validate_path(file_path)
                if not ok:
                    status = 400 if err in ("No path provided", "Invalid path") else 404
                    _log("WARN", f"/file {err}: {file_path}")
                    self._json(status, {"error": err, "path": abs_path})
                    return
                self._serve_file(abs_path)
                return

            self._json(404, {"error": "Unknown endpoint", "path": path})

        except Exception as e:
            _log("ERROR", f"{type(e).__name__}: {e}")
            try:
                self._json(500, {"error": f"{type(e).__name__}: {e}"})
            except Exception:
                pass

    # ---------- file streaming with Range support ----------
    def _serve_file(self, abs_path: str) -> None:
        mime_type, _ = mimetypes.guess_type(abs_path)
        if not mime_type:
            mime_type = "application/octet-stream"
        file_size = os.path.getsize(abs_path)
        filename = os.path.basename(abs_path)
        range_header = self.headers.get("Range", "")

        start = 0
        end = file_size - 1
        status = 200

        if range_header.startswith("bytes="):
            try:
                rng = range_header[6:].split(",")[0].strip()
                parts = rng.split("-")
                if parts[0]:
                    start = int(parts[0])
                if len(parts) > 1 and parts[1]:
                    end = int(parts[1])
                if start > end or start >= file_size:
                    self.send_response(416)
                    self._cors()
                    self.send_header("Content-Range", f"bytes */{file_size}")
                    self.end_headers()
                    return
                end = min(end, file_size - 1)
                status = 206
            except ValueError:
                status = 200
                start = 0
                end = file_size - 1

        length = end - start + 1
        _log("INFO", f"/file {filename} ({length} B, status={status})")

        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Disposition", f'inline; filename="{filename}"')
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        try:
            with open(abs_path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            _log("WARN", f"Client disconnected while serving {filename}")
        except Exception as e:
            _log("ERROR", f"Stream failed for {filename}: {e}")


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    try:
        server = ThreadedHTTPServer((HOST, PORT), BridgeHandler)
    except OSError as e:
        _log("ERROR", f"Cannot bind {HOST}:{PORT} — {e}")
        return 1

    print("=" * 56)
    print(f"  TikTok Studio Bridge started on http://{HOST}:{PORT}")
    print(f"  Token: {TOKEN}")
    print("  Endpoints:")
    print("    GET /health          — проверка работы (без токена)")
    print("    GET /check?path=...  — проверить существование файла")
    print("    GET /file?path=...   — отдать видеофайл (поддерживает Range)")
    print(f"  Allowed extensions: {', '.join(sorted(ALLOWED_EXT))}")
    print("  Press Ctrl+C to stop.")
    print("=" * 56)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
        _log("INFO", "Stopped by user")
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
