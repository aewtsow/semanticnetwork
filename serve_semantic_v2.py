"""Quiet local-only server; aborted obsolete worker requests are expected."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

class LocalHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if not self.path.split('?')[0].endswith('.bin'):
            self.send_header('Cache-Control','no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        # Thousands of successful row requests should not fill a terminal pipe.
        if args and str(args[1] if len(args)>1 else '') not in ('200','304'):
            super().log_message(format,*args)

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Cancelling a stale worker intentionally disconnects requests.

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    args=parser.parse_args()
    handler=partial(LocalHandler,directory=str(Path(__file__).resolve().parent))
    with ThreadingHTTPServer(('127.0.0.1',args.port),handler) as server:
        print(f'Local semantic network: http://127.0.0.1:{args.port}',flush=True)
        try: server.serve_forever()
        except KeyboardInterrupt: pass
