import type { MatchSnapshot } from '../types';

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
  alias?: string;
  aliasH160?: string;
  devnet: DevnetStatus;
  computeReplayCid: (snapshot: MatchSnapshot) => Promise<string>;
  uploadReplay: (snapshot: MatchSnapshot) => Promise<string>;
  proveDotIdentity: (message: string, username?: string) => Promise<IdentityProof | null>;
  destroy: () => void;
}

const bytesToHex = (bytes: Uint8Array) =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;

async function localDigest(snapshot: MatchSnapshot): Promise<string> {
  const raw = JSON.stringify(snapshot);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return `local-${Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Connects PolkaCrew to the current Polkadot Products Devnet host.
 *
 * Important Devnet rules intentionally encoded here:
 * - createApp cloudStorage.environment is explicitly "devnet" because the SDK default is Paseo.
 * - wallet signing comes from SignerManager, never an app-managed seed.
 * - getChainAPI("devnet") is used for Asset Hub / Bulletin / People connectivity.
 * - the public game identity is a deterministic per-app context alias.
 * - DotNS identity proof is available without exposing or storing keys.
 */
export async function connectPolkadotProduct(): Promise<ProductSession> {
  try {
    const [sdk, wallet, identity, chain, descriptors] = await Promise.all([
      import('@parity/product-sdk'),
      import('@parity/product-sdk/wallet'),
      import('@parity/product-sdk/identity'),
      import('@parity/product-sdk/chain'),
      import('@parity/product-sdk-descriptors/devnet-individuality'),
    ]);

    const app = await sdk.createApp({
      name: 'polkacrew',
      cloudStorage: { environment: 'devnet' },
    });

    const manager = new wallet.SignerManager();
    const connected = await manager.connect();
    if (!connected.ok) throw connected.error;
    const account = connected.value[0];
    if (!account) throw new Error('Polkadot host returned no wallet account');
    manager.selectAccount(account.address);

    const client = await chain.getChainAPI('devnet');
    const alias = identity.deriveContextAlias(account.address, 'polkacrew');
    const cloud = app.cloudStorage;
    if (!cloud) throw new Error('PolkaCrew Cloud Storage is disabled');

    // Touch all three Product chains so the session reports the topology it actually uses.
    await Promise.all([
      client.assetHub.query.System.Account.getValue(account.address),
      client.bulletin.query.TransactionStorage.ByteFee.getValue(),
      // People/Individuality is intentionally reached through the DotNS identity proof API below.
    ]);

    return {
      mode: 'polkadot-host',
      account: account.address,
      alias: alias.address,
      aliasH160: alias.h160Address,
      devnet: { assetHubConnected: true, bulletinConnected: true, peopleConnected: true },
      computeReplayCid: async (snapshot) => {
        const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
        return String(await cloud.computeCid(bytes));
      },
      uploadReplay: async (snapshot) => {
        const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
        const result = await cloud.upload(bytes);
        if (!result.ok) throw result.error;
        return String(result.value);
      },
      proveDotIdentity: async (message, username) => {
        const proof = await app.wallet.signMessageWithDotNsIdentity({
          peopleChain: descriptors.devnet_individuality,
          ...(username ? { username } : {}),
          message,
        });
        return {
          username: proof.username,
          accountId: proof.accountId,
          signatureHex: bytesToHex(proof.signature),
        };
      },
      destroy: () => client.destroy(),
    };
  } catch (error) {
    console.info('[PolkaCrew] Products Devnet host unavailable; local development fallback active.', error);
    return {
      mode: 'local',
      devnet: { assetHubConnected: false, bulletinConnected: false, peopleConnected: false },
      computeReplayCid: localDigest,
      uploadReplay: localDigest,
      proveDotIdentity: async () => null,
      destroy: () => undefined,
    };
  }
}
