# PolkaCrew v0.3

Original social-deduction game built as a native **Polkadot Product** for the Polkadot Products Devnet. It does not contain Among Us source code, maps, characters, branding or assets.

## What is in v0.3

- Local playable React/Canvas game engine.
- Dependency-free multiplayer relay prototype with room codes (`multiplayer.html` + `relay_server.py`).
- Host-authoritative role/action validation in the multiplayer prototype.
- Product SDK adapter with explicit `devnet` environment.
- Host wallet through `SignerManager`; no app-managed private keys.
- `getChainAPI("devnet")` connectivity for Product chains.
- Per-app privacy alias with `deriveContextAlias`.
- `.dot` identity proof through `signMessageWithDotNsIdentity` / People chain.
- Bulletin Cloud Storage replay upload + CID.
- Stable match-id derivation from replay CID + match snapshot.
- CDM-ready Solidity/Hardhat PolkaVM contract with `@custom:cdm` package metadata.
- Participant-by-participant `attestMatch()` consensus before stats finalize.
- `polkadot-app-deploy.config.ts` for Product card metadata and app executable publishing.
- `.dot` / PAD / Browse deployment runbook in `DEVNET.md`.

## Run the React Product shell

Requires Node.js 22+.

```bash
npm install
npm run dev
```

For the multiplayer prototype:

```bash
python3 relay_server.py
# open http://localhost:8765/multiplayer.html on two clients
```

## Build

```bash
npm run build
```

The static Product output is `dist/`.

## Products Devnet architecture

```text
Polkadot App / dev-dot.li
          │
      PolkaCrew.dot
          │
  @parity/product-sdk
     ┌────┼───────────────┐
     │    │               │
Asset Hub People       Bulletin
 1000      1004          1010
     │    identity         │
 PolkaVM  personhood     bundle
 DotNS    aliases        replays
 CDM                    metadata
     │                     │
     └──── match CID ──────┘
```

See **DEVNET.md** for current deployment commands and the important Devnet gotchas.
