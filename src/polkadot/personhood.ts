import { sha256Hex } from './canonical';

export const PERSONHOOD_PRECOMPILE = '0x000000000000000000000000000000000A010000' as const;

const PERSONHOOD_ABI = [
  {
    type: 'function',
    name: 'personhoodStatus',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'context', type: 'bytes32' },
    ],
    outputs: [
      {
        name: 'info',
        type: 'tuple',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'contextAlias', type: 'bytes32' },
        ],
      },
    ],
  },
] as const;

export type PersonhoodTier = 'none' | 'lite' | 'full' | 'unknown';

export interface PersonhoodStatus {
  status: number;
  tier: PersonhoodTier;
  contextAlias?: `0x${string}`;
  context: `0x${string}`;
}

export async function readPolkaCrewPersonhood(
  rawAssetHub: unknown,
  accountH160: `0x${string}`,
): Promise<PersonhoodStatus> {
  const context = await sha256Hex('polkacrew.dot/personhood/v1');
  try {
    const [{ createContract, createContractRuntimeFromClient }, { devnet_asset_hub }] = await Promise.all([
      import('@parity/product-sdk/contracts'),
      import('@parity/product-sdk-descriptors/devnet-asset-hub'),
    ]);
    const runtime = createContractRuntimeFromClient(rawAssetHub as never, devnet_asset_hub);
    const contract = createContract(runtime, PERSONHOOD_PRECOMPILE, PERSONHOOD_ABI as never) as any;
    const result = await contract.personhoodStatus.query(accountH160, context);
    if (!result?.success) return { status: -1, tier: 'unknown', context };

    const value = result.value;
    const info = Array.isArray(value) && value.length === 1 ? value[0] : value;
    const status = Number(Array.isArray(info) ? info[0] : info?.status ?? 0);
    const rawAlias = (Array.isArray(info) ? info[1] : info?.contextAlias ?? info?.context_alias) as `0x${string}` | undefined;
    const contextAlias = rawAlias && !/^0x0{64}$/i.test(rawAlias) ? rawAlias : undefined;
    return {
      status,
      tier: status === 2 ? 'full' : status === 1 ? 'lite' : status === 0 ? 'none' : 'unknown',
      contextAlias,
      context,
    };
  } catch (error) {
    console.info('[PolkaCrew] Personhood precompile is unavailable for this session.', error);
    return { status: -1, tier: 'unknown', context };
  }
}
