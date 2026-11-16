from __future__ import annotations

import io
import os
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from scripts import _fetch


def build_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for index in range(3):
            archive.writestr(f"file{index}.xml", os.urandom(300_000))
    return buffer.getvalue()


PAYLOAD = build_zip()


def make_handler(mode: str, state: dict):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep the test output quiet
            pass

        def do_GET(self):
            state["hits"] += 1
            if mode == "html":
                body = b"<html><body>Access denied</body></html>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if mode == "not_found":
                self.send_error(404)
                return

            range_header = self.headers.get("Range")
            if range_header and mode == "cut_with_range":
                start = int(range_header.split("=")[1].rstrip("-"))
                rest = PAYLOAD[start:]
                self.send_response(206)
                self.send_header("Content-Type", "application/zip")
                self.send_header(
                    "Content-Range", f"bytes {start}-{len(PAYLOAD) - 1}/{len(PAYLOAD)}"
                )
                self.send_header("Content-Length", str(len(rest)))
                self.end_headers()
                self.wfile.write(rest)
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(PAYLOAD)))
            self.end_headers()
            if state["hits"] == 1 and mode in ("cut_with_range", "cut_without_range"):
                self.wfile.write(PAYLOAD[: len(PAYLOAD) * 4 // 10])
                self.wfile.flush()
                self.connection.close()  # the server hangs up at 40 %
            else:
                self.wfile.write(PAYLOAD)

    return Handler


class DownloadZipTests(unittest.TestCase):
    def serve(self, mode: str) -> tuple[str, dict]:
        state = {"hits": 0}
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(mode, state))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}/archive.zip", state

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dest = Path(tmp.name) / "raw" / "archive.zip"
        patcher = mock.patch.object(_fetch.time, "sleep", lambda seconds: None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_clean_success(self):
        self.assertEqual(self.dest.read_bytes(), PAYLOAD)
        self.assertEqual([p.name for p in self.dest.parent.iterdir()], ["archive.zip"])

    def test_normal_download(self):
        url, state = self.serve("ok")
        _fetch.download_zip(url, self.dest)
        self.assertEqual(state["hits"], 1)
        self.assert_clean_success()

    def test_resumes_after_a_cut_connection(self):
        url, state = self.serve("cut_with_range")
        _fetch.download_zip(url, self.dest, attempts=3)
        self.assertEqual(state["hits"], 2)
        self.assert_clean_success()

    def test_restarts_when_the_server_ignores_range(self):
        url, state = self.serve("cut_without_range")
        _fetch.download_zip(url, self.dest, attempts=3)
        self.assertEqual(state["hits"], 2)
        self.assert_clean_success()

    def test_html_answer_is_rejected_and_nothing_is_left_behind(self):
        url, state = self.serve("html")
        with self.assertRaisesRegex(_fetch.DownloadError, "instead of a ZIP"):
            _fetch.download_zip(url, self.dest, attempts=2)
        self.assertEqual(state["hits"], 2)
        self.assertEqual(list(self.dest.parent.iterdir()), [])

    def test_not_found_fails_at_once(self):
        url, state = self.serve("not_found")
        with self.assertRaisesRegex(_fetch.DownloadError, "HTTP 404"):
            _fetch.download_zip(url, self.dest, attempts=5)
        self.assertEqual(state["hits"], 1)
        self.assertFalse(self.dest.exists())

    def test_truncated_zip_is_rejected_even_without_a_size_header(self):
        truncated = self.dest.with_name("truncated.zip.part")
        truncated.parent.mkdir(parents=True)
        truncated.write_bytes(PAYLOAD[: len(PAYLOAD) // 2])
        with self.assertRaises(_fetch.InvalidArchive):
            _fetch._check_zip(truncated)


if __name__ == "__main__":
    unittest.main()
