# PolkaCrew v0.5.1 pre-deploy test matrix

Do not publish the Product bundle until the clean-environment checks below are green.

## Build gates

- [ ] All eight Neon Orbital files exist under `public/assets/polkacrew/` and load without Canvas fallback.
- [ ] `npm install` completes from a clean clone.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` produces `dist/`.
- [ ] `npm run test:relay` passes.
- [ ] `npm run test:e2e` passes the Product-host shell smoke test.
- [ ] `npm run contracts:build` passes.
- [ ] `cdm install @w3nerick/polkacrew-results -n devnet` resolves the deployed v0.5 ABI/address.
- [ ] `npm run sync:cdm` generates a non-empty `src/generated/cdm.ts`.

## Multiplayer gates

- [ ] 2-player room create/join/ready/start.
- [ ] 4-player room with unique Product Accounts.
- [ ] Crew completes all four minigame types.
- [ ] Saboteur kill creates a reportable body.
- [ ] Body report starts a meeting.
- [ ] Emergency meeting limit/cooldown works.
- [ ] Vote, skip and vote timeout all resolve.
- [ ] Reactor sabotage loses if ignored and clears when both panels are fixed.
- [ ] Lights sabotage limits crew vision and clears from the repair panel.
- [ ] Door sabotage blocks movement and auto-unlocks.
- [ ] Ghost cannot task, report, kill, sabotage or vote.

## Recovery gates

- [ ] Client disconnects and reconnects inside grace without losing the room.
- [ ] Lobby host disconnect migrates host after grace.
- [ ] Live host disconnect beyond grace aborts the match and never offers settlement.
- [ ] Non-host disconnect beyond grace marks the match non-settleable.

## Polkadot gates

- [ ] Product Account SS58/H160 is available for every player.
- [ ] Personhood None/Lite/Full renders without gating casual play.
- [ ] Clean final replay uploads to Bulletin.
- [ ] Every client fetches the replay by CID and verifies canonical JSON + match hash.
- [ ] Asset Hub proposal matches CID, winner, participant order and win flags.
- [ ] Every Product Account can attest.
- [ ] Full attestation finalizes and XP/stats read back correctly.
- [ ] A false CID/result disables attestation.
- [ ] An uncompleted proposal expires after 30 minutes and can be cancelled by a participant without XP/stat changes.

## Product-host smoke test

PolkaCrew includes a Playwright harness using the official `@parity/host-api-test-sdk` host protocol. It embeds the Product in a host iframe, injects an app-scoped `polkacrew.dot/0` Product Account, and points chain discovery at Products Devnet Asset Hub.

```bash
npx playwright install chromium
npm run test:e2e
```

This is intentionally a **host-shell smoke test**, not a substitute for the real three-chain Products Devnet test. The current fixture supplies one chain endpoint, while a real PolkaCrew settlement simultaneously touches Asset Hub, Bulletin, and People. Before publishing, complete the manual multi-account matrix above inside the real Polkadot App / dev-dot.li host.
