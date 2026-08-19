# Changelog

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
