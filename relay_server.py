#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import json, queue, threading, time, os

ROOT = Path(__file__).resolve().parent
clients = {}  # (room, client_id) -> Queue
lock = threading.Lock()

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = urlparse(path).path.lstrip('/')
        if not clean:
            clean = 'multiplayer.html'
        return str(ROOT / clean)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != '/events':
            return super().do_GET()
        qs = parse_qs(parsed.query)
        room = (qs.get('room') or [''])[0].upper()
        cid = (qs.get('client') or [''])[0]
        if not room or not cid:
            self.send_error(400, 'room and client are required')
            return
        q = queue.Queue()
        key = (room, cid)
        with lock:
            clients[key] = q
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            self.wfile.write(b'event: connected\ndata: {}\n\n')
            self.wfile.flush()
            while True:
                try:
                    payload = q.get(timeout=15)
                    data = json.dumps(payload, separators=(',', ':')).encode()
                    self.wfile.write(b'data: ' + data + b'\n\n')
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with lock:
                if clients.get(key) is q:
                    clients.pop(key, None)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/send':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            body = json.loads(self.rfile.read(length) or b'{}')
            room = str(body.get('room','')).upper()
            sender = str(body.get('sender',''))
            target = body.get('target')
            message = body.get('message')
            if not room or not sender or not isinstance(message, dict):
                raise ValueError('invalid payload')
        except Exception as e:
            self.send_error(400, str(e))
            return
        envelope = {'sender': sender, 'message': message, 'ts': int(time.time()*1000)}
        delivered = 0
        with lock:
            for (r, cid), q in list(clients.items()):
                if r != room or cid == sender:
                    continue
                if target and cid != target:
                    continue
                q.put(envelope)
                delivered += 1
        data = json.dumps({'ok': True, 'delivered': delivered}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if '/events' not in self.path:
            super().log_message(fmt, *args)

def main():
    os.chdir(ROOT)
    host = os.environ.get('POLKACREW_HOST', '0.0.0.0')
    port = int(os.environ.get('POLKACREW_PORT', '8765'))
    print(f'PolkaCrew relay running on http://localhost:{port}')
    print('LAN players can use this computer\'s local IP with the same port.')
    ThreadingHTTPServer((host, port), Handler).serve_forever()

if __name__ == '__main__':
    main()
