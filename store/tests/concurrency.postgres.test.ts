import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Db, Statement } from '../../dashboard/src/server/db-types.ts';
import { ensureRoles, migrate, ROLES, type RoleName } from '../src/server/migrate-core.ts';
import { placeOrder } from '../src/server/order-core.ts';
import { migrationFiles } from './helpers.ts';

// Real row locks need real parallel connections, which PGlite cannot give. Runs only against a disposable database:
//   STORE_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5544/postgres_test npx vitest run tests/concurrency.postgres.test.ts
// The name must end in _test, so this can never be pointed at a real database by mistake.
const url = process.env.STORE_TEST_POSTGRES_URL;

describe.skipIf(!url)('real PostgreSQL concurrency', () => {
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let dbName: string;
  let deviceId: string;

  const owner = (p: () => pg.Pool): Db => ({
    async query<T>(text: string, params: unknown[] = []) {
      return (await p().query(text, params)).rows as T[];
    },
    async batch(statements: Statement[]) {
      const c = await p().connect();
      try {
        await c.query('BEGIN');
        for (const s of statements) await c.query(s.text, s.params ?? []);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
  });
  const db = owner(() => pool);

  /** A real separate connection, logged in as the app role. */
  async function asRole<T>(role: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query(`SET ROLE ${role}`);
      return await fn(c);
    } finally {
      await c.query('RESET ROLE');
      c.release();
    }
  }

  beforeAll(async () => {
    const base = new URL(url!);
    if (!base.pathname.endsWith('_test')) throw new Error('STORE_TEST_POSTGRES_URL must name a database ending in _test');
    adminPool = new pg.Pool({ connectionString: url, max: 2 });
    dbName = `race_${randomBytes(4).toString('hex')}_test`;
    await adminPool.query(`CREATE DATABASE ${dbName}`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: target.toString(), max: 60 });
    await ensureRoles(db, Object.fromEntries(ROLES.map((r) => [r, randomBytes(16).toString('hex')])) as Record<RoleName, string>);
    await migrate(db, migrationFiles());
    [{ id: deviceId }] = (await db.query<{ id: string }>("INSERT INTO commerce.devices (name, secret_hash, last_seen_at) VALUES ('Made up till', 'h', now()) RETURNING id")) as [{ id: string }];
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await adminPool?.end();
  });

  let next = 1000;
  let seq = 0;

  async function stockedProduct(onHand: number): Promise<number> {
    const id = ++next;
    await db.query(`INSERT INTO commerce.catalog_products (pos_product_id, sku, name_en, name_ar, unit, sell_mode, price_incl, vat_rate_bp, pos_active) VALUES ($1, $2, 'Made up', '', 'piece', 'unit', 100, 1500, true)`, [id, `SKU-${id}`]);
    await db.query('INSERT INTO commerce.web_products (pos_product_id) VALUES ($1)', [id]);
    await db.query('INSERT INTO commerce.inventory_positions (pos_product_id, on_hand) VALUES ($1, $2)', [id, onHand]);
    return id;
  }
  async function newOrder(): Promise<string> {
    const k = randomBytes(8).toString('hex');
    const [o] = await db.query<{ id: string }>(`INSERT INTO commerce.orders (public_ref, access_token_hash, idempotency_key, fulfilment, customer_name, phone, items_incl, eligible_subtotal, total_incl, total_vat) VALUES ($1, 'h', $1, 'pickup', 'Made Up', '0500000000', 100, 87, 100, 13) RETURNING id`, [k]);
    return o!.id;
  }
  const reserve = (order: string, lines: { productId: number; qty: number }[]) => asRole('store_app', (c) => c.query("SELECT commerce.place_order_reserve($1, $2::jsonb, now() + interval '30 minutes')", [order, JSON.stringify(lines)]));
  const stock = async (id: number) => (await db.query<{ on_hand: number; reserved: number }>('SELECT on_hand, reserved FROM commerce.inventory_positions WHERE pos_product_id = $1', [id]))[0]!;
  const outcomes = async (work: Promise<unknown>[]) => {
    const r = await Promise.allSettled(work);
    const failed = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => (x.reason as Error).message);
    return { ok: r.length - failed.length, failed };
  };
  const moveEvent = (productId: number, qty: number, s: number, orderId: string | null = null, reason = 'sale') => ({ eventId: `${deviceId}:0:${s}`, version: 1, occurredAt: '2026-11-10T09:30:00.000Z', type: 'stock.movement', payload: { movementId: s, productId, qty, reason, sourceType: 'test', sourceId: s, sourceLine: 0, orderId } });
  const apply = (events: object[]) => asRole('store_device', (c) => c.query('SELECT commerce.apply_events($1, $2::jsonb)', [deviceId, JSON.stringify(events)]));

  it('50 customers, the last unit: exactly one gets it', async () => {
    const id = await stockedProduct(1000);
    const orders = await Promise.all(Array.from({ length: 50 }, newOrder));
    const { ok, failed } = await outcomes(orders.map((o) => reserve(o, [{ productId: id, qty: 1000 }])));
    expect(ok).toBe(1);
    expect(failed.every((m) => m.includes('INSUFFICIENT_STOCK'))).toBe(true);
    expect(await stock(id)).toEqual({ on_hand: 1000, reserved: 1000 });
  });

  it('5 units, 40 customers buying 1 each: exactly 5 succeed', async () => {
    const id = await stockedProduct(5000);
    const orders = await Promise.all(Array.from({ length: 40 }, newOrder));
    const { ok } = await outcomes(orders.map((o) => reserve(o, [{ productId: id, qty: 1000 }])));
    expect(ok).toBe(5);
    expect(await stock(id)).toEqual({ on_hand: 5000, reserved: 5000 });
  });

  it('orders holding the same products in opposite order never deadlock', async () => {
    const a = await stockedProduct(1_000_000);
    const b = await stockedProduct(1_000_000);
    const orders = await Promise.all(Array.from({ length: 40 }, newOrder));
    const { ok, failed } = await outcomes(orders.map((o, i) => reserve(o, i % 2 ? [{ productId: a, qty: 1000 }, { productId: b, qty: 1000 }] : [{ productId: b, qty: 1000 }, { productId: a, qty: 1000 }])));
    expect(failed).toEqual([]);
    expect(ok).toBe(40);
    expect(await stock(a)).toMatchObject({ reserved: 40_000 });
    expect(await stock(b)).toMatchObject({ reserved: 40_000 });
  });

  it('a multi-item order that cannot be filled holds nothing, under load', async () => {
    const a = await stockedProduct(3000);
    const b = await stockedProduct(1000);
    const orders = await Promise.all(Array.from({ length: 20 }, newOrder));
    const { ok } = await outcomes(orders.map((o) => reserve(o, [{ productId: a, qty: 1000 }, { productId: b, qty: 1000 }])));
    expect(ok).toBe(1);
    expect(await stock(a)).toMatchObject({ reserved: 1000 });
    expect(await stock(b)).toMatchObject({ reserved: 1000 });
  });

  it('5, 3, 2: a POS sale and an online reservation at the same moment', async () => {
    for (let round = 0; round < 15; round++) {
      const id = await stockedProduct(5000);
      const order = await newOrder();
      seq++;
      const { ok, failed } = await outcomes([reserve(order, [{ productId: id, qty: 3000 }]), apply([moveEvent(id, -2000, seq)])]);
      expect(failed).toEqual([]);
      expect(ok).toBe(2);
      expect(await stock(id)).toEqual({ on_hand: 3000, reserved: 3000 });
    }
  });

  it('the same batch sent four times at once is applied once', async () => {
    const id = await stockedProduct(10_000);
    const start = ++seq;
    const batch = [moveEvent(id, -1000, start), moveEvent(id, -1000, ++seq)];
    await outcomes([apply(batch), apply(batch), apply(batch), apply(batch)]);
    expect(await stock(id)).toMatchObject({ on_hand: 8000 });
  });

  it('a release and a POS handover racing: stock is counted once', async () => {
    for (let round = 0; round < 15; round++) {
      const id = await stockedProduct(5000);
      const order = await newOrder();
      await reserve(order, [{ productId: id, qty: 3000 }]);
      seq++;
      await outcomes([asRole('store_app', (c) => c.query("SELECT commerce.release_reservation($1, 'rejected')", [order])), apply([moveEvent(id, -3000, seq, order)])]);
      const s = await stock(id);
      expect(s.reserved).toBe(0);
      expect(s.on_hand).toBe(2000);
    }
  });

  /** The web app's own connection: every call and batch runs as store_app on its own pooled connection. */
  const appDb: Db = {
    query: <T,>(text: string, params: unknown[] = []) => asRole('store_app', async (c) => (await c.query(text, params)).rows as T[]),
    batch: (statements: Statement[]) => asRole('store_app', async (c) => {
      try {
        await c.query('BEGIN');
        for (const s of statements) await c.query(s.text, s.params ?? []);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }),
  };
  const shopper = (productId: number, i: number, key = `race-${productId}-${i}-${randomBytes(4).toString('hex')}`) => ({
    idempotencyKey: key, accessToken: randomBytes(32).toString('base64url'), fulfilment: 'pickup' as const, customerName: 'Made Up', phone: `05${String(30_000_000 + i)}`, paymentMethod: 'pay_at_pickup' as const, lines: [{ productId, qty: 1000 }], expectedTotal: 100,
  });

  it('30 shoppers place an order for the last unit at once: one order, one hold', async () => {
    const id = await stockedProduct(1000);
    await db.query("UPDATE commerce.web_products SET status = 'published' WHERE pos_product_id = $1", [id]);
    const { ok, failed } = await outcomes(Array.from({ length: 30 }, (_x, i) => placeOrder(appDb, shopper(id, i), `198.51.100.${i}`)));
    expect(ok).toBe(1);
    expect(failed.length).toBe(29);
    expect(await stock(id)).toEqual({ on_hand: 1000, reserved: 1000 });
    const [n] = await db.query<{ n: string }>('SELECT count(*) AS n FROM commerce.order_lines WHERE pos_product_id = $1', [id]);
    expect(Number(n!.n)).toBe(1);
  });

  it('the same order sent ten times at once makes one order', async () => {
    const id = await stockedProduct(10_000);
    await db.query("UPDATE commerce.web_products SET status = 'published' WHERE pos_product_id = $1", [id]);
    const one = shopper(id, 99);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => placeOrder(appDb, one, '198.51.100.200')));
    const refs = new Set(results.filter((r): r is PromiseFulfilledResult<{ publicRef: string }> => r.status === 'fulfilled').map((r) => r.value.publicRef));
    expect(refs.size).toBe(1);
    expect(await stock(id)).toMatchObject({ reserved: 1000 });
    const [n] = await db.query<{ n: string }>('SELECT count(*) AS n FROM commerce.order_lines WHERE pos_product_id = $1', [id]);
    expect(Number(n!.n)).toBe(1);
  });

  it('releasing the same order at once gives stock back once', async () => {
    const id = await stockedProduct(5000);
    const order = await newOrder();
    await reserve(order, [{ productId: id, qty: 3000 }]);
    await outcomes(Array.from({ length: 10 }, () => asRole('store_app', (c) => c.query("SELECT commerce.release_reservation($1, 'rejected')", [order]))));
    expect(await stock(id)).toEqual({ on_hand: 5000, reserved: 0 });
  });
});
