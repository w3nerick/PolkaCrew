import type { MatchSnapshot } from '../types';
import type { ProductSession } from './product';

export interface PreparedMatch {
  matchId: string;
  replayCid: string;
  identityProof: Awaited<ReturnType<ProductSession['proveDotIdentity']>>;
  snapshot: MatchSnapshot;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return `0x${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Prepare the immutable payload that players will attest to on Asset Hub. */
export async function prepareMatchForDevnet(
  session: ProductSession,
  snapshot: MatchSnapshot,
): Promise<PreparedMatch> {
  const replayCid = await session.uploadReplay(snapshot);
  const matchId = await sha256Hex(stableJson({ replayCid, snapshot }));
  const identityProof = await session.proveDotIdentity(`PolkaCrew match attestation\n${matchId}`);
  return { matchId, replayCid, identityProof, snapshot };
}
