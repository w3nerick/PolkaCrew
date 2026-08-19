import type { MatchSnapshot, Role } from '../types';
import { canonicalJson } from './canonical';
import { createMatchContractAdapter, type ChainMatchStatus, type MatchContractStatus } from './contract';
import { readPolkaCrewPersonhood, type PersonhoodStatus } from './personhood';

export type ProductMode = 'local' | 'polkadot-host';

export interface IdentityProof {
  username: string;
  accountId: string;
  signatureHex: string;
}

export interface DevnetStatus {
  assetHubConnected: boolean;
  bulletinConnected: boolean;
  peopleConnected: boolean;
}

export interface ProductSession {
  mode: ProductMode;
  account?: string;
  accountH160?: `0x${string}`;
  productAccount?: string;
  productH160?: `0x${string}`;
  username?: string;
  devnet: DevnetStatus;
  personhood: PersonhoodStatus;
  contract: MatchContractStatus;
  computeReplayCid: (snapshot: MatchSnapshot) => Promise<string>;
  uploadReplay: (snapshot: MatchSnapshot) => Promise<string>;
  fetchReplay: (cid: string) => Promise<MatchSnapshot>;
  proveDotIdentity: (message: string, username?: string) => Promise<IdentityProof | null>;
  proposeMatch: (input: {
    matchId: `0x${string}`;
    replayCid: string;
    winner: Role;
    participants: `0x${string}`[];
    won: boolean[];
  }) => Promise<void>;
  attestMatch: (matchId: `0x${string}`) => Promise<void>;
  getMatchStatus: (matchId: `0x${string}`) => Promise<ChainMatchStatus | null>;
  hasAttested: (matchId: `0x${string}`, h160Address: `0x${string}`) => Promise<boolean>;
  getMatchParticipants: (matchId: `0x${string}`) => Promise<`0x${string}`[]>;
  participantWon: (matchId: `0x${string}`, h160Address: `0x${string}`) => Promise<boolean | null>;
  destroy: () => void;
}

const bytesToHex = (bytes: Uint8Array) =>
  `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;

async function localDigest(snapshot: MatchSnapshot): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(snapshot)));
  return `local-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function connectPolkadotProduct(): Promise<ProductSession> {
  try {
    const [sdk, wallet, chain, descriptors] = await Promise.all([
      import('@parity/product-sdk'),
      import('@parity/product-sdk/wallet'),
      import('@parity/product-sdk/chain'),
      import('@parity/product-sdk-descriptors/devnet-individuality'),
    ]);

    const app = await sdk.createApp({
      name: 'polkacrew',
      cloudStorage: { environment: 'devnet' },
    });

    // `createApp()` owns the wallet signer used by Cloud Storage and .dot identity
    // proofs, so connect it explicitly before any Bulletin upload. A second
    // SignerManager exposes the richer Product Account API required by contracts.
    const appConnection = await app.wallet.connect();
    const preferredAddress = appConnection.accounts[0]?.address;
    if (!preferredAddress) throw new Error('Polkadot host returned no wallet account');

    const manager = new wallet.SignerManager({ dappName: 'polkacrew.dot' });
    const connected = await manager.connect();
    if (!connected.ok) throw connected.error;
    const walletAccount = connected.value.find(account => account.address === preferredAddress) ?? connected.value[0];
    if (!walletAccount) throw new Error('Polkadot host returned no signing account');
    const selected = manager.selectAccount(walletAccount.address);
    if (!selected.ok) throw selected.error;
    app.wallet.selectAccount(walletAccount.address);

    // Current Products host exposes a canonical app-scoped, signable Product
    // Account. It replaces the deprecated deriveContextAlias() path and is the
    // identity used for pallet-revive contract transactions.
    const productResult = await manager.getProductAccount('polkacrew.dot');
    if (!productResult.ok) throw productResult.error;
    const productAccount = productResult.value;
    const client = await chain.getChainAPI('devnet');
    const cloud = app.cloudStorage;
    if (!cloud) throw new Error('PolkaCrew Cloud Storage is disabled');

    const userResult = await manager.getUserId();
    const username = userResult.ok ? userResult.value.primaryUsername : undefined;

    await Promise.all([
      client.assetHub.query.System.Account.getValue(productAccount.address),
      client.bulletin.query.TransactionStorage.ByteFee.getValue(),
    ]);

    const [contractAdapter, personhood] = await Promise.all([
      createMatchContractAdapter({
        rawAssetHub: client.raw.assetHub,
        productAddress: productAccount.address,
        productH160: productAccount.h160Address,
        signer: productAccount.getSigner(),
      }),
      readPolkaCrewPersonhood(client.raw.assetHub, walletAccount.h160Address),
    ]);

    return {
      mode: 'polkadot-host',
      account: walletAccount.address,
      accountH160: walletAccount.h160Address,
      productAccount: productAccount.address,
      productH160: productAccount.h160Address,
      username,
      devnet: { assetHubConnected: true, bulletinConnected: true, peopleConnected: true },
      personhood,
      contract: contractAdapter.status,
      computeReplayCid: async snapshot => String(await cloud.computeCid(new TextEncoder().encode(canonicalJson(snapshot)))),
      uploadReplay: async snapshot => {
        const result = await cloud.upload(new TextEncoder().encode(canonicalJson(snapshot)));
        if (!result.ok) throw result.error;
        return String(result.value);
      },
      fetchReplay: async cid => {
        const result = await cloud.fetch(cid);
        if (!result.ok) throw result.error;
        return JSON.parse(new TextDecoder().decode(result.value)) as MatchSnapshot;
      },
      proveDotIdentity: async (message, dotUsername) => {
        try {
          const proof = await app.wallet.signMessageWithDotNsIdentity({
            peopleChain: descriptors.devnet_individuality,
            ...(dotUsername ? { username: dotUsername } : {}),
            message,
          });
          return {
            username: proof.username,
            accountId: proof.accountId,
            signatureHex: bytesToHex(proof.signature),
          };
        } catch (error) {
          // A Product Account is sufficient for contract authorization. The .dot
          // proof enriches identity when the player has one, but does not lock
          // username-less Devnet accounts out of multiplayer settlement.
          console.info('[PolkaCrew] Optional .dot identity proof unavailable.', error);
          return null;
        }
      },
      proposeMatch: contractAdapter.proposeMatch,
      attestMatch: contractAdapter.attestMatch,
      getMatchStatus: contractAdapter.getMatch,
      hasAttested: contractAdapter.hasAttested,
      getMatchParticipants: contractAdapter.getParticipants,
      participantWon: contractAdapter.participantWon,
      destroy: () => {
        client.destroy();
        manager.destroy();
      },
    };
  } catch (error) {
    console.info('[PolkaCrew] Products Devnet host unavailable; local development fallback active.', error);
    const unavailable = async () => { throw new Error('On-chain settlement requires Polkadot App / dev-dot.li and an installed CDM contract.'); };
    return {
      mode: 'local',
      devnet: { assetHubConnected: false, bulletinConnected: false, peopleConnected: false },
      personhood: { status: -1, tier: 'unknown', context: '0x' as `0x${string}` },
      contract: { configured: false, reason: 'Local mode' },
      computeReplayCid: localDigest,
      uploadReplay: localDigest,
      fetchReplay: async () => { throw new Error('Bulletin replay reads require the Polkadot Product host.'); },
      proveDotIdentity: async () => null,
      proposeMatch: unavailable,
      attestMatch: unavailable,
      getMatchStatus: async () => null,
      hasAttested: async () => false,
      getMatchParticipants: async () => [],
      participantWon: async () => null,
      destroy: () => undefined,
    };
  }
}
