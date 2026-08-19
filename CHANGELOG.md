# Changelog

## 0.5.2

- Added player-selected Neon Orbital crew models and synchronized the choice through multiplayer snapshots.
- Restored the tracked visual pack that v0.5.1 still referenced at runtime.
- Added permanent wall geometry and host-validated collision in addition to sabotage door locks.
- Added living-player meeting chat with host validation, rate limiting and replay events.
- Added a timed consensus-result phase with tie, skip and role-aware ejection animation.
- Added local kill feedback, victim signal-loss effects and optional procedural ambient audio.
- Added a recent-match memory that records local results and attaches Bulletin/Asset Hub verification state.
- Updated the Product SDK contract adapter to unwrap current `Result` APIs and restored a clean TypeScript production build.

## 0.5.1

- Merged the Neon Orbital asset pack from the current GitHub `main` into the v0.5 pre-deploy gameplay.
- Relay Ark now renders beneath the v0.5 collision/sabotage layer.
- Relay Beacon renders task terminals and keeps completion/pulse states.
- Added deterministic crew skins using Relay Ranger, Chain Mechanic, Bulletin Diver, Validator Warden and Orbit Medic.
- Fork Wraith remains local-role-only so the visual system cannot reveal the saboteur to other clients.
- Bodies and ghosts now reuse the visual asset family while preserving REPORT and ghost gameplay.
- Kept v0.5 reconnect, sabotage, minigame, relay-hardening, Product-host E2E and contract-expiry work intact.
- Added `game-effects.css` and the Neon Orbital prompt sheet to the pre-deploy candidate.

## 0.5.0

- Added persistent bodies and distance-validated REPORT meetings.
- Added emergency meeting limits, vote skip, meeting timeout and offline-player adjudication.
- Added kill, sabotage and emergency cooldowns.
- Added reactor, lights and door-lock sabotage with repair panels and reactor loss timer.
- Added real door collision and a larger five-room ship layout.
- Added four interactive task minigames instead of instant task completion.
- Added ghosts, procedural UI/game sounds and touch movement controls.
- Added relay presence events, reconnect grace, lobby host migration and host-loss match aborts.
- Long disconnects can resolve gameplay but mark the match non-settleable, preventing permanent XP from interrupted matches.
- Added richer role reveal, projected XP, achievements and player profile stats.
- Added 30-minute on-chain proposal expiry plus participant cancellation with zero XP/stat mutation.
- Bumped Product executable metadata to 0.5.0.
- Added relay production hardening: origin allowlist, per-client rate limiting, empty-room cleanup and a container image.


- Added an official Product-host Playwright smoke harness with `@parity/host-api-test-sdk` and a Products Devnet Asset Hub fixture.

## 0.4.0

- Merged multiplayer into the React Product shell.
- Added canonical signable Product Accounts for contract identity.
- Removed runtime use of deprecated `deriveContextAlias()`.
- Added optional `.dot` identity proofs and personhood precompile status.
- Added Bulletin replay upload, fetch-back verification, and canonical match hashing.
- Added CDM-resolved Asset Hub proposal/attestation lifecycle.
- Added client-side verification of on-chain CID, winner, participants and win flags before attestation.
- Hardened the relay with per-client secrets, host-only authoritative messages, movement validation, payload limits and connection limits.
- Added a dependency-free relay security smoke test to CI.
- Moved v0.1/v0.2 standalone artifacts under `legacy/`.
