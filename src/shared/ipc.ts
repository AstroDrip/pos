import { z } from 'zod';

// The only operations the renderer can ask for. Every payload is validated in the main process.
const int = z.number().int().safe();
const money = int.nonnegative();

export const schemas = {
  'auth.status': z.null(),
  'auth.setupAdmin': z.object({ username: z.string().min(1).max(40), displayName: z.string().min(1).max(80), pin: z.string().regex(/^\d{4,8}$/) }),
  'auth.login': z.object({ username: z.string().min(1).max(40), pin: z.string().max(8) }),
  'auth.logout': z.null(),
  'shift.current': z.null(),
  'shift.open': z.object({ openingFloat: money }),
  'shift.close': z.object({ countedCash: money }),
  'cash.move': z.object({ kind: z.enum(['in', 'out']), amount: money.positive(), reason: z.string().min(1).max(200) }),
  'catalog.lookup': z.object({ code: z.string().min(1).max(64) }),
  'catalog.search': z.object({ text: z.string().max(64) }),
  'catalog.create': z.object({
    sku: z.string().min(1).max(40),
    nameAr: z.string().min(1).max(120),
    nameEn: z.string().min(1).max(120),
    unitCode: z.enum(['PCS', 'KG']),
    sellMode: z.enum(['unit', 'weight']),
    vatRateBp: int.min(0).max(10_000),
    priceIncl: money,
    barcodes: z.array(z.string().max(32)).max(10).optional(),
    plu: z.string().max(6).optional(),
  }),
  'sale.finalize': z.object({
    idempotencyKey: z.string().regex(/^[\w-]{8,64}$/),
    lines: z.array(z.object({ productId: int.positive(), qty: int.positive(), discount: money.optional() })).min(1).max(500),
    payments: z.array(z.object({ tender: z.enum(['cash', 'card']), amount: money.positive(), reference: z.string().max(40).optional() })).min(1).max(5),
    approver: z.object({ username: z.string().max(40), pin: z.string().max(8) }).optional(),
    customerId: int.positive().optional(),
  }),
  'sale.receipt': z.object({ saleId: int.positive() }),
  'sale.print': z.object({ saleId: int.positive(), copy: z.boolean() }),
  'hold.create': z.object({ label: z.string().max(40), lines: z.array(z.object({ productId: int.positive(), qty: int.positive() })).min(1).max(500), customerId: int.positive().optional(), billKey: z.string().regex(/^[\w-]{8,64}$/).optional() }),
  'hold.list': z.null(),
  'hold.recall': z.object({ id: int.positive() }),
  'supplier.list': z.null(),
  'supplier.create': z.object({ name: z.string().min(1).max(120), phone: z.string().max(20).optional(), vatNumber: z.string().max(15).optional(), paymentTermsDays: int.min(0).max(365).optional() }),
  'customer.find': z.object({ text: z.string().max(40) }),
  'customer.create': z.object({ name: z.string().min(1).max(120), phone: z.string().max(20).optional(), vatNumber: z.string().max(15).optional() }),
  'grn.create': z.object({ supplierId: int.positive(), reference: z.string().max(60).optional(), lines: z.array(z.object({ productId: int.positive(), qty: int.positive(), unitCost: money })).min(1).max(500) }),
  'report.stock': z.object({ onlyLow: z.boolean() }),
  'report.sales': z.object({ fromDay: z.iso.date(), toDay: z.iso.date() }),
  'import.dryRun': z.object({ kind: z.enum(['products', 'suppliers']), csv: z.string().max(5_000_000) }),
  'import.commit': z.object({ kind: z.enum(['products', 'suppliers']), csv: z.string().max(5_000_000), acceptWarnings: z.boolean() }),
  'bill.removed': z.object({ kind: z.enum(['line_removed', 'bill_cleared']), lines: z.array(z.object({ productId: int.positive(), qty: int.positive(), amount: money })).min(1).max(500), billKey: z.string().regex(/^[\w-]{8,64}$/) }),
  'report.voids': z.object({ fromDay: z.iso.date(), toDay: z.iso.date() }),
  'user.list': z.null(),
  'user.create': z.object({ username: z.string().min(1).max(40), displayName: z.string().min(1).max(80), pin: z.string().regex(/^\d{4,8}$/), role: z.enum(['admin', 'supervisor', 'cashier']) }),
  'backup.status': z.null(),
  'backup.setupKey': z.null(),
  'backup.run': z.null(),
  'restore.prepare': z.object({ recoveryCode: z.string().max(80).optional() }),
  'restore.apply': z.null(),
} as const;

export type Channel = keyof typeof schemas;
export const CHANNELS = Object.keys(schemas) as Channel[];

export type IpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
