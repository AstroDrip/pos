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
  }),
  'sale.receipt': z.object({ saleId: int.positive() }),
  'sale.print': z.object({ saleId: int.positive(), copy: z.boolean() }),
} as const;

export type Channel = keyof typeof schemas;
export const CHANNELS = Object.keys(schemas) as Channel[];

export type IpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
