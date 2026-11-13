import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attemptLogin } from '../src/server/auth-core.ts';
import { listProducts, stockIsFresh } from '../src/server/catalog-core.ts';
import { DEMO_USERNAME, demoAppDb } from '../src/server/demo/demo-db.ts';
import { MIGRATIONS } from '../src/server/demo/migrations.generated.ts';
import { readEnv } from '../src/server/env.ts';
import { placeOrder } from '../src/server/order-core.ts';
import { migrationFiles } from './helpers.ts';

const APP = 'postgresql://store_app:x@host/db';
const DEMO_PW = 'made-up-demo-password';

describe('demo mode settings', () => {
  it('is off unless asked for', () => {
    expect(readEnv({}).demo).toBe(false);
    expect(readEnv({ STORE_DEMO: '0' }).demo).toBe(false);
    expect(readEnv({ STORE_DEMO: '1' }).demo).toBe(true);
  });

  it('is ignored when a real database is set, so a real shop never runs on made-up data', () => {
    const e = readEnv({ STORE_DEMO: '1', STORE_DEMO_PASSWORD: DEMO_PW, STORE_APP_DATABASE_URL: APP });
    expect(e).toMatchObject({ demo: false, demoPassword: null, appUrl: APP });
  });

  it('refuses a short demo password', () => {
    expect(() => readEnv({ STORE_DEMO: '1', STORE_DEMO_PASSWORD: 'short' })).toThrow(/STORE_DEMO_PASSWORD/);
  });
});

describe('demo database', () => {
  it('carries exactly the migration files, so the demo matches the real schema', () => {
    expect(MIGRATIONS).toEqual(migrationFiles().sort((a, b) => a.name.localeCompare(b.name)));
    expect(readFileSync('scripts/bundle-migrations.mjs', 'utf8')).toContain('migrations.generated.ts');
  });

  it('starts with made-up products, live stock and no staff account without a password', async () => {
    const db = demoAppDb(null);
    const shop = await listProducts(db, { limit: 50 });
    expect(shop.items.length).toBeGreaterThan(10);
    expect(await stockIsFresh(db)).toBe(true);
    expect(await attemptLogin(db, DEMO_USERNAME, DEMO_PW, '192.0.2.1')).toMatchObject({ ok: false });
  }, 60_000);

  it('a demo password turns on the demo staff account, and orders can be placed', async () => {
    const db = demoAppDb(DEMO_PW);
    expect(await attemptLogin(db, DEMO_USERNAME, DEMO_PW, '192.0.2.1')).toMatchObject({ ok: true });
    const [p] = (await listProducts(db, { limit: 50 })).items.filter((x) => x.sellMode === 'unit' && x.availability.state === 'in_stock');
    const order = await placeOrder(db, { idempotencyKey: 'demo-order-key-0001', accessToken: 'demo-test-token-'.padEnd(43, 'x'), fulfilment: 'pickup', paymentMethod: 'pay_at_pickup', customerName: 'Made Up Shopper', phone: '0512345678', lines: [{ productId: p!.id, qty: 1000 }], expectedTotal: p!.priceIncl }, '192.0.2.1');
    expect(order.publicRef).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  }, 60_000);
});
