#!/usr/bin/env python3
"""Dependency-free security smoke test for the PolkaCrew relay."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import importlib.util
import json
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("polkacrew_relay", ROOT / "relay_server.py")
relay = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(relay)

class TestServer(ThreadingHTTPServer):
    daemon_threads = True

class QuietHandler(relay.Handler):
    def log_message(self, fmt, *args):
        pass


def open_sse(port: int, room: str, client: str, auth: str, host: bool = False):
    conn = HTTPConnection("127.0.0.1", port, timeout=3)
    conn.request("GET", f"/events?room={room}&client={client}&auth={auth}&host={1 if host else 0}")
    response = conn.getresponse()
    assert response.status == 200, (response.status, response.reason)
    return conn, response


def post(port: int, body: dict):
    conn = HTTPConnection("127.0.0.1", port, timeout=3)
    payload = json.dumps(body).encode()
    conn.request("POST", "/send", body=payload, headers={"Content-Type": "application/json", "Content-Length": str(len(payload))})
    response = conn.getresponse()
    data = response.read()
    status = response.status
    conn.close()
    return status, data


def main():
    with relay.lock:
        relay.clients.clear()
        relay.client_auth.clear()
        relay.room_hosts.clear()

    server = TestServer(("127.0.0.1", 0), QuietHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    host_conn = client_conn = None
    host_response = client_response = None
    try:
        host_conn, host_response = open_sse(port, "ABCDE", "host-1", "host-secret", True)
        client_conn, client_response = open_sse(port, "ABCDE", "client-1", "client-secret", False)
        time.sleep(0.05)

        status, _ = post(port, {
            "room": "ABCDE", "sender": "host-1", "auth": "wrong-secret",
            "message": {"type": "snapshot", "players": {}, "completed": {}, "phase": "playing"},
        })
        assert status == 403, f"spoofed host secret should be rejected, got {status}"

        status, _ = post(port, {
            "room": "ABCDE", "sender": "client-1", "auth": "client-secret",
            "message": {"type": "snapshot", "players": {}, "completed": {}, "phase": "playing"},
        })
        assert status == 403, f"non-host authoritative message should be rejected, got {status}"

        status, _ = post(port, {
            "room": "ABCDE", "sender": "host-1", "auth": "host-secret",
            "message": {"type": "snapshot", "players": {}, "completed": {}, "phase": "playing"},
        })
        assert status == 200, f"real host authoritative message should pass, got {status}"

        status, _ = post(port, {
            "room": "ABCDE", "sender": "client-1", "auth": "client-secret",
            "message": {"type": "ready", "ready": True},
        })
        assert status == 200, f"normal client action should pass, got {status}"

        print("relay security smoke test: PASS")
    finally:
        if host_response: host_response.close()
        if client_response: client_response.close()
        if host_conn: host_conn.close()
        if client_conn: client_conn.close()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
