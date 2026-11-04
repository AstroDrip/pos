import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../core/csv';
import { openDatabase } from '../db/connection';
import { createBackup, backupStatus, installRestore, prepareRestore, pruneLocal } from './backup';
import { decryptBackup, keyToRecoveryCode, readManifest, recoveryCodeToKey } from './backup-crypto';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import { holdBill, listHeldBills, recallBill } from './held-bills';
import { dryRunProducts, dryRunSuppliers, importProducts, importSuppliers } from './import';
import { receiveGoods } from './inventory';
import { createCustomer, createSupplier, customerHistory, findCustomers, listSuppliers } from './parties';
import { salesSummary, stockOnHand } from './reports';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let water: number;
let backupDir: string;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  water = createProduct(ctx, u.admin, { sku: 'WAT', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250, reorderLevel: 10_000, barcodes: ['6281000000014'] });
  backupDir = mkdtempSync(join(tmpdir(), 'pos-bak-'));
});
afterEach(() => {
  t.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : (e as Error).message;
  }
  return 'no error';
};
const sell = (k: string, qty = 1000, customerId?: number) =>
  finalizeSale(ctx, u.cashier, { idempotencyKey: `key-${k}-xxxx`, lines: [{ productId: water, qty }], payments: [{ tender: 'cash', amount: 100_000 }], customerId });

describe('suppliers and customers', () => {
  it('validates Saudi VAT numbers and phones', () => {
    expect(code(() => createSupplier(ctx, u.admin, { name: 'X', vatNumber: '123' }))).toBe('VALIDATION');
    const id = createSupplier(ctx, u.admin, { name: 'Almarai', vatNumber: '300000000000003', phone: '050 123 4567', paymentTermsDays: 30 });
    expect(listSuppliers(ctx)).toEqual([{ id, name: 'Almarai', phone: '0501234567', vatNumber: '300000000000003', paymentTermsDays: 30 }]);
    expect(code(() => createSupplier(ctx, u.cashier, { name: 'Y' }))).toBe('PERMISSION_DENIED');
  });

  it('customers: unique phone, lookup and purchase history', () => {
    const c = createCustomer(ctx, u.cashier, { name: 'Ahmed', phone: '0551112222' });
    expect(code(() => createCustomer(ctx, u.cashier, { name: 'Other', phone: '0551112222' }))).toBe('CONFLICT');
    expect(findCustomers(ctx, '1112')).toMatchObject([{ id: c, name: 'Ahmed' }]);
    openShift(ctx, u.cashier, 0);
    sell('a', 1000, c);
    expect(customerHistory(ctx, c)).toMatchObject([{ invoiceNo: 'INV-00000001', totalIncl: 250 }]);
  });
});

describe('held bills', () => {
  it('hold creates no sale; recall returns the cart once', () => {
    const id = holdBill(ctx, u.cashier, 'Lady in blue', { lines: [{ productId: water, qty: 2000 }] });
    expect(listHeldBills(ctx)).toMatchObject([{ id, label: 'Lady in blue', lineCount: 1 }]);
    expect((ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(0);
    expect(recallBill(ctx, u.cashier, id)).toEqual({ lines: [{ productId: water, qty: 2000 }] });
    expect(code(() => recallBill(ctx, u.cashier, id))).toBe('NOT_FOUND');
  });
});

describe('reports', () => {
  it('low stock and sales summary reconcile with sales', () => {
    const sup = createSupplier(ctx, u.admin, { name: 'S' });
    receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: water, qty: 12_000, unitCost: 150 }] });
    openShift(ctx, u.cashier, 0);
    sell('a', 2000);
    t.advance(86_400_000);
    sell('b', 1000);
    expect(stockOnHand(ctx, u.admin, true)).toMatchObject([{ sku: 'WAT', qty: 9000, reorderLevel: 10_000 }]);
    const s = salesSummary(ctx, u.admin, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    expect(s).toMatchObject({ saleCount: 2, totalIncl: 750, cash: 750, card: 0 });
    expect(s.totalExcl + s.totalVat).toBe(s.totalIncl);
    expect(s.byDay.map((d) => d.day)).toEqual(['2026-11-05', '2026-11-06']);
    expect(s.topProducts).toMatchObject([{ nameEn: 'Water', qty: 3000, totalIncl: 750 }]);
    expect(code(() => stockOnHand(ctx, u.cashier))).toBe('PERMISSION_DENIED');
  });
});

describe('backup crypto', () => {
  it('recovery code round-trips and catches typos', () => {
    const key = randomBytes(32);
    const rc = keyToRecoveryCode(key);
    expect(rc).toMatch(/^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/);
    expect(recoveryCodeToKey(rc.toLowerCase()).equals(key)).toBe(true);
    const typo = (rc[0] === 'A' ? 'B' : 'A') + rc.slice(1);
    expect(() => recoveryCodeToKey(typo)).toThrow(/checksum|wrong/i);
  });
});

describe('local backup and restore', () => {
  const key = randomBytes(32);
  const opts = () => ({ dir: backupDir, masterKey: key, appVersion: 'test', trigger: 'manual' as const, userId: u.admin });

  it('backup during use is consistent, encrypted and verified', () => {
    openShift(ctx, u.cashier, 0);
    sell('a');
    const r = createBackup(ctx, opts());
    const file = readFileSync(join(backupDir, r.fileName));
    expect(file.includes(Buffer.from('Water'))).toBe(false); // product names are not readable in the file
    expect(file.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(readManifest(file).manifest).toMatchObject({ lastInvoiceNo: 'INV-00000001', counts: { sales: 1, products: 1 } });
    expect(backupStatus(ctx)).toMatchObject({ lastVerifiedLocal: { fileName: r.fileName }, lastFailure: null, offsite: 'not_configured' });
    expect(readdirSync(backupDir).filter((f) => f.startsWith('.tmp') || f.endsWith('.part'))).toEqual([]);
  });

  it('detects tampering and the wrong key', () => {
    const r = createBackup(ctx, opts());
    const path = join(backupDir, r.fileName);
    const file = readFileSync(path);
    file[file.length - 40]! ^= 0xff;
    expect(() => decryptBackup(file, key)).toThrow(/damaged or has been altered/);
    expect(() => decryptBackup(readFileSync(path), randomBytes(32))).toThrow(/different backup key/);
    const m = readFileSync(path);
    const edited = Buffer.from(m.toString('latin1').replace('"lastInvoiceNo":null', '"lastInvoiceNo":"X"   '), 'latin1');
    expect(() => decryptBackup(edited, key)).toThrow(); // manifest is authenticated too
  });

  it('a failed backup is recorded and does not claim success', () => {
    const r = code(() => createBackup(ctx, { ...opts(), masterKey: Buffer.alloc(5) }));
    expect(r).toMatch(/32 bytes/);
    expect(backupStatus(ctx)).toMatchObject({ lastVerifiedLocal: null, lastFailure: { error: expect.stringMatching(/32 bytes/) } });
  });

  it('cashier cannot run a manual backup', () => {
    expect(code(() => createBackup(ctx, { ...opts(), userId: u.cashier }))).toBe('PERMISSION_DENIED');
  });

  it('keeps only the newest N files', () => {
    for (let i = 0; i < 4; i++) {
      createBackup(ctx, opts());
      t.advance(1000);
    }
    expect(pruneLocal(ctx, backupDir, 2)).toBe(2);
    expect(readdirSync(backupDir).filter((f) => f.endsWith('.posbak'))).toHaveLength(2);
  });

  it('restore to a replacement machine: verify, install, reopen, data matches; old files kept', () => {
    openShift(ctx, u.cashier, 0);
    sell('a');
    sell('b');
    const r = createBackup(ctx, opts());

    // "New laptop": a fresh folder with an empty database created by the app.
    const newDir = mkdtempSync(join(tmpdir(), 'pos-new-'));
    const live = join(newDir, 'pos.db');
    openDatabase(live).close();
    const staging = join(newDir, 'restore-staging.db');
    const facts = prepareRestore(join(backupDir, r.fileName), recoveryCodeToKey(keyToRecoveryCode(key)), staging);
    expect(facts).toMatchObject({ lastInvoiceNo: 'INV-00000002', verifiedCounts: { sales: 2 } });
    const aside = installRestore(live, staging, 'test');
    expect(existsSync(aside)).toBe(true);
    const db = openDatabase(live);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect((db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(2);
    db.close();
    rmSync(newDir, { recursive: true, force: true });
  });

  it('restore refuses a corrupted file without touching anything', () => {
    const r = createBackup(ctx, opts());
    const p = join(backupDir, r.fileName);
    const f = readFileSync(p);
    f[f.length - 1]! ^= 1;
    writeFileSync(p, f);
    expect(() => prepareRestore(p, key, join(backupDir, 'stage.db'))).toThrow();
    expect(existsSync(join(backupDir, 'stage.db'))).toBe(false);
  });
});

describe('CSV import', () => {
  const header = 'sku,name_ar,name_en,sold_by,price_incl,vat_percent,barcode,plu\n';

  it('parses quotes, commas and BOM', () => {
    expect(parseCsv('﻿a,b\n"x, ""y""",2\r\n')).toEqual([['a', 'b'], ['x, "y"', '2']]);
  });

  it('dry run reports every problem and imports nothing', () => {
    const csv =
      header +
      'A1,تفاح,Apples,kg,7.99,15,,123\n' +
      'A1,موز,Bananas,kg,5,15,,124\n' + // duplicate sku
      'B1,,Bread,piece,abc,15,6281000000015,\n' + // missing Arabic, bad price, bad EAN check digit
      'WAT,ماء,Water,piece,2.5,15,,\n' + // already exists
      'C1,لحم,Lamb,kg,49.99,15,,\n' + // weighed without PLU
      'D1,سكر,Sugar,piece,10,5,,\n'; // unusual VAT: warning only
    const dry = dryRunProducts(ctx, csv);
    expect(dry.rows).toBe(6);
    expect(dry.valid.map((v) => v.sku)).toEqual(['A1', 'D1']);
    expect(dry.issues.map((i) => `${i.row}:${i.field}`)).toEqual(['2:sku', '3:name_ar', '3:price_incl', '3:barcode', '4:sku', '5:plu']);
    expect(dry.warnings.map((i) => `${i.row}:${i.field}`)).toEqual(['6:vat_percent']);
    expect(code(() => importProducts(ctx, u.admin, csv))).toBe('VALIDATION');
    expect((ctx.db.prepare('SELECT count(*) AS n FROM products').get() as { n: number }).n).toBe(1);
  });

  it('clean file imports all rows; warnings need confirmation', () => {
    const csv = header + 'A1,تفاح,Apples,kg,7.99,15,,123\nD1,سكر,Sugar,piece,10,5,,\n';
    expect(code(() => importProducts(ctx, u.admin, csv))).toBe('VALIDATION');
    expect(importProducts(ctx, u.admin, csv, true)).toBe(2);
    expect(dryRunProducts(ctx, csv).issues.filter((i) => i.message.includes('already'))).toHaveLength(3); // re-import is caught: 2 SKUs + 1 PLU
  });

  it('suppliers import', () => {
    const csv = 'name,phone,vat_number,payment_terms_days\nFarm,0501234567,300000000000003,30\nFarm,,,\n';
    expect(dryRunSuppliers(ctx, csv).issues).toMatchObject([{ row: 2, field: 'name' }]);
    expect(importSuppliers(ctx, u.admin, 'name\nFarm\nDairy\n')).toBe(2);
  });
});

describe('pre-migration snapshot', () => {
  it('opening an existing database with pending migrations snapshots it first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-mig-'));
    const p = join(dir, 'pos.db');
    const db = openDatabase(p);
    db.prepare('DELETE FROM schema_migrations WHERE version = 2').run();
    db.exec('DROP TABLE backup_jobs; DROP TABLE restore_events;');
    db.close();
    openDatabase(p).close();
    expect(readdirSync(dir).some((f) => f.startsWith('pos.db.pre-v2-'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
