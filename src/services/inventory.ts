import { MILLI_PER_UNIT, roundDiv } from '../core/money';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { postEntry } from './ledger';
import { requirePermission } from './users';

export type MovementReason = 'sale' | 'refund' | 'grn' | 'purchase_return' | 'waste' | 'count_adj' | 'opening';

export interface MovementInput {
  productId: number;
  qty: number; // signed milli-units
  unitCost?: number; // halalas per whole unit; required for incoming stock
  reason: MovementReason;
  sourceType: string;
  sourceId: number;
  sourceLine: number;
  userId: number;
}

export interface MovementResult {
  unitCost: number;
  value: number; // halalas, signed like qty
  newQty: number;
  wentNegative: boolean;
}

export function negativeStockPolicy(ctx: Ctx): 'allow' | 'block' {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE key = 'negative_stock_policy'").get() as { value: string } | undefined;
  return row?.value === 'block' ? 'block' : 'allow';
}

/**
 * Records one stock movement and updates the running balance and weighted-average cost.
 * Must run inside the caller's transaction. The movement's unique source key stops duplicates.
 */
export function applyMovement(ctx: Ctx, m: MovementInput): MovementResult {
  if (!Number.isSafeInteger(m.qty) || m.qty === 0) throw new DomainError('VALIDATION', 'Movement qty must be a non-zero integer');
  const bal = (ctx.db.prepare('SELECT qty, avg_cost FROM stock_balances WHERE product_id = ?').get(m.productId) as
    | { qty: number; avg_cost: number }
    | undefined) ?? { qty: 0, avg_cost: 0 };

  let unitCost: number;
  let newAvg = bal.avg_cost;
  if (m.qty > 0 && m.unitCost !== undefined) {
    unitCost = m.unitCost;
    if (!Number.isSafeInteger(unitCost) || unitCost < 0) throw new DomainError('VALIDATION', 'Invalid unit cost');
    newAvg = bal.qty > 0 ? roundDiv(bal.qty * bal.avg_cost + m.qty * unitCost, bal.qty + m.qty) : unitCost;
  } else {
    unitCost = bal.avg_cost; // outgoing stock (and returns to shelf) move at current average cost
  }

  const newQty = bal.qty + m.qty;
  const wentNegative = newQty < 0 && m.qty < 0;
  if (wentNegative && negativeStockPolicy(ctx) === 'block') {
    throw new DomainError('NEGATIVE_STOCK', `Not enough stock for product ${m.productId}`);
  }

  ctx.db
    .prepare(
      `INSERT INTO stock_movements (product_id, qty, unit_cost, reason, source_type, source_id, source_line, user_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.productId, m.qty, unitCost, m.reason, m.sourceType, m.sourceId, m.sourceLine, m.userId, ctx.now());
  ctx.db
    .prepare(
      `INSERT INTO stock_balances (product_id, qty, avg_cost) VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET qty = excluded.qty, avg_cost = excluded.avg_cost`,
    )
    .run(m.productId, newQty, newAvg);

  return { unitCost, value: roundDiv(m.qty * unitCost, MILLI_PER_UNIT), newQty, wentNegative };
}

export interface GrnInput {
  supplierId: number;
  reference?: string;
  lines: { productId: number; qty: number; unitCost: number }[];
}

/** Receives goods: stock in at cost (excl. VAT), Dr Inventory / Cr Goods received not invoiced. */
export function receiveGoods(ctx: Ctx, userId: number, input: GrnInput): { grnId: number; grnNo: string } {
  requirePermission(ctx, userId, 'stock.receive');
  if (input.lines.length === 0) throw new DomainError('VALIDATION', 'GRN needs at least one line');
  return ctx.db.transaction(() => {
    const supplier = ctx.db.prepare('SELECT id FROM suppliers WHERE id = ? AND active = 1').get(input.supplierId);
    if (!supplier) throw new DomainError('NOT_FOUND', 'Supplier not found');
    const n = (ctx.db.prepare("UPDATE invoice_counters SET next_value = next_value + 1 WHERE series = 'GRN' RETURNING next_value - 1 AS v").get() as { v: number }).v;
    const grnNo = `GRN-${String(n).padStart(6, '0')}`;
    let total = 0;
    for (const l of input.lines) {
      if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new DomainError('VALIDATION', 'GRN qty must be positive');
      if (!Number.isSafeInteger(l.unitCost) || l.unitCost < 0) throw new DomainError('VALIDATION', 'GRN cost must be >= 0');
      total += roundDiv(l.qty * l.unitCost, MILLI_PER_UNIT);
    }
    const grnId = Number(
      ctx.db
        .prepare('INSERT INTO goods_receipts (grn_no, supplier_id, reference, total_cost, user_id, received_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(grnNo, input.supplierId, input.reference ?? null, total, userId, ctx.now()).lastInsertRowid,
    );
    input.lines.forEach((l, i) => {
      ctx.db.prepare('INSERT INTO grn_lines (grn_id, line_no, product_id, qty, unit_cost) VALUES (?, ?, ?, ?, ?)').run(grnId, i + 1, l.productId, l.qty, l.unitCost);
      applyMovement(ctx, { productId: l.productId, qty: l.qty, unitCost: l.unitCost, reason: 'grn', sourceType: 'grn', sourceId: grnId, sourceLine: i + 1, userId });
    });
    postEntry(ctx, {
      date: ctx.now().slice(0, 10),
      sourceType: 'grn',
      sourceId: grnId,
      memo: `Goods received ${grnNo}`,
      lines: [
        { account: '1200', debit: total },
        { account: '2100', credit: total },
      ],
    });
    appendAudit(ctx, { userId, action: 'stock.receive', entity: 'grn', entityId: grnId, details: { grnNo, total, lines: input.lines.length } });
    return { grnId, grnNo };
  })();
}

/** Balance table vs. sum of movements. Must always return an empty list. */
export function stockDrift(ctx: Ctx): { product_id: number; balance: number; movements: number }[] {
  return ctx.db
    .prepare(
      `SELECT b.product_id, b.qty AS balance, COALESCE(SUM(m.qty),0) AS movements
       FROM stock_balances b LEFT JOIN stock_movements m ON m.product_id = b.product_id
       GROUP BY b.product_id HAVING balance <> movements`,
    )
    .all() as { product_id: number; balance: number; movements: number }[];
}
