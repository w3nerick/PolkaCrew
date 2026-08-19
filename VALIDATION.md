# v0.5.1 validation status

## Passed in the build workspace

- Python syntax: `relay_server.py` and `scripts/test-relay-security.py`.
- Relay security + recovery smoke test.
  - host-secret spoof rejection
  - non-host authoritative message rejection
  - server-only message rejection
  - allowed host/client paths
  - rate limiting
  - origin allowlist rejection
  - lobby host migration
  - live-match host-loss abort
- TypeScript model validation across `src/`, Playwright config and `e2e/` using temporary external-package type shims. This checks PolkaCrew's internal types and syntax without pretending the unavailable npm packages were installed.
- Static Solidity structure check: balanced braces plus required proposal/attestation/expiry/cancellation entry points.
- Neon Orbital Canvas merge type-check passed with temporary React shims; the v0.5 room/relay types compile together with the merged `MultiplayerCanvas.tsx`.
- GitHub asset manifest verified before packaging: all eight expected Neon Orbital files exist at `public/assets/polkacrew/`.

## Must pass in a clean networked environment before Devnet publishing

The workspace could not finish `npm install` because package downloads timed out. Therefore these gates are intentionally **not** claimed as passed here:

```bash
npm install
npm run typecheck
npm run build
npm run test:relay
npm run test:e2e
npm run contracts:build
```

After the contract is deployed/installed, also require a non-empty generated CDM manifest and the real multi-account Products Devnet test matrix in `PREDEPLOY.md`.
