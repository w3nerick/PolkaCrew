#!/usr/bin/env python3
"""Dependency-free security + recovery smoke test for the PolkaCrew v0.5 relay."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import importlib.util
import json
import queue
import os
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


def post(port: int, body: dict, origin: str | None = None):
    conn = HTTPConnection("127.0.0.1", port, timeout=3)
    payload = json.dumps(body).encode()
    headers={"Content-Type": "application/json", "Content-Length": str(len(payload))}
    if origin: headers["Origin"] = origin
    conn.request("POST", "/send", body=payload, headers=headers)
    response = conn.getresponse()
    data = response.read()
    status = response.status
    conn.close()
    return status, data


def reset_state():
    with relay.lock:
        relay.clients.clear()
        relay.client_auth.clear()
        relay.room_hosts.clear()
        relay.room_phase.clear()
        relay.host_disconnect_generation.clear()
        relay.rate_windows.clear()


def test_http_security(port: int):
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
            "room": "ABCDE", "sender": "client-1", "auth": "client-secret",
            "message": {"type": "host-migrated", "hostId": "client-1"},
        })
        assert status == 403, f"client-generated server control message should be rejected, got {status}"

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

        original_limit = relay.MAX_POSTS_PER_SECOND
        relay.MAX_POSTS_PER_SECOND = 0
        try:
            status, _ = post(port, {
                "room": "ABCDE", "sender": "client-1", "auth": "client-secret",
                "message": {"type": "ready", "ready": False},
            })
            assert status == 429, f"rate-limited client should be rejected, got {status}"
        finally:
            relay.MAX_POSTS_PER_SECOND = original_limit
            with relay.lock:
                relay.rate_windows.clear()

        old_origins = os.environ.get("POLKACREW_ALLOWED_ORIGINS")
        os.environ["POLKACREW_ALLOWED_ORIGINS"] = "https://polkacrew.dev-dot.li"
        try:
            status, _ = post(port, {
                "room": "ABCDE", "sender": "client-1", "auth": "client-secret",
                "message": {"type": "ready", "ready": False},
            }, origin="https://evil.example")
            assert status == 403, f"disallowed origin should be rejected, got {status}"
        finally:
            if old_origins is None:
                os.environ.pop("POLKACREW_ALLOWED_ORIGINS", None)
            else:
                os.environ["POLKACREW_ALLOWED_ORIGINS"] = old_origins
    finally:
        if host_response: host_response.close()
        if client_response: client_response.close()
        if host_conn: host_conn.close()
        if client_conn: client_conn.close()


def test_host_grace_policy():
    original_grace = relay.HOST_RECONNECT_GRACE_SECONDS
    relay.HOST_RECONNECT_GRACE_SECONDS = 0.06
    try:
        # Lobby: migrate to a connected participant.
        room = "MIGRA"
        host = "host-old"
        peer = "peer-a"
        peer_q = queue.Queue()
        with relay.lock:
            relay.room_hosts[room] = host
            relay.room_phase[room] = "lobby"
            relay.clients[(room, peer)] = peer_q
        relay._schedule_host_grace(room, host)
        time.sleep(0.11)
        with relay.lock:
            assert relay.room_hosts.get(room) == peer, "lobby host should migrate after grace"
        envelope = peer_q.get_nowait()
        assert envelope["sender"] == "relay"
        assert envelope["message"] == {"type": "host-migrated", "hostId": peer}

        # Playing: never invent a new authority; abort instead.
        room = "PLAY1"
        host = "host-game"
        peer = "peer-b"
        peer_q = queue.Queue()
        with relay.lock:
            relay.room_hosts[room] = host
            relay.room_phase[room] = "playing"
            relay.clients[(room, peer)] = peer_q
        relay._schedule_host_grace(room, host)
        time.sleep(0.11)
        with relay.lock:
            assert relay.room_hosts.get(room) is None, "playing host must not silently migrate"
        envelope = peer_q.get_nowait()
        assert envelope["message"] == {"type": "host-lost", "hostId": host}
    finally:
        relay.HOST_RECONNECT_GRACE_SECONDS = original_grace


def main():
    reset_state()
    server = TestServer(("127.0.0.1", 0), QuietHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        test_http_security(port)
        reset_state()
        test_host_grace_policy()
        print("relay security + recovery smoke test: PASS")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
