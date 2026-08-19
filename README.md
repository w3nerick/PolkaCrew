# PolkaCrew v0.5.2 · Complete game-loop candidate

PolkaCrew is an original multiplayer social-deduction game designed as a native **Polkadot Product**. Realtime movement and game rules stay off-chain for responsiveness; clean match replays and participant consensus use Polkadot Products Devnet.

> PolkaCrew does not include Among Us source code, maps, characters, branding, or assets.

## Architecture

```text
Polkadot App / dev-dot.li
          │
      polkacrew.dot
          │
 Product Account (SS58 + H160)
          │
  ┌───────┼─────────────────────────────┐
  │       │                             │
Realtime  People                        Bulletin
relay     .dot + personhood             canonical replay
  │                                       │
  └── authoritative gameplay ─────────────┤
                                          ▼
                                     Asset Hub 1000
                                          │
                                  PolkaCrewResults
                                          │
                           propose → verify → attest
                                          │
                              finalize XP / stats
```

## What v0.5.2 includes

### Neon Orbital visual system

- Uses the current `public/assets/polkacrew/` art pack already tracked in the repository.
- Relay Ark is the 1000×620 deck background; Relay Beacon marks interactive tasks.
- Relay Ranger, Chain Mechanic, Bulletin Diver, Validator Warden and Orbit Medic are deterministic crew cosmetics.
- Fork Wraith is visible only to the local player when that player is the saboteur, so cosmetics never leak secret roles.
- Bodies and ghosts reuse deterministic character artwork with role-safe presentation.
- Canvas keeps procedural fallbacks if an asset fails to load.
- Players select one of five crew models before creating or joining a room.

### Gameplay

- Five-room original ship map: People Lab, Bulletin Bay, Consensus Hub, Relay Core and Asset Forge.
- Persistent bodies and distance-validated **REPORT** action.
- Emergency meetings, vote counts, **SKIP**, 45-second meeting timeout and disconnected-player adjudication.
- Kill cooldown, emergency cooldown and sabotage cooldown.
- Reactor meltdown, lights outage and physical door-lock sabotage.
- Crew repair panels; reactor requires two separate repair keys.
- Real door collision while locks are active.
- Permanent ship-wall collision validated locally and by the authoritative host.
- Four task minigames: wires, validator sequence, storage slider and Bulletin chunk pulse.
- Ghost movement after death, procedural Web Audio cues and touch movement controls.
- Multi-saboteur allies are revealed only to saboteurs.
- Living-player meeting chat, vote result countdown and animated ejection/skip/tie resolution.
- Local match memory with Bulletin CID and Asset Hub finalization status when available.

### Realtime integrity

- Per-client relay secrets and host-only authoritative messages.
- Presence events and reconnect grace.
- Lobby-only host migration.
- During a live match, a lost host never silently transfers authority to a client that lacks the secret role map. The match aborts instead.
- Long player disconnects can resolve gameplay as forfeits, but mark the result **non-settleable** so interrupted matches cannot mint permanent XP.

### Polkadot settlement

- App-scoped Product Account is the contract identity.
- `.dot` proof and personhood remain separate identity layers.
- Final replay is canonicalized, uploaded to Bulletin and fetched back for byte-equivalent verification.
- Each client checks replay CID, match hash, winner, participant order and win flags against Asset Hub before attesting.
- Clean matches still require unanimous participant attestation.
- Unresolved proposals expire after **30 minutes**. A listed participant can then cancel the proposal; cancellation updates **no XP and no stats**.
- Home screen can read the current Product Account's games, wins and XP from `PolkaCrewResults` after the CDM contract is installed.

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

Open `http://localhost:5173` in multiple tabs/browsers. Vite proxies `/events` and `/send` to the relay on port 8765.

Useful checks:

```bash
npm run typecheck
npm run build
npm run test:relay
npm run contracts:build
```

Outside the Polkadot host the Product SDK falls back to **LOCAL DEV**. Gameplay works, but Bulletin/Asset Hub settlement is intentionally disabled.

## Production realtime endpoint

A static Product published to Bulletin needs a reachable HTTPS relay unless the transport is replaced with WebRTC later:

```bash
VITE_POLKACREW_RELAY_URL=https://relay.example.com npm run build
```

See `RELAY.md` for HTTPS deployment, origin allowlisting, rate limits and the relay container.

Health check:

```text
GET /health
```

## Devnet contract

Canonical source:

```text
contracts-cdm/contracts/PolkaCrewResults.sol
```

After deploying/installing it with CDM, `scripts/sync-cdm.mjs` converts the local `cdm.json` into `src/generated/cdm.ts`. No deployment address is hard-coded in source.

See [`DEVNET.md`](./DEVNET.md) for the integration runbook and [`PREDEPLOY.md`](./PREDEPLOY.md) for the final test matrix before publishing to Bulletin.
