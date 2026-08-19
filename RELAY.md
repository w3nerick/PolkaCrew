# PolkaCrew realtime relay

The relay carries ephemeral realtime messages only. It is not the permanent source of truth: clean replay data goes to Bulletin and participant consensus goes to Asset Hub.

## Local

```bash
python3 relay_server.py
```

## Production container

```bash
docker build -f Dockerfile.relay -t polkacrew-relay .
docker run --rm -p 8765:8765 \
  -e POLKACREW_ALLOWED_ORIGINS=https://polkacrew.dev-dot.li \
  polkacrew-relay
```

Put the container behind HTTPS and build the Product with the public endpoint:

```bash
VITE_POLKACREW_RELAY_URL=https://relay.example.com npm run build
```

### Environment

- `POLKACREW_HOST` defaults to `0.0.0.0`.
- `POLKACREW_PORT` defaults to `8765`.
- `POLKACREW_ALLOWED_ORIGINS` defaults to `*` for local development. In production set a comma-separated allowlist such as `https://polkacrew.dev-dot.li`.
- `POLKACREW_MAX_POSTS_PER_SECOND` defaults to `120` per connected client.

### Protections

- Per-client unbroadcast session secrets.
- Host-only authoritative messages.
- Server-only presence/migration messages.
- Payload and room-connection limits.
- Per-client POST rate limit.
- Host reconnect grace and lobby-only host migration.
- Live-match host loss aborts settlement rather than guessing authoritative game state.
- Empty-room auth/rate state is garbage-collected after host grace.

`GET /health` exposes relay version and basic operational counters.
