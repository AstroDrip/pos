import { MILLI_PER_UNIT, roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { applyMovement } from './inventory';
import { postEntry } from './ledger';
import { requirePermission } from './users';

// Wastage and stock counts. Both are immutable documents (ADJ-000001...) with one stock movement per line
// and one journal entry: losses Dr 5100 Wastage and shrinkage / Cr 1200 Inventory, gains the reverse.
// Valued at the current weighted-average cost. Needs stock.adjust (supervisor, admin).

export interface WastageInput {
  requestKey: string;
  reason: string; // e.g. expired, damaged, spoiled
  lines: { productId: number; qty: number }[]; // milli-units thrown away (positive)
}

export interface CountInput {
  requestKey: string;
  reason: string; // e.g. "Monthly count, aisle 3"
  lines: { productId: number; countedQty: number }[]; // milli-units physically on the shelf
}

export interface AdjustmentResult {
  adjustmentId: number | null; // null when a count found no differences (nothing recorded)
  adjNo: string | null;
  changedLines: number;
  totalValue: number; // signed halalas: negative = loss
  replayed: boolean;
}

function product(ctx: Ctx, id: number) {
  const p = ctx.db.prepare('SELECT id, name_en, sell_mode FROM products WHERE id = ?').get(id) as { id: number; name_en: string; sell_mode: string } | undefined;
  if (!p) throw new DomainError('NOT_FOUND', `Product ${id} not found`);
  return p;
}

function checkQty(p: { name_en: string; sell_mode: string }, qty: number, allowZero: boolean) {
  if (!Number.isSafeInteger(qty) || qty < 0 || (!allowZero && qty === 0)) throw new DomainError('VALIDATION', `${p.name_en}: invalid quantity`);
  if (p.sell_mode === 'unit' && qty % 1000 !== 0) throw new DomainError('VALIDATION', `${p.name_en} is counted in whole units`);
}

function replay(ctx: Ctx, requestKey: string): AdjustmentResult | null {
  const r = ctx.db.prepare('SELECT id, adj_no, total_value FROM stock_adjustments WHERE request_key = ?').get(requestKey) as
    | { id: number; adj_no: string; total_value: number }
    | undefined;
  if (!r) return null;
  const n = (ctx.db.prepare('SELECT count(*) AS n FROM stock_adjustment_lines WHERE adjustment_id = ?').get(r.id) as { n: number }).n;
  return { adjustmentId: r.id, adjNo: r.adj_no, changedLines: n, totalValue: r.total_value, replayed: true };
}

function validateCommon(input: { requestKey: string; reason: string; lines: unknown[] }) {
  if (!/^[\w-]{8,64}$/.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  if (!input.reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  if (input.lines.length === 0) throw new DomainError('VALIDATION', 'Add at least one product');
  if (input.lines.length > 2000) throw new DomainError('VALIDATION', 'Too many lines');
}

interface PlannedLine {
  productId: number;
  systemQty: number;
  countedQty: number | null;
  qty: number; // signed change
}

function record(ctx: Ctx, userId: number, kind: 'waste' | 'count', requestKey: string, reason: string, planned: PlannedLine[]): AdjustmentResult {
  // Every product appears once, and outgoing or cost-less incoming movements use the current average cost
  // without changing it, so each line's value is known before the movements are written.
  const avgCost = ctx.db.prepare('SELECT avg_cost FROM stock_balances WHERE product_id = ?');
  const valued = planned.map((l) => {
    const unitCost = (avgCost.get(l.productId) as { avg_cost: number } | undefined)?.avg_cost ?? 0;
    return { ...l, unitCost, value: roundDiv(l.qty * unitCost, MILLI_PER_UNIT) };
  });
  const gain = valued.reduce((s, l) => s + Math.max(l.value, 0), 0);
  const loss = valued.reduce((s, l) => s + Math.max(-l.value, 0), 0);
  const total = gain - loss;

  const n = (ctx.db.prepare("UPDATE invoice_counters SET next_value = next_value + 1 WHERE series = 'ADJ' RETURNING next_value - 1 AS v").get() as { v: number }).v;
  const adjNo = `ADJ-${String(n).padStart(6, '0')}`;
  const createdAt = ctx.now();
  const id = Number(
    ctx.db
      .prepare('INSERT INTO stock_adjustments (adj_no, request_key, kind, reason, total_value, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(adjNo, requestKey, kind, reason, total, userId, createdAt).lastInsertRowid,
  );
  const insertLine = ctx.db.prepare(
    'INSERT INTO stock_adjustment_lines (adjustment_id, line_no, product_id, system_qty, counted_qty, qty, unit_cost, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  valued.forEach((l, i) => {
    const mv = applyMovement(ctx, { productId: l.productId, qty: l.qty, reason: kind === 'waste' ? 'waste' : 'count_adj', sourceType: 'stock_adjustment', sourceId: id, sourceLine: i + 1, userId });
    if (mv.value !== l.value) throw new Error(`Adjustment value mismatch for product ${l.productId}`); // rolls everything back
    insertLine.run(id, i + 1, l.productId, l.systemQty, l.countedQty, l.qty, l.unitCost, l.value);
  });
  postEntry(ctx, {
    date: storeDay(createdAt),
    sourceType: 'stock_adjustment',
    sourceId: id,
    memo: `${kind === 'waste' ? 'Wastage' : 'Stock count'} ${adjNo}: ${reason}`,
    lines: [
      { account: '5100', debit: loss },
      { account: '1200', credit: loss },
      { account: '1200', debit: gain },
      { account: '5100', credit: gain },
    ],
  });
  appendAudit(ctx, { userId, action: kind === 'waste' ? 'stock.waste' : 'stock.count', entity: 'stock_adjustment', entityId: id, details: { adjNo, reason, lines: planned.length, total } });
  return { adjustmentId: id, adjNo, changedLines: planned.length, totalValue: total, replayed: false };
}

/** Records goods thrown away (expired, damaged, spoiled). */
export function recordWastage(ctx: Ctx, userId: number, input: WastageInput): AdjustmentResult {
  requirePermission(ctx, userId, 'stock.adjust');
  validateCommon(input);
  return ctx.db.transaction((): AdjustmentResult => {
    const again = replay(ctx, input.requestKey);
    if (again) return again;
    const seen = new Set<number>();
    const planned = input.lines.map((l): PlannedLine => {
      const p = product(ctx, l.productId);
      if (seen.has(p.id)) throw new DomainError('VALIDATION', `${p.name_en} is listed twice`);
      seen.add(p.id);
      checkQty(p, l.qty, false);
      const bal = (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(p.id) as { qty: number } | undefined)?.qty ?? 0;
      return { productId: p.id, systemQty: bal, countedQty: null, qty: -l.qty };
    });
    return record(ctx, userId, 'waste', input.requestKey, input.reason.trim(), planned);
  })();
}

/**
 * Posts a stock count: each product's stock is set to the counted quantity; the difference is recorded.
 * Count when the shop is closed, or sales made between counting and posting will show as differences.
 */
export function postStockCount(ctx: Ctx, userId: number, input: CountInput): AdjustmentResult {
  requirePermission(ctx, userId, 'stock.adjust');
  validateCommon(input);
  return ctx.db.transaction((): AdjustmentResult => {
    const again = replay(ctx, input.requestKey);
    if (again) return again;
    const seen = new Set<number>();
    const planned: PlannedLine[] = [];
    for (const l of input.lines) {
      const p = product(ctx, l.productId);
      if (seen.has(p.id)) throw new DomainError('VALIDATION', `${p.name_en} is listed twice`);
      seen.add(p.id);
      checkQty(p, l.countedQty, true);
      const bal = (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(p.id) as { qty: number } | undefined)?.qty ?? 0;
      if (l.countedQty !== bal) planned.push({ productId: p.id, systemQty: bal, countedQty: l.countedQty, qty: l.countedQty - bal });
    }
    if (planned.length === 0) {
      appendAudit(ctx, { userId, action: 'stock.count', entity: 'stock_adjustment', details: { reason: input.reason.trim(), lines: input.lines.length, differences: 0 } });
      return { adjustmentId: null, adjNo: null, changedLines: 0, totalValue: 0, replayed: false };
    }
    return record(ctx, userId, 'count', input.requestKey, input.reason.trim(), planned);
  })();
}
