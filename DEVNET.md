# PolkaCrew v0.3 · Polkadot Products Devnet

This project intentionally targets the `devnet` preset everywhere.

## Product topology

- Asset Hub (para 1000): PolkaVM contracts, DotNS and result/stats state.
- People / Individuality (para 1004): `.dot` identity and personhood signals.
- Bulletin (para 1010): static Product bundle, replay JSON and CDM metadata.

## 1. Tooling

Node.js 22+ is required.

```bash
npm i -g @polkadot-community-foundation/dotns-cli
npm i -g @polkadot-community-foundation/polkadot-app-deploy
npm i -g @polkadot-community-foundation/cdm-cli
cdm setup
```

## 2. Frontend

```bash
npm install
npm run build
```

Outside Polkadot App / dev-dot.li the Product SDK falls back to local mode. Inside the host it activates wallet, chain and Bulletin services.

## 3. Devnet account preparation

Use a throwaway devnet account. Never put the mnemonic in Git.

```bash
dotns account map --env devnet
dotns bulletin authorize <SS58> --transactions 1000 --bytes 104857600 --env devnet
```

The account also needs Devnet Asset Hub funds.

## 4. Contract via CDM

The Solidity contract follows the official CDM Hardhat template convention and declares:

```solidity
/// @custom:cdm @w3nerick/polkacrew-results
```

Install dependencies and sanity-compile locally:

```bash
cd contracts-cdm
npm install
npm run build
cd ..
```

Prepare CDM signer and deploy to the Products Devnet:

```bash
cdm init -n devnet
# or: cdm account set -n devnet --mnemonic "$MNEMONIC"
cdm account map -n devnet
cdm account bal -n devnet
cdm build -n devnet
cdm deploy -n devnet
```

Important: CDM package names are first-writer-owned and append-only. Confirm `@w3nerick/polkacrew-results` is the final package name before the first real deploy.

After deploying, verify resolution from the frontend directory:

```bash
cdm install @w3nerick/polkacrew-results -n devnet
```

Do not hard-code a registry address across networks.

## 5. DotNS and Product publishing

```bash
dotns lookup name polkacrew --env devnet
dotns register domain -n polkacrew --env devnet
npm run build
pad ./dist polkacrew.dot --env devnet --mnemonic "$MNEMONIC"
dotns content view polkacrew --env devnet
```

`polkadot-app-deploy.config.ts` adds the Browse/App card metadata and app executable version.

When the owning account has the required personhood tier:

```bash
pad ./dist polkacrew.dot --env devnet --mnemonic "$MNEMONIC" --publish
```

## 6. Match lifecycle in v0.3

1. Host-authoritative multiplayer produces the final snapshot.
2. Product SDK uploads replay JSON to Bulletin and returns a CID.
3. PolkaCrew hashes `{ replayCid, snapshot }` into the match id.
4. The Product can request a `.dot` identity proof for that match id through People.
5. One participant proposes the match on `PolkaCrewResults`.
6. Every listed participant calls `attestMatch(matchId)` from their own Product wallet account.
7. The contract finalizes only after all participants attest, then updates games/wins/XP.

The `.dot` identity proof is useful for UX and identity binding; the contract's hard authorization comes from `msg.sender` on each attestation transaction.
