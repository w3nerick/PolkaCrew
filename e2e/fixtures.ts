import { test as base } from '@playwright/test';
import {
  createTestHostFixture,
  type TestHost,
} from '@parity/host-api-test-sdk/playwright';

const PRODUCT_URL = 'http://localhost:5201';

// Custom NetworkConfig for Products Devnet Asset Hub, following the official
// test-host shape. The host smoke test intentionally exercises one chain;
// the real pre-deploy matrix covers Asset Hub + Bulletin + People together.
const DEVNET_ASSET_HUB = {
  id: 'polkadot-products-devnet-asset-hub',
  name: 'Polkadot Products Devnet Asset Hub',
  genesisHash: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2',
  rpcUrl: process.env.DEVNET_AH_RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com',
  tokenSymbol: 'PAS',
  tokenDecimals: 10,
};

const hostFixture = createTestHostFixture({
  productUrl: PRODUCT_URL,
  accounts: ['alice'],
  chain: DEVNET_ASSET_HUB,
  productAccounts: { 'polkacrew.dot/0': 'alice' },
});

export const test = base.extend<{ testHost: TestHost }>(hostFixture);
export { expect } from '@playwright/test';
