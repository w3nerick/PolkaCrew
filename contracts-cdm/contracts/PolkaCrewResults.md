# @w3nerick/polkacrew-results

Consensus-attested match registry for PolkaCrew on the Products Devnet Asset Hub.

## Model

- The canonical replay JSON is stored on Bulletin and identified by a CID.
- One listed participant proposes the match with the replay CID, winner and participant Product Account H160 addresses.
- Every listed participant calls `attestMatch(matchId)` from their own mapped Product Account.
- Stats are updated only after every participant has attested.
- Winners receive 125 XP; other participants receive 40 XP.

The contract intentionally does not trust a central game verifier. The v0.5 frontend fetches the replay back from Bulletin, canonicalizes it, recomputes the match hash and refuses to attest on a mismatch.

## MVP limits

Unanimous attestation is deliberately strict. A disconnected participant can leave a match pending forever. A later version can add an expiry/quorum policy after the threat model is tested with real players.


## v0.5 settlement timeout

Unanimous attestation remains the integrity rule for clean matches. A proposal expires after 30 minutes; any listed participant can then call `cancelExpiredMatch(matchId)`. Cancellation never updates XP or stats.
