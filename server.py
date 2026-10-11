"""Local development server; production uses Gunicorn (see README)."""
import os
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from backend.app import app


class ThreadedServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8780'))
    print(f'WorkMood: http://127.0.0.1:{port}', flush=True)
    with make_server('127.0.0.1', port, app, server_class=ThreadedServer, handler_class=QuietHandler) as server:
        server.serve_forever()
