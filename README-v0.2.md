# PolkaCrew v0.2 Multiplayer

This build adds a dependency-free multiplayer vertical slice to the original PolkaCrew MVP.

## What works now

- Create a room with a 5-character code.
- Join from another browser/device.
- Ready state and host-controlled match start.
- Secret Crew / Saboteur role delivered only to the intended client through the relay.
- Host-authoritative player positions and action validation.
- Crew tasks with distance checks.
- Saboteur kills with role + distance checks.
- Emergency meetings and voting.
- Crew/Saboteur victory conditions.
- No npm install is required for the multiplayer demo.

## Run it

### Windows
Double-click `start-windows.bat`.

### macOS / Linux
Run:

```bash
./start-mac-linux.sh
```

Or on any platform with Python 3:

```bash
python3 relay_server.py
```

Then open:

```text
http://localhost:8765
```

Create a room in the first browser. Open a second tab/browser and join with the room code.

## Play from another phone/computer on the same Wi-Fi

Find the LAN IP address of the computer running the relay, for example `192.168.1.50`, then open on the second device:

```text
http://192.168.1.50:8765
```

The operating-system firewall may ask you to allow Python to receive local network connections.

## Architecture

`relay_server.py` provides two primitives using only Python's standard library:

- `GET /events` = Server-Sent Events channel per player.
- `POST /send` = room message delivery, with optional direct targeting.

The room host is authoritative for game state. Clients submit movement/actions, and the host validates them before broadcasting safe snapshots. Role messages are sent directly to each player instead of being included in shared snapshots.

This is intentionally a development transport. Production PolkaCrew should replace the relay with a hardened signalling/realtime service or P2P/WebRTC layer while preserving the same game protocol.

## Polkadot path

The original React/Product SDK integration remains in `src/polkadot/product.ts`. The next milestone is to connect finalized multiplayer match snapshots to that adapter so the replay can be uploaded to Bulletin, then submit a signed result to the Asset Hub contract.

## Security caveats

This is an MVP, not production netcode. A malicious host can still cheat because the host owns the authoritative state. Before public deployment, match result attestations/signatures should be added so the Polkadot contract does not trust a single client.
