import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { requirePermission } from './users';

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  vatNumber: string | null;
  paymentTermsDays: number;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  vatNumber: string | null;
}

const VAT_RE = /^3\d{13}3$/; // Saudi VAT registration numbers: 15 digits, start and end with 3

function cleanVat(v: string | undefined): string | null {
  const t = v?.trim() ?? '';
  if (!t) return null;
  if (!VAT_RE.test(t)) throw new DomainError('VALIDATION', 'VAT number must be 15 digits starting and ending with 3');
  return t;
}

function cleanPhone(v: string | undefined): string | null {
  const t = (v ?? '').replace(/[\s-]/g, '');
  if (!t) return null;
  if (!/^\+?\d{7,15}$/.test(t)) throw new DomainError('VALIDATION', 'Invalid phone number');
  return t;
}

export function createSupplier(ctx: Ctx, userId: number, input: { name: string; phone?: string; vatNumber?: string; paymentTermsDays?: number }): number {
  requirePermission(ctx, userId, 'supplier.manage');
  if (!input.name.trim()) throw new DomainError('VALIDATION', 'Supplier name is required');
  const terms = input.paymentTermsDays ?? 0;
  if (!Number.isSafeInteger(terms) || terms < 0 || terms > 365) throw new DomainError('VALIDATION', 'Invalid payment terms');
  return ctx.db.transaction(() => {
    const id = Number(
      ctx.db
        .prepare('INSERT INTO suppliers (name, phone, vat_number, payment_terms_days, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.name.trim(), cleanPhone(input.phone), cleanVat(input.vatNumber), terms, ctx.now()).lastInsertRowid,
    );
    appendAudit(ctx, { userId, action: 'supplier.create', entity: 'supplier', entityId: id, details: { name: input.name } });
    return id;
  })();
}

export function listSuppliers(ctx: Ctx): Supplier[] {
  return ctx.db
    .prepare('SELECT id, name, phone, vat_number AS vatNumber, payment_terms_days AS paymentTermsDays FROM suppliers WHERE active = 1 ORDER BY name')
    .all() as Supplier[];
}

export function createCustomer(ctx: Ctx, userId: number, input: { name: string; phone?: string; vatNumber?: string }): number {
  requirePermission(ctx, userId, 'customer.manage');
  if (!input.name.trim()) throw new DomainError('VALIDATION', 'Customer name is required');
  const phone = cleanPhone(input.phone);
  return ctx.db.transaction(() => {
    if (phone && ctx.db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(phone)) {
      throw new DomainError('CONFLICT', 'A customer with this phone already exists');
    }
    const id = Number(
      ctx.db
        .prepare('INSERT INTO customers (name, phone, vat_number, created_at) VALUES (?, ?, ?, ?)')
        .run(input.name.trim(), phone, cleanVat(input.vatNumber), ctx.now()).lastInsertRowid,
    );
    appendAudit(ctx, { userId, action: 'customer.create', entity: 'customer', entityId: id });
    return id;
  })();
}

type ActivityRow = { c: number; at: string; maxId: number };
interface ActivityCache { lastSale: number; lastReceipt: number; last: Map<number, string> }
let activity = new WeakMap<Ctx['db'], ActivityCache>();

/** Tests only. */
export function resetCustomerActivityCache(): void {
  activity = new WeakMap();
}

/** customerId -> time of the latest sale or customer payment. Reads only rows added since the last call. */
function customerActivity(ctx: Ctx): Map<number, string> {
  const a = activity.get(ctx.db) ?? { lastSale: 0, lastReceipt: 0, last: new Map<number, string>() };
  const take = (rows: ActivityRow[]) => {
    let top = 0;
    for (const r of rows) {
      if ((a.last.get(r.c) ?? '') < r.at) a.last.set(r.c, r.at);
      top = Math.max(top, r.maxId);
    }
    return top;
  };
  a.lastSale = Math.max(a.lastSale, take(ctx.db.prepare('SELECT customer_id AS c, MAX(created_at) AS at, MAX(id) AS maxId FROM sales WHERE id > ? AND customer_id IS NOT NULL GROUP BY customer_id').all(a.lastSale) as ActivityRow[]));
  a.lastReceipt = Math.max(a.lastReceipt, take(ctx.db.prepare('SELECT customer_id AS c, MAX(created_at) AS at, MAX(id) AS maxId FROM customer_receipts WHERE id > ? GROUP BY customer_id').all(a.lastReceipt) as ActivityRow[]));
  activity.set(ctx.db, a);
  return a.last;
}

/**
 * Customer search order: exact phone or customer number first, then name or phone starting with the text,
 * then the rest; inside each group the customer with the most recent sale or payment first, then by name.
 */
export function rankCustomers<T extends { id: number; name: string; phone: string | null }>(ctx: Ctx, rows: T[], text: string, limit = 20): T[] {
  const t = text.trim().toLowerCase();
  const last = customerActivity(ctx);
  const group = (r: T) => {
    const phone = r.phone ?? '';
    if (phone === t || String(r.id) === t) return 0;
    return r.name.toLowerCase().startsWith(t) || phone.startsWith(t) ? 1 : 2;
  };
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return rows
    .map((r) => ({ r, g: group(r), at: last.get(r.id) ?? '' }))
    .sort((a, b) => a.g - b.g || cmp(b.at, a.at) || cmp(a.r.name, b.r.name))
    .slice(0, limit)
    .map((x) => x.r);
}

export function findCustomers(ctx: Ctx, text: string): Customer[] {
  const t = text.trim().replace(/[%_]/g, '');
  if (!t) return [];
  const rows = ctx.db
    .prepare('SELECT id, name, phone, vat_number AS vatNumber FROM customers WHERE phone LIKE ? OR name LIKE ? LIMIT 2000')
    .all(`%${t}%`, `%${t}%`) as Customer[];
  return rankCustomers(ctx, rows, t);
}

export function customerHistory(ctx: Ctx, customerId: number) {
  return ctx.db
    .prepare('SELECT id, invoice_no AS invoiceNo, total_incl AS totalIncl, created_at AS createdAt FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 100')
    .all(customerId) as { id: number; invoiceNo: string; totalIncl: number; createdAt: string }[];
}
