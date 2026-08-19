# PolkaCrew v0.4

PolkaCrew is an original multiplayer social-deduction game designed as a native **Polkadot Product**. Real-time movement and game actions stay off-chain for responsiveness; immutable match replays and participant consensus use Polkadot Products Devnet.

> PolkaCrew does not include Among Us source code, maps, characters, branding, or assets.

## v0.4 architecture

```text
Polkadot App / dev-dot.li
          │
      PolkaCrew.dot
          │
   Product Account (H160)
          │
  ┌───────┼─────────────────────────┐
  │       │                         │
Realtime  People                    Bulletin
relay     .dot identity             replay JSON
  │       proof                     canonical CID
  │                                   │
  └──── host-authoritative match ─────┤
                                      ▼
                                 Asset Hub 1000
                                      │
                              PolkaCrewResults
                                      │
                     propose → attest → finalize
```

### What works in v0.4

- Create/join multiplayer rooms with a five-character code.
- Host-authoritative positions, tasks, kills, meetings and votes.
- Secret roles sent only to the intended player while the match is active.
- Product SDK connection with explicit `devnet` selection.
- Canonical app-scoped **Product Account** and pallet-revive H160 for matchmaking and contract identity.
- `.dot` identity proof through the People / Individuality chain.
- Personhood precompile status (`None / Lite / Full`) plus PolkaCrew-scoped privacy alias.
- Canonical match serialization and Bulletin Cloud Storage CID.
- Every client independently fetches the replay back from Bulletin, compares the canonical payload, verifies the match hash, and checks CID/winner/participants/win flags against Asset Hub before attesting.
- CDM runtime resolution of `@w3nerick/polkacrew-results` from the live Devnet registry.
- Automatic pallet-revive account mapping when a player first submits a contract transaction.
- `proposeMatch()` + participant `attestMatch()` + unanimous finalization on Asset Hub.
- Relay security smoke test covering host-secret spoofing and non-host authoritative messages.
- GitHub CI for the web app, relay and PolkaVM contract.

## Local development

Requires Node.js 22+ and Python 3.

Terminal 1:

```bash
python3 relay_server.py
```

Terminal 2:

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in two browsers/tabs. Vite proxies `/events` and `/send` to the local relay on port 8765.

Outside a Polkadot host the Product SDK intentionally falls back to **LOCAL DEV**. Multiplayer still works, but on-chain settlement is disabled.

## Production relay

The Python relay is a development reference server with per-client secrets, room host authority, payload/connection limits and a `/health` endpoint. A deployed static Product needs a reachable HTTPS relay:

```bash
VITE_POLKACREW_RELAY_URL=https://relay.example.com npm run build
```

The game protocol is isolated in `src/multiplayer/`, so the relay can later be replaced with WebRTC or another transport without rewriting game rules.

## Devnet contract

The canonical contract lives in:

```text
contracts-cdm/contracts/PolkaCrewResults.sol
```

Deploy and install it with CDM before building the on-chain-enabled Product:

```bash
cdm setup
cdm init -n devnet
cdm account map -n devnet
cdm account bal -n devnet
cdm build -n devnet
cdm deploy -n devnet
cdm install @w3nerick/polkacrew-results -n devnet
npm run build
```

`cdm install` writes `cdm.json`. `scripts/sync-cdm.mjs` converts that local manifest into a browser-safe generated module before `dev`, `typecheck`, and `build`. No contract address is hard-coded in source.

See [`DEVNET.md`](./DEVNET.md) for the deployment checklist.
