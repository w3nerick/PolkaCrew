# v0.5.2 validation status

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
- Full TypeScript project build using Product SDK 0.22.0 and TypeScript 5.9.
- Vite production build across 1,606 modules, including the restored Neon Orbital art pack.
- Current Product SDK `Result` handling validated in the wallet, cloud-storage and contract adapter paths.
- Static Solidity structure check: balanced braces plus required proposal/attestation/expiry/cancellation entry points.
- GitHub asset manifest verified: all eight expected Neon Orbital files exist in source and production `dist/`.

## Must pass in a clean networked environment before Devnet publishing

The build used an existing dependency cache. A clean install, Product-host browser smoke test and PolkaVM contract build remain release gates:

```bash
npm install
npm run test:e2e
npm run contracts:build
```

After the contract is deployed/installed, also require a non-empty generated CDM manifest and the real multi-account Products Devnet test matrix in `PREDEPLOY.md`.
