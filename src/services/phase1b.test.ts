import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../core/csv';
import { openDatabase } from '../db/connection';
import { createBackup, backupStatus, encryptedSnapshot, installRestore, prepareRestore, pruneLocal } from './backup';
import { decryptBackup, keyToRecoveryCode, readManifest, recoveryCodeToKey } from './backup-crypto';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import { holdBill, listHeldBills, recallBill, recordRemoval } from './held-bills';
import { dryRunProducts, dryRunSuppliers, importProducts, importSuppliers } from './import';
import { receiveGoods } from './inventory';
import { createCustomer, createSupplier, customerHistory, findCustomers, listSuppliers } from './parties';
import { salesSummary, stockOnHand, voidsReport } from './reports';
import { trialBalance, unbalancedEntries } from './ledger';
import { finalizeSale } from './sales';
import { openShift, recordCashMovement, shiftSummary } from './shifts';
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
    expect(listSuppliers(ctx)).toEqual([{ id, name: 'Almarai', phone: '0501234567', vatNumber: '300000000000003', paymentTermsDays: 30, address: null, crNumber: null, ourCustomerNo: null, salesman: null }]);
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
    const id = holdBill(ctx, u.cashier, 'Lady in blue', { lines: [{ productId: water, qty: 2000 }], billKey: 'key-held-xxxx' });
    expect(listHeldBills(ctx)).toMatchObject([{ id, label: 'Lady in blue', lineCount: 1 }]);
    expect((ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(0);
    expect(recallBill(ctx, u.cashier, id)).toEqual({ lines: [{ productId: water, qty: 2000 }], billKey: 'key-held-xxxx' });
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
    const s = salesSummary(ctx, u.admin, '2026-11-01', '2026-11-30');
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

/** Makes a fresh database look like one created by schema v1 (undoes migrations 2 and 3). */
function rollBackToV1(db: ReturnType<typeof openDatabase>) {
  db.prepare('DELETE FROM schema_migrations WHERE version >= 2').run();
  db.exec('DROP TABLE bill_drafts;'); // undo migration 12
  // undo migration 11
  db.exec(`DROP TABLE supplier_bill_lines; DROP TABLE supplier_bills; DROP TABLE supplier_items;
    ALTER TABLE suppliers DROP COLUMN cr_number; ALTER TABLE suppliers DROP COLUMN our_customer_no; ALTER TABLE suppliers DROP COLUMN salesman;`);
  // undo migration 10
  db.exec(`DROP TABLE supplier_payment_allocations; DROP TABLE invoice_disputes; DROP TABLE refund_account_offsets; DROP TABLE customer_writeoffs;
    DROP TABLE receipt_allocations; DROP TABLE customer_receipts; DROP TABLE receivables;
    ALTER TABLE suppliers DROP COLUMN notes; ALTER TABLE suppliers DROP COLUMN address; ALTER TABLE purchase_invoices DROP COLUMN no_due_date; ALTER TABLE purchase_invoices DROP COLUMN arrangement_note;
    ALTER TABLE customers DROP COLUMN credit_enabled; ALTER TABLE customers DROP COLUMN credit_limit; ALTER TABLE customers DROP COLUMN payment_terms_days;
    ALTER TABLE customers DROP COLUMN address; ALTER TABLE customers DROP COLUMN notes; ALTER TABLE customers DROP COLUMN updated_at;
    CREATE TABLE payments_old (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), tender TEXT NOT NULL CHECK (tender IN ('cash','card')), amount INTEGER NOT NULL CHECK (amount > 0), reference TEXT) STRICT;
    INSERT INTO payments_old SELECT * FROM payments; DROP TRIGGER trg_payments_no_update; DROP TRIGGER trg_payments_no_delete; DROP TABLE payments;
    ALTER TABLE payments_old RENAME TO payments; CREATE INDEX ix_payments_sale ON payments(sale_id);
    CREATE TRIGGER trg_payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'payments is immutable'); END;
    CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments is immutable'); END;
    DELETE FROM role_permissions WHERE permission_code LIKE 'customer.%' AND permission_code <> 'customer.manage';
    DELETE FROM permissions WHERE code LIKE 'customer.%' AND code <> 'customer.manage';
    DELETE FROM accounts WHERE code IN ('1100','1310','2300','6910'); DELETE FROM invoice_counters WHERE series = 'CRCPT';
    DELETE FROM settings WHERE key IN ('supplier_allocations_backfilled','credit_due_soon_days');`);
  // undo migration 9
  db.exec(`DROP TABLE supplier_opening_balances; DROP TABLE supplier_payments; DROP TABLE purchase_return_lines; DROP TABLE purchase_returns;
    DROP TABLE purchase_invoice_grns; DROP TABLE purchase_invoices;
    DELETE FROM role_permissions WHERE permission_code LIKE 'purchase.%'; DELETE FROM permissions WHERE code LIKE 'purchase.%';
    DELETE FROM accounts WHERE code = '5010'; DELETE FROM invoice_counters WHERE series IN ('PINV','PRET','SPAY');`);
  // undo migration 8
  db.exec("DROP TABLE sync_outbox; DROP TABLE sync_state; DELETE FROM settings WHERE key = 'dashboard_enabled';");
  // undo migration 7
  db.exec(`DROP TABLE expense_amortization; DROP TABLE expense_payments; DROP TABLE expenses; DROP TABLE recurring_expenses; DROP TABLE expense_categories;
    DELETE FROM role_permissions WHERE permission_code LIKE 'expense.%' OR permission_code = 'finance.view';
    DELETE FROM permissions WHERE code LIKE 'expense.%' OR code = 'finance.view';
    DELETE FROM accounts WHERE code IN ('1030','1300','1500','2010','6100','6110','6120','6130','6200','6300','6310','6400','6410','6420','6430','6500','6900');
    DELETE FROM invoice_counters WHERE series = 'EXP';`);
  // undo migration 6
  db.exec('DROP TABLE scale_label_layouts; ALTER TABLE sale_lines DROP COLUMN scan_code;');
  // undo migration 5
  db.exec(`DROP TABLE refund_lines; DROP TABLE refunds; DROP TABLE stock_adjustment_lines; DROP TABLE stock_adjustments;
    DELETE FROM invoice_counters WHERE series IN ('REFUND', 'ADJ'); DELETE FROM settings WHERE key = 'refund_max_days';`);
  db.exec("DROP TABLE backup_jobs; DROP TABLE restore_events; DELETE FROM accounts WHERE code = '2900';");
  // undo migration 4
  db.exec(`DROP TABLE product_fts; DROP TABLE product_aliases;
    DROP INDEX ix_products_name_en_norm; DROP INDEX ix_products_name_ar_norm; DROP INDEX ux_goods_receipts_request_key;
    ALTER TABLE products DROP COLUMN name_en_norm; ALTER TABLE products DROP COLUMN name_ar_norm; ALTER TABLE goods_receipts DROP COLUMN request_key;
    DELETE FROM settings WHERE key IN ('scale_label_max_grams', 'scale_label_max_halalas', 'search_index_version');`);
}

describe('pre-migration snapshot', () => {
  it('opening an existing database with pending migrations snapshots it first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-mig-'));
    const p = join(dir, 'pos.db');
    const db = openDatabase(p);
    rollBackToV1(db);
    db.close();
    openDatabase(p).close();
    expect(readdirSync(dir).some((f) => f.startsWith('pos.db.pre-v2-'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('with a backup key, the snapshot is encrypted and restorable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-mig-'));
    const p = join(dir, 'pos.db');
    const key = randomBytes(32);
    const db = openDatabase(p);
    rollBackToV1(db);
    db.close();
    let written = '';
    openDatabase(p, { preMigrationSnapshot: (d, v) => (written = encryptedSnapshot(d, join(dir, 'backups'), key, 't', `pre-v${v}`)) }).close();
    expect(written).toMatch(/pre-v2\.posbak$/);
    expect(readdirSync(dir).some((f) => f.startsWith('pos.db.pre-v2-'))).toBe(false); // no plain copy
    const file = readFileSync(written);
    expect(file.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(prepareRestore(written, key, join(dir, 'stage.db')).schemaVersion).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('gap fixes', () => {
  it('cash in/out posts to suspense so book cash equals drawer cash', () => {
    openShift(ctx, u.cashier, 10_000);
    recordCashMovement(ctx, u.supervisor, 'out', 300, 'Ice');
    recordCashMovement(ctx, u.supervisor, 'in', 1000, 'Change float top-up');
    const bal = (code: string) => {
      const r = trialBalance(ctx).find((x) => x.code === code);
      return r ? r.debit - r.credit : 0;
    };
    expect(bal('1010')).toBe(700);
    expect(bal('2900')).toBe(-700);
    expect(unbalancedEntries(ctx)).toEqual([]);
    expect(shiftSummary(ctx, 1).expectedCash).toBe(10_700);
  });

  it('removed lines are audited and appear in the voids report on the Saudi day', () => {
    t.advance(13 * 3_600_000 + 30 * 60_000); // 21:30 UTC = 00:30 next day in Riyadh
    openShift(ctx, u.cashier, 0);
    // A line removed from a bill that is then paid: the report shows that bill's invoice number.
    recordRemoval(ctx, u.cashier, 'line_removed', 'key-paid-xxxx', [{ productId: water, qty: 1000, amount: 250 }]);
    sell('paid');
    // A whole bill cleared and never paid.
    recordRemoval(ctx, u.cashier, 'bill_cleared', 'key-gone-xxxx', [{ productId: water, qty: 2000, amount: 500 }]);
    expect(voidsReport(ctx, u.admin, '2026-11-06', '2026-11-06')).toMatchObject([
      { user: 'Cashier', kind: 'line_removed', invoiceNo: 'INV-00000001', items: 1, total: 250 },
      { user: 'Cashier', kind: 'bill_cleared', invoiceNo: null, items: 1, total: 500 },
    ]);
    expect(code(() => recordRemoval(ctx, u.cashier, 'line_removed', 'bad key!', [{ productId: water, qty: 1000, amount: 250 }]))).toBe('VALIDATION');
    expect(voidsReport(ctx, u.admin, '2026-11-05', '2026-11-05')).toEqual([]);
    expect(code(() => voidsReport(ctx, u.cashier, '2026-11-06', '2026-11-06'))).toBe('PERMISSION_DENIED');
  });

  it('a sale after 9 pm UTC is dated the next Saudi day in reports and the journal', () => {
    openShift(ctx, u.cashier, 0);
    t.advance(13 * 3_600_000 + 30 * 60_000);
    const r = sell('late');
    expect(salesSummary(ctx, u.admin, '2026-11-06', '2026-11-06').saleCount).toBe(1);
    expect(salesSummary(ctx, u.admin, '2026-11-05', '2026-11-05').saleCount).toBe(0);
    expect((ctx.db.prepare("SELECT entry_date AS d FROM journal_entries WHERE source_type = 'sale' AND source_id = ?").get(r.saleId) as { d: string }).d).toBe('2026-11-06');
  });
});
