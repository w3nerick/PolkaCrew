# PolkaCrew v0.4 · Products Devnet runbook

PolkaCrew explicitly targets the `devnet` preset. Do not omit `--env devnet` / `-n devnet`: the CLIs have other network defaults.

## Product topology

- **Asset Hub (para 1000):** PolkaVM contracts, DotNS, match registry and XP/stats.
- **People / Individuality (para 1004):** `.dot` identity and proof-of-personhood.
- **Bulletin (para 1010):** Product bundle, canonical replay JSON and CDM metadata.
- **Realtime relay:** ephemeral movement/action transport only. It is not a source of permanent truth.

## 1. Tooling

Node.js 22+ is required.

```bash
npm i -g @polkadot-community-foundation/dotns-cli
npm i -g @polkadot-community-foundation/polkadot-app-deploy
npm i -g @polkadot-community-foundation/cdm-cli
cdm setup
cdm setup --check
```

The frontend follows the current compatible package lines `@parity/product-sdk@^0.22.0` and `@parity/product-sdk-descriptors@^0.9.0`. The descriptor line is the currently published Devnet-capable package; update intentionally when the SDK moves to a new 0.x line.

## 2. Local multiplayer

```bash
# terminal A
python3 relay_server.py

# terminal B
npm install
npm run dev
```

Vite proxies `/events` and `/send` to `localhost:8765`.

For a deployed Product, build with an HTTPS relay endpoint:

```bash
VITE_POLKACREW_RELAY_URL=https://relay.example.com npm run build
```

## 3. Developer/deployer account preparation

Use a throwaway Devnet account and never commit its mnemonic.

```bash
dotns account map --env devnet
dotns bulletin authorize <SS58> --transactions 1000 --bytes 104857600 --env devnet
```

The deployer also needs Devnet Asset Hub funds. Check the current faucet/documentation before deploying.

## 4. Contract via CDM

Canonical source:

```text
contracts-cdm/contracts/PolkaCrewResults.sol
```

The package annotation is:

```solidity
/// @custom:cdm @w3nerick/polkacrew-results
```

The CDM registry is first-writer-owned and append-only. Confirm that package name before the first real deploy.

```bash
cd contracts-cdm
npm install
npm run build
cd ..

cdm init -n devnet
cdm account map -n devnet
cdm account bal -n devnet
cdm build -n devnet
cdm deploy -n devnet
```

A deploy is not considered complete until the package resolves and its ABI is present:

```bash
cdm install @w3nerick/polkacrew-results -n devnet
```

That command writes `cdm.json` plus `.cdm/` artifacts. The app intentionally does **not** commit those network snapshots. Before each build, `scripts/sync-cdm.mjs` reads local `cdm.json` and generates `src/generated/cdm.ts`. Runtime calls use `ContractManager.fromLiveClient`, so the package address is resolved from the live registry while the installed ABI stays pinned locally.

## 5. Product Account contract identity

v0.4 separates identity layers:

1. `SignerManager.connect()` connects the user's host wallet.
2. `SignerManager.getProductAccount("polkacrew.dot")` obtains the app-scoped account.
3. The Product Account's H160 is announced in the lobby and used in the Solidity participant list.
4. Contract transactions use the Product Account signer.
5. Before the first contract transaction, `ensureContractAccountMapped()` maps that SS58 account for `pallet-revive` if necessary.
6. `.dot` identity proof is requested separately through People with `signMessageWithDotNsIdentity()`.
7. The Asset Hub personhood precompile is queried at `0x000000000000000000000000000000000A010000` for `None / Lite / Full` plus a PolkaCrew-scoped context alias; gameplay does not require a tier.

This keeps a user's identity proof separate from the account that signs PolkaCrew contract state.

## 6. Match lifecycle

1. Host assigns secret roles and validates gameplay actions.
2. When the match ends, roles are revealed in a canonical final snapshot.
3. Host canonicalizes JSON and uploads it through Product SDK Cloud Storage to Bulletin.
4. CID + canonical snapshot are hashed into `matchId`.
5. Host proposes `matchId`, CID, winner, participant Product H160s and win flags to `PolkaCrewResults`.
6. Before attesting, the host reads the proposal back from Asset Hub and verifies CID, winner, participant order and every win flag.
7. Host broadcasts the verified settlement notice to the room.
8. Every client fetches the replay by CID from Bulletin, compares its canonical JSON with the final snapshot, recomputes the match hash, and independently checks the same proposal fields on Asset Hub. Any mismatch disables attestation.
9. Every Product Account calls `attestMatch(matchId)` from its own signer.
10. The contract finalizes only when all listed participants attest, then updates games/wins/XP.

The relay cannot mint XP by itself. A modified host can propose a false result, but it cannot finalize it without the other listed participants voluntarily attesting.

## 7. DotNS + Product publishing

```bash
dotns lookup name polkacrew --env devnet
dotns register domain -n polkacrew --env devnet
npm run build
pad ./dist polkacrew.dot --env devnet --mnemonic "$MNEMONIC"
dotns content view polkacrew --env devnet
```

The Product is then reachable as `polkacrew.dot` in Polkadot App and `polkacrew.dev-dot.li` through the web gateway.

When the owner has the required personhood tier:

```bash
pad ./dist polkacrew.dot --env devnet --mnemonic "$MNEMONIC" --publish
```

## 8. Before calling v0.4 production-ready

- Replace the Python relay with an HTTPS production service or WebRTC transport.
- Add reconnect/host migration and disconnect adjudication.
- Add timeout/dispute rules so unanimous attestation cannot lock a match forever.
- Run Product-host E2E tests with `@parity/host-api-test-sdk` against an explicit Devnet `NetworkConfig`.
- Pin all transitive dependencies with a committed lockfile after the first verified install.
