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

export function findCustomers(ctx: Ctx, text: string): Customer[] {
  const t = text.trim().replace(/[%_]/g, '');
  if (!t) return [];
  return ctx.db
    .prepare('SELECT id, name, phone, vat_number AS vatNumber FROM customers WHERE phone LIKE ? OR name LIKE ? ORDER BY name LIMIT 20')
    .all(`%${t}%`, `%${t}%`) as Customer[];
}

export function customerHistory(ctx: Ctx, customerId: number) {
  return ctx.db
    .prepare('SELECT id, invoice_no AS invoiceNo, total_incl AS totalIncl, created_at AS createdAt FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 100')
    .all(customerId) as { id: number; invoiceNo: string; totalIncl: number; createdAt: string }[];
}
