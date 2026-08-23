"""Serve the semantic-network site over localhost and open it in a browser."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from threading import Timer
import sys


PROJECT_DIR = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}/?v=20260823-1"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def open_page():
    os.startfile(URL)


if __name__ == "__main__":
    handler = partial(NoCacheHandler, directory=str(PROJECT_DIR))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    print(f"FQL Semantic Network: {URL}", flush=True)
    print("Keep this window open. Close it or press Ctrl+C to stop.", flush=True)
    if "--no-browser" not in sys.argv and os.environ.get("SEMANTIC_NETWORK_NO_BROWSER") != "1":
        Timer(0.8, open_page).start()
    server.serve_forever()
