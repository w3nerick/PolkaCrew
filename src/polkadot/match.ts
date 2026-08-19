import type { MatchSnapshot, Role } from '../types';
import { canonicalJson, sha256Hex } from './canonical';
import type { ProductSession } from './product';
import type { SettlementNotice } from '../multiplayer/types';

export interface PreparedMatch {
  matchId: `0x${string}`;
  replayCid: string;
  identityProof: Awaited<ReturnType<ProductSession['proveDotIdentity']>>;
  snapshot: MatchSnapshot;
}

export interface PreparedVerification {
  valid: boolean;
  cidMatches: boolean;
  matchIdMatches: boolean;
  computedCid: string;
  computedMatchId: `0x${string}`;
}

export async function deriveMatchId(replayCid: string, snapshot: MatchSnapshot) {
  return sha256Hex(canonicalJson({ replayCid, snapshot }));
}

export async function prepareMatchForDevnet(
  session: ProductSession,
  snapshot: MatchSnapshot,
): Promise<PreparedMatch> {
  if (snapshot.settleable === false) throw new Error(snapshot.settlementBlockReason || 'Interrupted matches cannot be settled on-chain.');
  const replayCid = await session.uploadReplay(snapshot);
  const matchId = await deriveMatchId(replayCid, snapshot);
  const identityProof = await session.proveDotIdentity(`PolkaCrew match attestation\n${matchId}`, session.username);
  return { matchId, replayCid, identityProof, snapshot };
}

export async function verifyPreparedMatch(
  session: ProductSession,
  snapshot: MatchSnapshot,
  replayCid: string,
  matchId: `0x${string}`,
): Promise<PreparedVerification> {
  // Fetch by the claimed CID and compare the canonical replay bytes. This is
  // robust for both single-chunk raw CIDs and future chunked DAG-PB manifests,
  // whereas recomputing a raw CID locally only covers the former.
  const [bulletinSnapshot, computedMatchId] = await Promise.all([
    session.fetchReplay(replayCid),
    deriveMatchId(replayCid, snapshot),
  ]);
  const cidMatches = canonicalJson(bulletinSnapshot) === canonicalJson(snapshot);
  const matchIdMatches = computedMatchId.toLowerCase() === matchId.toLowerCase();
  return { valid: cidMatches && matchIdMatches, cidMatches, matchIdMatches, computedCid: replayCid, computedMatchId };
}


export interface OnChainProposalVerification {
  valid: boolean;
  replayCidMatches: boolean;
  winnerMatches: boolean;
  participantCountMatches: boolean;
  participantsMatch: boolean;
  winFlagsMatch: boolean;
}

export async function verifyOnChainProposal(
  session: ProductSession,
  settlement: SettlementNotice,
): Promise<OnChainProposalVerification> {
  const [status, chainParticipants] = await Promise.all([
    session.getMatchStatus(settlement.matchId),
    session.getMatchParticipants(settlement.matchId),
  ]);
  if (!status) {
    return { valid: false, replayCidMatches: false, winnerMatches: false, participantCountMatches: false, participantsMatch: false, winFlagsMatch: false };
  }

  const expected = settlement.participants.map(item => item.h160Address.toLowerCase());
  const actual = chainParticipants.map(item => item.toLowerCase());
  const replayCidMatches = status.replayCid === settlement.replayCid;
  const winnerMatches = status.winner === (settlement.winner === 'crew' ? 0 : 1);
  const participantCountMatches = status.playerCount === settlement.participants.length;
  const participantsMatch = expected.length === actual.length && expected.every((address, index) => address === actual[index]);
  let winFlagsMatch = participantsMatch;
  if (participantsMatch) {
    const flags = await Promise.all(settlement.participants.map(item => session.participantWon(settlement.matchId, item.h160Address)));
    winFlagsMatch = flags.every((flag, index) => flag !== null && flag === settlement.participants[index].won);
  }
  return {
    valid: replayCidMatches && winnerMatches && participantCountMatches && participantsMatch && winFlagsMatch,
    replayCidMatches, winnerMatches, participantCountMatches, participantsMatch, winFlagsMatch,
  };
}

export function participantsForSettlement(snapshot: MatchSnapshot, winner: Role) {
  if (snapshot.settleable === false) throw new Error(snapshot.settlementBlockReason || 'Interrupted matches cannot be settled on-chain.');
  const participants = snapshot.players.map(player => {
    if (!player.h160Address) throw new Error(`${player.name} is missing a Product Account H160 address.`);
    return {
      h160Address: player.h160Address,
      won: player.role === winner,
    };
  });
  return participants;
}
