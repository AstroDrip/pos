import { z } from 'zod';

// What the POS sends, and all the dashboard ever sees. Every figure is worked out by the POS's own services.
// Money is integer halalas. Quantity is integer thousandths. null means the POS could not supply it: never read it as 0.

const money = z.number().int().safe();
const count = z.number().int().nonnegative().safe();
const moneyOrNull = money.nullable();
const name = z.string().max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const daySnapshot = z.object({
  day,
  salesInclVat: money,
  transactions: count,
  netSales: money,
  returns: money,
  discounts: money,
  cogs: money,
  grossProfit: money,
  operatingExpenses: money,
  netProfit: money,
  outputVat: money,
  inputVat: money,
  cash: money,
  card: money,
  onAccount: money,
  supplierCreditPurchases: money,
  expenses: z.array(z.object({ code: z.string().max(10), name, amount: money })).max(100),
  byCategory: z.array(z.object({ name, net: money, qty: money })).max(200),
  byProduct: z.array(z.object({ sku: z.string().max(60), name, qty: money, net: money })).max(500),
  provisional: z.boolean(),
});
export type DaySnapshot = z.infer<typeof daySnapshot>;

export const positionSnapshot = z.object({
  asOf: z.string().max(40),
  inventoryValue: moneyOrNull,
  cashAndBank: moneyOrNull,
  receivablesOutstanding: moneyOrNull,
  receivablesOverdue: moneyOrNull,
  customersWithBalance: count.nullable(),
  customerAdvances: moneyOrNull,
  payablesOutstanding: moneyOrNull,
  payablesOverdue: moneyOrNull,
  suppliersWithBalance: count.nullable(),
  supplierAdvances: moneyOrNull,
  expensesOutstanding: moneyOrNull,
  prepaidWaiting: moneyOrNull,
  vatPending: moneyOrNull,
  provisionalReasons: z.array(z.string().max(200)).max(20),
  reconcile: z.object({ fromDay: day, toDay: day, salesInclVat: money, transactions: count, netProfit: money }),
  integrity: z.object({ checkedAt: z.string().max(40), critical: count, warnings: count }).nullable(),
});
export type PositionSnapshot = z.infer<typeof positionSnapshot>;

const stockRow = z.object({ sku: z.string().max(60), name, qty: money, reorderLevel: money });
export const stockSnapshot = z.object({
  asOf: z.string().max(40),
  products: count,
  inStock: count,
  lowStockCount: count,
  outOfStockCount: count,
  lowStock: z.array(stockRow).max(100),
  outOfStock: z.array(stockRow).max(100),
  movements: z.array(z.object({ reason: z.string().max(40), lines: count, qty: money })).max(30),
  movementDays: count,
});
export type StockSnapshot = z.infer<typeof stockSnapshot>;

const balanceRow = z.object({ name, balance: money, overdue: money });
const ageing = z.object({ current: money, d1to30: money, d31to60: money, d61to90: money, over90: money }).nullable();
export const creditSnapshot = z.object({
  asOf: z.string().max(40),
  customers: z.array(balanceRow).max(100),
  suppliers: z.array(balanceRow).max(100),
  customerAgeing: ageing,
  supplierAgeing: ageing,
});
export type CreditSnapshot = z.infer<typeof creditSnapshot>;

export const shiftSnapshot = z.union([
  z.object({ open: z.literal(false) }),
  z.object({ open: z.literal(true), cashier: name, openedAt: z.string().max(40), openingFloat: money, expectedCash: money }),
]);
export type ShiftSnapshot = z.infer<typeof shiftSnapshot>;

const key = z.string().min(1).max(40);
const base = { eventId: z.uuid(), version: z.number().int().positive().max(2_000_000_000), createdAt: z.iso.datetime() };

export const syncEvent = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('day'), snapKey: day, payload: daySnapshot }),
  z.object({ ...base, kind: z.literal('position'), snapKey: key, payload: positionSnapshot }),
  z.object({ ...base, kind: z.literal('stock'), snapKey: key, payload: stockSnapshot }),
  z.object({ ...base, kind: z.literal('credit'), snapKey: key, payload: creditSnapshot }),
  z.object({ ...base, kind: z.literal('shift'), snapKey: key, payload: shiftSnapshot }),
]);
export type SyncEvent = z.infer<typeof syncEvent>;

export const syncBody = z.object({ appVersion: z.string().max(30).optional(), events: z.array(syncEvent).min(1).max(100) });
