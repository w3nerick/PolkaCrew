import { expect, test } from './fixtures';

test('boots the PolkaCrew shell inside the Product host', async ({ testHost }) => {
  await testHost.waitForConnection(30_000);
  const frame = testHost.productFrame();

  await expect(frame.getByText('POLKADOT PRODUCTS DEVNET · v0.5 PRE-DEPLOY')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'CREATE ROOM' })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'JOIN' })).toBeVisible();
  await expect(frame.getByText('PRODUCT PROFILE')).toBeVisible();
});
