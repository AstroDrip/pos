import { afterAll, describe, expect, it } from 'vitest';
import { createProduct } from '../../src/services/catalog';
import { commerceStatus, commerceTick, enrollCommerce, makeCommerceTransport, startCommerce } from '../../src/services/commerce-sync';
import { applyMovement } from '../../src/services/inventory';
import { makeTestCtx, seedUsers } from '../../src/services/test-helpers';

// The real POS client over real HTTP to a running local store (npm run dev:sql and npm run dev). Skipped unless pointed at one:
//   STORE_TEST_BASE_URL=http://localhost:3100 STORE_TEST_CODE=<code printed by dev:sql> npx vitest run tests/live-http.test.ts
const base = process.env.STORE_TEST_BASE_URL;
const code = process.env.STORE_TEST_CODE;

describe.skipIf(!base || !code)('POS to a running store over HTTP', () => {
  const t = makeTestCtx();
  afterAll(() => t.cleanup());

  it('connects with a code, sends products and stock, and the shop shows them', async () => {
    const { ctx } = t;
    const u = seedUsers(ctx);
    // Product 1 is published in the made-up local shop, so it should appear there under this POS's name and price.
    const id = createProduct(ctx, u.admin, { sku: 'LIVE-A', nameAr: 'تجربة', nameEn: 'Live test item', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 4321 });
    expect(id).toBe(1);
    ctx.db.transaction(() => applyMovement(ctx, { productId: id, qty: 7000, unitCost: 500, reason: 'grn', sourceType: 'test', sourceId: 1, sourceLine: 0, userId: u.admin }))();

    const creds = await enrollCommerce(fetch, base!, { code: code!, deviceName: 'Live test', appVersion: 'test' });
    await expect(enrollCommerce(fetch, base!, { code: code!, deviceName: 'Live test', appVersion: 'test' })).rejects.toThrow(/wrong, used or expired/);

    startCommerce(ctx, u.admin);
    const transport = makeCommerceTransport(creds, fetch);
    expect(await commerceTick(ctx, transport, creds.deviceId)).toEqual({ ok: true });
    expect(commerceStatus(ctx)).toMatchObject({ pending: 0, lastError: null });

    const shop = await (await fetch(`${base}/api/store/products?q=${encodeURIComponent('Live test')}`)).json() as { items: { id: number; name: string; priceIncl: number; availability: { available: number } }[] };
    expect(shop.items[0]).toMatchObject({ id: 1, name: 'Live test item', priceIncl: 4321, availability: { available: 7000 } });

    ctx.db.transaction(() => applyMovement(ctx, { productId: id, qty: -2000, reason: 'waste', sourceType: 'test', sourceId: 2, sourceLine: 0, userId: u.admin }))();
    expect(await commerceTick(ctx, transport, creds.deviceId)).toEqual({ ok: true });
    const after = await (await fetch(`${base}/api/store/products?q=${encodeURIComponent('Live test')}`)).json() as { items: { availability: { available: number } }[] };
    expect(after.items[0]!.availability.available).toBe(5000);

    const wrong = makeCommerceTransport({ ...creds, secret: 'x'.repeat(43) }, fetch);
    await expect(wrong.send([])).rejects.toThrow();
  });
});
