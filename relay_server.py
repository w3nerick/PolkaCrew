#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import json, queue, threading, time, os, re

ROOT = Path(__file__).resolve().parent
clients = {}       # (room, client_id) -> Queue
client_auth = {}   # (room, client_id) -> unbroadcast client secret
room_hosts = {}    # room -> authoritative client_id
lock = threading.Lock()
MAX_POST_BYTES = 64 * 1024
MAX_CLIENTS_PER_ROOM = 16
ROOM_RE = re.compile(r'^[A-Z0-9]{3,12}$')

HOST_ONLY_TYPES = {
    'host', 'lobby', 'start-secret', 'snapshot', 'match-ended', 'settlement', 'error'
}

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
        if parsed.path == '/health':
            payload = json.dumps({'ok': True, 'service': 'polkacrew-relay', 'version': '0.4'}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(payload)
            return
        if parsed.path != '/events':
            return super().do_GET()
        qs = parse_qs(parsed.query)
        room = (qs.get('room') or [''])[0].upper()
        cid = (qs.get('client') or [''])[0]
        auth = (qs.get('auth') or [''])[0]
        wants_host = (qs.get('host') or ['0'])[0] == '1'
        if not room or not cid or not auth:
            self.send_error(400, 'room, client and auth are required')
            return
        if not ROOM_RE.fullmatch(room) or len(cid) > 128 or len(auth) > 256:
            self.send_error(400, 'invalid room or client identity')
            return

        q = queue.Queue()
        key = (room, cid)
        with lock:
            known_auth = client_auth.get(key)
            if known_auth and known_auth != auth:
                self.send_error(403, 'client identity is already bound to another session secret')
                return
            if key not in clients and sum(1 for r, _ in clients if r == room) >= MAX_CLIENTS_PER_ROOM:
                self.send_error(429, 'room connection limit reached')
                return
            client_auth.setdefault(key, auth)

            if wants_host:
                existing = room_hosts.get(room)
                if existing and existing != cid:
                    self.send_error(409, 'room already has a host')
                    return
                room_hosts[room] = cid
            clients[key] = q

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            payload = json.dumps({'hostId': room_hosts.get(room)}).encode()
            self.wfile.write(b'event: connected\ndata: ' + payload + b'\n\n')
            self.wfile.flush()
            while True:
                try:
                    message = q.get(timeout=15)
                    data = json.dumps(message, separators=(',', ':')).encode()
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
            if length <= 0 or length > MAX_POST_BYTES:
                self.send_error(413, 'payload too large or empty')
                return
            body = json.loads(self.rfile.read(length) or b'{}')
            room = str(body.get('room','')).upper()
            sender = str(body.get('sender',''))
            auth = str(body.get('auth',''))
            target = body.get('target')
            message = body.get('message')
            if not room or not sender or not auth or not isinstance(message, dict):
                raise ValueError('invalid payload')
            if not ROOM_RE.fullmatch(room) or len(sender) > 128 or len(auth) > 256:
                raise ValueError('invalid room or sender identity')
            message_type = str(message.get('type', ''))
        except Exception as error:
            self.send_error(400, str(error))
            return

        with lock:
            key = (room, sender)
            if client_auth.get(key) != auth:
                self.send_error(403, 'sender authentication failed')
                return
            if key not in clients:
                self.send_error(409, 'sender has no active event stream')
                return

            host_id = room_hosts.get(room)
            if message_type in HOST_ONLY_TYPES and sender != host_id:
                self.send_error(403, 'authoritative message rejected: sender is not room host')
                return

            envelope = {'sender': sender, 'message': message, 'ts': int(time.time()*1000)}
            delivered = 0
            for (r, cid), q in list(clients.items()):
                if r != room or cid == sender:
                    continue
                if target and cid != target:
                    continue
                q.put(envelope)
                delivered += 1

        data = json.dumps({'ok': True, 'delivered': delivered, 'hostId': host_id}).encode()
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
    print('v0.4 host-authority + per-client relay authentication are enabled.')
    ThreadingHTTPServer((host, port), Handler).serve_forever()

if __name__ == '__main__':
    main()
