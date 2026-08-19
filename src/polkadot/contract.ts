import cdm from '../generated/cdm';
import type { Role } from '../types';

export const POLKACREW_RESULTS_PACKAGE = '@w3nerick/polkacrew-results';

export interface MatchContractStatus {
  configured: boolean;
  address?: `0x${string}`;
  reason?: string;
}

export interface ChainMatchStatus {
  replayCid?: string;
  winner?: number;
  playerCount?: number;
  attestations?: number;
  createdAt?: bigint;
  expiresAt?: bigint;
  finalized?: boolean;
  cancelled?: boolean;
}

export interface PlayerStats {
  games: bigint;
  wins: bigint;
  crewWins: bigint;
  saboteurWins: bigint;
  xp: bigint;
}

export interface MatchContractAdapter {
  status: MatchContractStatus;
  proposeMatch(input: {
    matchId: `0x${string}`;
    replayCid: string;
    winner: Role;
    participants: `0x${string}`[];
    won: boolean[];
  }): Promise<void>;
  attestMatch(matchId: `0x${string}`): Promise<void>;
  cancelExpiredMatch(matchId: `0x${string}`): Promise<void>;
  getMatch(matchId: `0x${string}`): Promise<ChainMatchStatus | null>;
  getStats(h160Address: `0x${string}`): Promise<PlayerStats | null>;
  hasAttested(matchId: `0x${string}`, h160Address: `0x${string}`): Promise<boolean>;
  getParticipants(matchId: `0x${string}`): Promise<`0x${string}`[]>;
  participantWon(matchId: `0x${string}`, h160Address: `0x${string}`): Promise<boolean | null>;
}

interface ContractContext {
  rawAssetHub: unknown;
  productAddress: string;
  productH160: `0x${string}`;
  signer: unknown;
}

export async function createMatchContractAdapter(context: ContractContext): Promise<MatchContractAdapter> {
  const manifest = cdm as unknown as {
    registry?: string;
    contracts?: Record<string, { address?: string; abi?: unknown[] }>;
  };
  const installed = manifest.contracts?.[POLKACREW_RESULTS_PACKAGE];

  if (!manifest.registry || !installed?.address || !installed.abi?.length) {
    return unavailable('Run `cdm install @w3nerick/polkacrew-results -n devnet` after deploying the contract.');
  }

  try {
    const [{ ContractManager, ensureContractAccountMapped }, { devnet_asset_hub }] = await Promise.all([
      import('@parity/product-sdk/contracts'),
      import('@parity/product-sdk-descriptors/devnet-asset-hub'),
    ]);

    const managerResult = await ContractManager.fromLiveClient(
      manifest as never,
      context.rawAssetHub as never,
      devnet_asset_hub,
      {
        defaultOrigin: context.productAddress as never,
        defaultSigner: context.signer as never,
      },
    );
    if (managerResult.ok === false) throw managerResult.error;
    const manager = managerResult.value;
    const contract = manager.getContract(POLKACREW_RESULTS_PACKAGE) as any;
    const address = manager.getAddress(POLKACREW_RESULTS_PACKAGE) as `0x${string}`;
    let mapped = false;

    const ensureMapped = async () => {
      if (mapped) return;
      const result = await ensureContractAccountMapped(
        manager.getRuntime(),
        context.productAddress as never,
        context.signer as never,
      );
      if (result.ok === false) throw result.error;
      mapped = true;
    };

    return {
      status: { configured: true, address },
      proposeMatch: async input => {
        await ensureMapped();
        await contract.proposeMatch.tx(
          input.matchId,
          input.replayCid,
          input.winner === 'crew' ? 0 : 1,
          input.participants,
          input.won,
        );
      },
      attestMatch: async matchId => {
        await ensureMapped();
        await contract.attestMatch.tx(matchId);
      },
      cancelExpiredMatch: async matchId => {
        await ensureMapped();
        await contract.cancelExpiredMatch.tx(matchId);
      },
      getMatch: async matchId => {
        const result = await contract.matches.query(matchId);
        if (!result?.success) return null;
        return normalizeMatch(result.value);
      },
      getStats: async h160Address => {
        const result = await contract.stats.query(h160Address);
        if (!result?.success) return null;
        return normalizeStats(result.value);
      },
      hasAttested: async (matchId, h160Address) => {
        const result = await contract.attested.query(matchId, h160Address);
        return Boolean(result?.success && scalarBoolean(result.value));
      },
      getParticipants: async matchId => {
        const result = await contract.participants.query(matchId);
        if (!result?.success) return [];
        return normalizeAddressArray(result.value);
      },
      participantWon: async (matchId, h160Address) => {
        const result = await contract.participantWon.query(matchId, h160Address);
        if (!result?.success) return null;
        return scalarBoolean(result.value);
      },
    };
  } catch (error) {
    console.warn('[PolkaCrew] CDM contract adapter is unavailable.', error);
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

function unavailable(reason: string): MatchContractAdapter {
  const reject = async () => { throw new Error(`PolkaCrewResults is unavailable: ${reason}`); };
  return {
    status: { configured: false, reason },
    proposeMatch: reject,
    attestMatch: reject,
    cancelExpiredMatch: reject,
    getMatch: async () => null,
    getStats: async () => null,
    hasAttested: async () => false,
    getParticipants: async () => [],
    participantWon: async () => null,
  };
}

function normalizeMatch(value: any): ChainMatchStatus {
  if (Array.isArray(value)) {
    return {
      replayCid: value[0],
      winner: Number(value[1]),
      playerCount: Number(value[2]),
      attestations: Number(value[3]),
      createdAt: toBigInt(value[4]),
      expiresAt: toBigInt(value[5]),
      finalized: Boolean(value[6]),
      cancelled: Boolean(value[7]),
    };
  }
  return {
    replayCid: value?.replayCid ?? value?.replay_cid,
    winner: value?.winner == null ? undefined : Number(value.winner),
    playerCount: value?.playerCount == null ? Number(value?.player_count ?? 0) : Number(value.playerCount),
    attestations: value?.attestations == null ? undefined : Number(value.attestations),
    createdAt: value?.createdAt == null && value?.created_at == null ? undefined : toBigInt(value.createdAt ?? value.created_at),
    expiresAt: value?.expiresAt == null && value?.expires_at == null ? undefined : toBigInt(value.expiresAt ?? value.expires_at),
    finalized: value?.finalized == null ? undefined : Boolean(value.finalized),
    cancelled: value?.cancelled == null ? undefined : Boolean(value.cancelled),
  };
}

function normalizeStats(value: any): PlayerStats {
  const row = Array.isArray(value) ? value : [value?.games, value?.wins, value?.crewWins ?? value?.crew_wins, value?.saboteurWins ?? value?.saboteur_wins, value?.xp];
  return {
    games: toBigInt(row[0]) ?? 0n,
    wins: toBigInt(row[1]) ?? 0n,
    crewWins: toBigInt(row[2]) ?? 0n,
    saboteurWins: toBigInt(row[3]) ?? 0n,
    xp: toBigInt(row[4]) ?? 0n,
  };
}

function toBigInt(value: unknown): bigint | undefined {
  if (value == null) return undefined;
  try { return typeof value === 'bigint' ? value : BigInt(value as string | number); }
  catch { return undefined; }
}

function scalarBoolean(value: any): boolean {
  if (Array.isArray(value) && value.length === 1) return Boolean(value[0]);
  return Boolean(value);
}

function normalizeAddressArray(value: any): `0x${string}`[] {
  const list = Array.isArray(value) && value.length === 1 && Array.isArray(value[0])
    ? value[0]
    : Array.isArray(value)
      ? value
      : Array.isArray(value?.participants)
        ? value.participants
        : [];
  return list.map((item: unknown) => String(item) as `0x${string}`);
}
