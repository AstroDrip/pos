import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, ROLES, splitStatements } from '../src/server/migrate-core.ts';
import { readEnv } from '../src/server/env.ts';
import { makeCloud, migrationFiles, type TestCloud } from './helpers.ts';

let c: TestCloud;
beforeAll(async () => {
  c = await makeCloud();
});

const refused = async (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied/);
const product = (id: number) => c.owner.query(`INSERT INTO commerce.catalog_products (pos_product_id, sku, name_en, name_ar, unit, sell_mode, price_incl, vat_rate_bp, pos_active) VALUES ($1, $2, 'Made up item', '-', 'piece', 'unit', 1150, 1500, true)`, [id, `SKU-${id}`]);

describe('migrations', () => {
  it('apply to an empty database and running again changes nothing', async () => {
    expect(await migrate(c.owner, migrationFiles())).toEqual([]);
  });

  it('refuse a migration that was changed after it ran', async () => {
    const files = migrationFiles().map((f, i) => (i === 0 ? { ...f, sql: `${f.sql}\n-- changed` } : f));
    await expect(migrate(c.owner, files)).rejects.toThrow(/changed/);
  });

  it('split on line-ending semicolons and drop comment lines', () => {
    expect(splitStatements('-- note\nCREATE TABLE a (b int);\nSELECT 1;\n')).toEqual(['CREATE TABLE a (b int)', 'SELECT 1']);
  });

  it('keep a function body in one piece', () => {
    const fn = 'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN 1;\nEND;\n$$';
    expect(splitStatements(`${fn};\nSELECT 1;\n`)).toEqual([fn, 'SELECT 1']);
  });

  it('create only the two app roles', () => {
    expect(ROLES).toEqual(['store_app', 'store_device']);
  });
});

describe('what the database itself forbids', () => {
  it('the web role cannot write POS-owned catalogue fields', async () => {
    await refused(c.app.query(`INSERT INTO commerce.catalog_products (pos_product_id, sku, name_en, name_ar, unit, sell_mode, price_incl, vat_rate_bp, pos_active) VALUES (900, 'X', 'x', 'x', 'p', 'unit', 1, 0, true)`));
    await refused(c.app.query('UPDATE commerce.catalog_products SET price_incl = 1'));
  });

  it('the web role cannot change stock numbers directly', async () => {
    await refused(c.app.query('UPDATE commerce.inventory_positions SET on_hand = 999'));
    await refused(c.app.query('UPDATE commerce.reservations SET qty = 1'));
  });

  it('the web role cannot rewrite order history or the audit log', async () => {
    await refused(c.app.query("UPDATE commerce.order_status_history SET to_status = 'completed'"));
    await refused(c.app.query('DELETE FROM commerce.audit_log'));
  });

  it('the web role cannot create or edit staff accounts', async () => {
    await refused(c.app.query("UPDATE commerce.staff_users SET role = 'admin'"));
  });

  it('the device role cannot read orders, customers, payments or staff', async () => {
    await refused(c.device.query('SELECT * FROM commerce.orders'));
    await refused(c.device.query('SELECT * FROM commerce.payments'));
    await refused(c.device.query('SELECT * FROM commerce.staff_users'));
  });

  it('no table has a cost column', async () => {
    const rows = await c.owner.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'commerce' AND column_name ILIKE '%cost%'");
    expect(rows).toEqual([]);
  });

  it('a new product starts unpublished', async () => {
    await product(1);
    await c.app.query('INSERT INTO commerce.web_products (pos_product_id) VALUES (1)');
    const [r] = await c.app.query<{ status: string }>('SELECT status FROM commerce.web_products WHERE pos_product_id = 1');
    expect(r!.status).toBe('unpublished');
  });

  it('reserved stock cannot go below zero', async () => {
    await product(2);
    await expect(c.owner.query('INSERT INTO commerce.inventory_positions (pos_product_id, on_hand, reserved) VALUES (2, 5000, -1)')).rejects.toThrow(/check/i);
  });

  it('settings start with free delivery at SAR 50 and no delivery fee invented', async () => {
    const [s] = await c.app.query<{ delivery_fee_incl: number | null; free_delivery_threshold: number }>('SELECT delivery_fee_incl, free_delivery_threshold FROM commerce.store_settings');
    expect(s).toEqual({ delivery_fee_incl: null, free_delivery_threshold: 5000 });
  });

  it('a pickup order cannot carry an address', async () => {
    const insert = (address: string | null) => c.app.query(`INSERT INTO commerce.orders (public_ref, access_token_hash, idempotency_key, fulfilment, customer_name, phone, address_line, items_incl, eligible_subtotal, total_incl, total_vat) VALUES ($1, 'h', $1, 'pickup', 'Made Up', '0500000000', $2, 100, 87, 100, 13)`, [`r${address ?? 'none'}`, address]);
    await expect(insert('Some street')).rejects.toThrow(/check/i);
    await expect(insert(null)).resolves.toBeDefined();
  });
});

describe('settings file', () => {
  const app = 'postgresql://store_app:x@host/db';
  const dev = 'postgresql://store_device:x@host/db';

  it('accepts the right roles', () => {
    expect(readEnv({ STORE_APP_DATABASE_URL: app, STORE_DEVICE_DATABASE_URL: dev })).toMatchObject({ appUrl: app, deviceUrl: dev });
  });

  it('refuses an owner connection', () => {
    expect(() => readEnv({ STORE_APP_DATABASE_URL: 'postgresql://neondb_owner:x@host/db' })).toThrow(/store_app/);
    expect(() => readEnv({ STORE_DEVICE_DATABASE_URL: app })).toThrow(/store_device/);
  });

  it('works with nothing set, so a build needs no secrets', () => {
    expect(readEnv({})).toMatchObject({ appUrl: null, deviceUrl: null });
  });
});
