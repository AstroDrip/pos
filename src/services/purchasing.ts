import { MILLI_PER_UNIT, roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { applyMovement, receiveGoods } from './inventory';
import { postEntry, type PostingLine } from './ledger';
import { openShiftId } from './shifts';
import { requirePermission } from './users';

// Purchasing (plan Phase 4). PROVISIONAL posting rules until the accountant approves:
//  Goods receipt (existing):  Dr 1200 Inventory           / Cr 2100 Goods received not invoiced  (cost excl. VAT)
//  Supplier invoice:          Dr 2100 (matched receipts)  + Dr/Cr 5010 price difference
//                             + Dr 2210 recoverable VAT (or Dr 5010 if not recoverable) / Cr 2000 Accounts payable (gross)
//  Return to supplier:        Dr 2000 (credit gross) / Cr 1200 (stock at average cost) + Cr 2210 VAT + Cr/Dr 5010 difference
//  Supplier payment:          Dr 2000 / Cr 1030 Bank or Cr 1010 Cash (till, inside an open shift)
//  Opening balance owed:      Dr 3000 Opening balance equity / Cr 2000
// Supplier balance = opening + invoices − returns − payments. Their total always equals the 2000 account (tested).

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[\w-]{8,64}$/;
const today = (ctx: Ctx) => storeDay(ctx.now());
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function nextNo(ctx: Ctx, series: 'PINV' | 'PRET' | 'SPAY', prefix: string) {
  const n = (ctx.db.prepare('UPDATE invoice_counters SET next_value = next_value + 1 WHERE series = ? RETURNING next_value - 1 AS v').get(series) as { v: number }).v;
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

function supplier(ctx: Ctx, id: number) {
  const s = ctx.db.prepare('SELECT id, name, vat_number, payment_terms_days FROM suppliers WHERE id = ?').get(id) as
    | { id: number; name: string; vat_number: string | null; payment_terms_days: number }
    | undefined;
  if (!s) throw new DomainError('NOT_FOUND', 'Supplier not found');
  return s;
}

function checkVat(net: number, vat: number, recoverable: boolean, supplierVatNo: string | undefined) {
  if (!Number.isSafeInteger(vat) || vat < 0) throw new DomainError('VALIDATION', 'VAT must be zero or more');
  if (vat > net) throw new DomainError('VALIDATION', 'VAT is larger than the net amount. Check the invoice.');
  if (recoverable) {
    if (vat <= 0) throw new DomainError('VALIDATION', 'Recoverable VAT needs the VAT amount from the invoice');
    if (!/^3\d{13}3$/.test(supplierVatNo?.trim() ?? '')) throw new DomainError('VALIDATION', "Recoverable VAT needs the supplier's 15-digit VAT number (starts and ends with 3)");
  }
}

// ── supplier invoices ───────────────────────────────────────

export interface UninvoicedGrn {
  grnId: number;
  grnNo: string;
  supplierId: number;
  supplier: string;
  reference: string | null;
  receivedAt: string;
  totalCost: number;
}

/** Goods receipts not yet matched to a supplier invoice (the detail behind account 2100). */
export function uninvoicedGrns(ctx: Ctx, userId: number, supplierId?: number): UninvoicedGrn[] {
  requirePermission(ctx, userId, 'purchase.view');
  return ctx.db
    .prepare(
      `SELECT g.id AS grnId, g.grn_no AS grnNo, g.supplier_id AS supplierId, s.name AS supplier, g.reference, g.received_at AS receivedAt, g.total_cost AS totalCost
       FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id
       WHERE g.id NOT IN (SELECT grn_id FROM purchase_invoice_grns) ${supplierId ? 'AND g.supplier_id = ?' : ''} ORDER BY g.id`,
    )
    .all(...(supplierId ? [supplierId] : [])) as UninvoicedGrn[];
}

export interface PurchaseInvoiceInput {
  requestKey: string;
  supplierId: number;
  supplierInvoiceNo: string;
  supplierVatNo?: string;
  invoiceDate: string;
  dueDate?: string; // default: invoice date + supplier payment terms
  grnIds: number[]; // goods receipts this invoice covers (same supplier)
  /** Goods on the invoice that were not received through a goods receipt yet: received now, in the same transaction. */
  newLines?: { productId: number; qty: number; unitCost: number }[];
  invoiceNet: number; // net (excl. VAT) on the supplier's invoice
  vatAmount: number; // from the supplier's invoice
  vatRecoverable: boolean;
  differenceReason?: string; // required when the invoice net differs from the received goods value
  notes?: string;
}

export function createPurchaseInvoice(ctx: Ctx, userId: number, input: PurchaseInvoiceInput): { invoiceId: number; pinvNo: string; replayed: boolean } {
  requirePermission(ctx, userId, 'purchase.manage');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  if (!input.supplierInvoiceNo.trim()) throw new DomainError('VALIDATION', "Enter the supplier's invoice number");
  if (!DAY.test(input.invoiceDate) || (input.dueDate && !DAY.test(input.dueDate))) throw new DomainError('VALIDATION', 'Dates must be YYYY-MM-DD');
  if (input.invoiceDate > today(ctx)) throw new DomainError('VALIDATION', 'Invoice date cannot be in the future');
  if (!Number.isSafeInteger(input.invoiceNet) || input.invoiceNet <= 0) throw new DomainError('VALIDATION', 'Invoice net amount must be more than zero');
  checkVat(input.invoiceNet, input.vatAmount, input.vatRecoverable, input.supplierVatNo);
  if (input.grnIds.length === 0 && !(input.newLines && input.newLines.length)) throw new DomainError('VALIDATION', 'Choose the goods receipts this invoice covers, or add the goods');

  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id, pinv_no FROM purchase_invoices WHERE request_key = ?').get(input.requestKey) as { id: number; pinv_no: string } | undefined;
    if (done) return { invoiceId: done.id, pinvNo: done.pinv_no, replayed: true };
    const sup = supplier(ctx, input.supplierId);
    const dup = ctx.db.prepare('SELECT pinv_no FROM purchase_invoices WHERE supplier_id = ? AND supplier_invoice_no = ?').get(sup.id, input.supplierInvoiceNo.trim()) as { pinv_no: string } | undefined;
    if (dup) throw new DomainError('CONFLICT', `Invoice ${input.supplierInvoiceNo} from ${sup.name} is already entered (${dup.pinv_no})`);

    const grnIds = [...new Set(input.grnIds)];
    if (input.newLines?.length) {
      // Received together with the invoice: a normal goods receipt (stock, cost, journal), then matched below.
      grnIds.push(receiveGoods(ctx, userId, { requestKey: `${input.requestKey}-grn`, supplierId: sup.id, reference: input.supplierInvoiceNo.trim(), lines: input.newLines }).grnId);
    }
    let goodsNet = 0;
    for (const id of grnIds) {
      const g = ctx.db.prepare('SELECT id, grn_no, supplier_id, total_cost FROM goods_receipts WHERE id = ?').get(id) as { id: number; grn_no: string; supplier_id: number; total_cost: number } | undefined;
      if (!g) throw new DomainError('NOT_FOUND', 'Goods receipt not found');
      if (g.supplier_id !== sup.id) throw new DomainError('VALIDATION', `${g.grn_no} is from another supplier`);
      if (ctx.db.prepare('SELECT 1 FROM purchase_invoice_grns WHERE grn_id = ?').get(id)) throw new DomainError('CONFLICT', `${g.grn_no} is already on another supplier invoice`);
      goodsNet += g.total_cost;
    }
    const difference = input.invoiceNet - goodsNet;
    if (difference !== 0 && !input.differenceReason?.trim()) {
      throw new DomainError('VALIDATION', `The invoice net differs from the goods received by ${difference / 100} SAR. Give a reason (e.g. price change, delivery charge).`);
    }
    const gross = input.invoiceNet + input.vatAmount;
    const due = input.dueDate || addDays(input.invoiceDate, sup.payment_terms_days);
    const pinvNo = nextNo(ctx, 'PINV', 'PI');
    const id = Number(
      ctx.db
        .prepare(
          `INSERT INTO purchase_invoices (pinv_no, request_key, supplier_id, supplier_invoice_no, supplier_vat_no, invoice_date, due_date, goods_net, invoice_net,
             vat_amount, vat_recoverable, gross, difference_reason, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(pinvNo, input.requestKey, sup.id, input.supplierInvoiceNo.trim(), input.supplierVatNo?.trim() || sup.vat_number, input.invoiceDate, due, goodsNet,
          input.invoiceNet, input.vatAmount, input.vatRecoverable ? 1 : 0, gross, input.differenceReason?.trim() || null, input.notes?.trim() || null, userId, ctx.now()).lastInsertRowid,
    );
    for (const g of grnIds) ctx.db.prepare('INSERT INTO purchase_invoice_grns (invoice_id, grn_id) VALUES (?, ?)').run(id, g);
    const lines: PostingLine[] = [
      { account: '2100', debit: goodsNet },
      difference >= 0 ? { account: '5010', debit: difference } : { account: '5010', credit: -difference },
      { account: input.vatRecoverable ? '2210' : '5010', debit: input.vatAmount },
      { account: '2000', credit: gross },
    ];
    postEntry(ctx, { date: input.invoiceDate, sourceType: 'purchase_invoice', sourceId: id, memo: `Supplier invoice ${input.supplierInvoiceNo.trim()} (${sup.name})`, lines });
    appendAudit(ctx, { userId, action: 'purchase.invoice', entity: 'purchase_invoice', entityId: id, details: { pinvNo, supplierId: sup.id, supplierInvoiceNo: input.supplierInvoiceNo.trim(), goodsNet, invoiceNet: input.invoiceNet, vat: input.vatAmount, grns: grnIds } });
    return { invoiceId: id, pinvNo, replayed: false };
  })();
}

// ── returns to supplier ─────────────────────────────────────

export interface PurchaseReturnInput {
  requestKey: string;
  supplierId: number;
  supplierCreditRef?: string;
  returnDate: string;
  reason: string;
  lines: { productId: number; qty: number }[];
  creditNet: number; // net credit agreed with the supplier (their credit note)
  vatAmount: number;
  vatRecoverable: boolean;
}

export function createPurchaseReturn(ctx: Ctx, userId: number, input: PurchaseReturnInput): { returnId: number; pretNo: string; stockValue: number; replayed: boolean } {
  requirePermission(ctx, userId, 'purchase.manage');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  if (!input.reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  if (!DAY.test(input.returnDate) || input.returnDate > today(ctx)) throw new DomainError('VALIDATION', 'Return date must be today or earlier');
  if (input.lines.length === 0) throw new DomainError('VALIDATION', 'Add the products being returned');
  if (!Number.isSafeInteger(input.creditNet) || input.creditNet < 0) throw new DomainError('VALIDATION', 'Credit amount must be zero or more');
  const sup0 = supplier(ctx, input.supplierId);
  checkVat(input.creditNet, input.vatAmount, input.vatRecoverable, sup0.vat_number ?? undefined);
  if (input.creditNet + input.vatAmount <= 0) throw new DomainError('VALIDATION', 'Enter the credit the supplier gives for this return');

  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id, pret_no, stock_value FROM purchase_returns WHERE request_key = ?').get(input.requestKey) as { id: number; pret_no: string; stock_value: number } | undefined;
    if (done) return { returnId: done.id, pretNo: done.pret_no, stockValue: done.stock_value, replayed: true };
    const seen = new Set<number>();
    for (const l of input.lines) {
      const p = ctx.db.prepare('SELECT name_en, sell_mode FROM products WHERE id = ?').get(l.productId) as { name_en: string; sell_mode: string } | undefined;
      if (!p) throw new DomainError('NOT_FOUND', 'Product not found');
      if (seen.has(l.productId)) throw new DomainError('VALIDATION', `${p.name_en} is listed twice`);
      seen.add(l.productId);
      if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || (p.sell_mode === 'unit' && l.qty % 1000 !== 0)) throw new DomainError('VALIDATION', `${p.name_en}: invalid quantity`);
      const onHand = (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(l.productId) as { qty: number } | undefined)?.qty ?? 0;
      if (l.qty > onHand) throw new DomainError('VALIDATION', `${p.name_en}: only ${onHand / 1000} in stock, cannot return ${l.qty / 1000}`);
    }
    // Each product appears once and leaves at the current average cost, so the stock value is known up front.
    const avg = ctx.db.prepare('SELECT avg_cost FROM stock_balances WHERE product_id = ?');
    const valued = input.lines.map((l) => {
      const unitCost = (avg.get(l.productId) as { avg_cost: number } | undefined)?.avg_cost ?? 0;
      return { ...l, unitCost, value: roundDiv(l.qty * unitCost, MILLI_PER_UNIT) };
    });
    const stockValue = valued.reduce((sum, l) => sum + l.value, 0);
    const pretNo = nextNo(ctx, 'PRET', 'PR');
    const gross = input.creditNet + input.vatAmount;
    const id = Number(
      ctx.db
        .prepare(`INSERT INTO purchase_returns (pret_no, request_key, supplier_id, supplier_credit_ref, return_date, stock_value, credit_net, vat_amount, vat_recoverable, gross, reason, user_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(pretNo, input.requestKey, sup0.id, input.supplierCreditRef?.trim() || null, input.returnDate, stockValue, input.creditNet, input.vatAmount, input.vatRecoverable ? 1 : 0, gross, input.reason.trim(), userId, ctx.now())
        .lastInsertRowid,
    );
    valued.forEach((l, i) => {
      const mv = applyMovement(ctx, { productId: l.productId, qty: -l.qty, reason: 'purchase_return', sourceType: 'purchase_return', sourceId: id, sourceLine: i + 1, userId });
      if (-mv.value !== l.value) throw new Error(`Return value mismatch for product ${l.productId}`); // rolls everything back
      ctx.db.prepare('INSERT INTO purchase_return_lines (return_id, line_no, product_id, qty, unit_cost, value) VALUES (?, ?, ?, ?, ?, ?)').run(id, i + 1, l.productId, l.qty, l.unitCost, l.value);
    });
    const difference = input.creditNet - stockValue;
    postEntry(ctx, {
      date: input.returnDate,
      sourceType: 'purchase_return',
      sourceId: id,
      memo: `Return to ${sup0.name} ${pretNo}: ${input.reason.trim()}`,
      lines: [
        { account: '2000', debit: gross },
        { account: '1200', credit: stockValue },
        { account: input.vatRecoverable ? '2210' : '5010', credit: input.vatAmount },
        difference >= 0 ? { account: '5010', credit: difference } : { account: '5010', debit: -difference },
      ],
    });
    appendAudit(ctx, { userId, action: 'purchase.return', entity: 'purchase_return', entityId: id, details: { pretNo, supplierId: sup0.id, stockValue, creditNet: input.creditNet, vat: input.vatAmount } });
    return { returnId: id, pretNo, stockValue, replayed: false };
  })();
}

// ── opening balances and payments ───────────────────────────

/** What the store owed a supplier on the day it started using this POS (no migration from the old system). */
export function setSupplierOpeningBalance(ctx: Ctx, userId: number, input: { supplierId: number; amount: number; asOf: string; reference?: string }): number {
  requirePermission(ctx, userId, 'purchase.manage');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new DomainError('VALIDATION', 'Amount must be more than zero');
  if (!DAY.test(input.asOf) || input.asOf > today(ctx)) throw new DomainError('VALIDATION', 'Date must be today or earlier');
  return ctx.db.transaction(() => {
    const sup = supplier(ctx, input.supplierId);
    if (ctx.db.prepare('SELECT 1 FROM supplier_opening_balances WHERE supplier_id = ?').get(sup.id)) throw new DomainError('CONFLICT', `${sup.name} already has an opening balance`);
    const id = Number(ctx.db.prepare('INSERT INTO supplier_opening_balances (supplier_id, amount, as_of, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sup.id, input.amount, input.asOf, input.reference?.trim() || null, userId, ctx.now()).lastInsertRowid);
    postEntry(ctx, { date: input.asOf, sourceType: 'supplier_opening', sourceId: id, memo: `Opening balance owed to ${sup.name}`, lines: [{ account: '3000', debit: input.amount }, { account: '2000', credit: input.amount }] });
    appendAudit(ctx, { userId, action: 'purchase.opening_balance', entity: 'supplier', entityId: sup.id, details: { amount: input.amount, asOf: input.asOf } });
    return id;
  })();
}

export function paySupplier(ctx: Ctx, userId: number, input: { requestKey: string; supplierId: number; amount: number; method: 'bank' | 'till'; paidOn: string; reference?: string }): { paymentId: number; payNo: string; replayed: boolean } {
  requirePermission(ctx, userId, 'purchase.pay');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new DomainError('VALIDATION', 'Payment must be more than zero');
  if (!DAY.test(input.paidOn) || input.paidOn > today(ctx)) throw new DomainError('VALIDATION', 'Payment date must be today or earlier');
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id, pay_no FROM supplier_payments WHERE request_key = ?').get(input.requestKey) as { id: number; pay_no: string } | undefined;
    if (done) return { paymentId: done.id, payNo: done.pay_no, replayed: true };
    const sup = supplier(ctx, input.supplierId);
    const owed = supplierBalanceOf(ctx, sup.id);
    // Paying in advance would need a supplier-advance account; not supported (accountant to decide).
    if (input.amount > owed) throw new DomainError('VALIDATION', `${sup.name} is owed ${owed / 100} SAR; a payment cannot be more than that`);
    let shiftId: number | null = null;
    if (input.method === 'till') {
      shiftId = openShiftId(ctx);
      if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'Paying from the till needs an open shift');
      if (input.paidOn !== today(ctx)) throw new DomainError('VALIDATION', 'Cash from the till is paid today');
    }
    const payNo = nextNo(ctx, 'SPAY', 'SP');
    const id = Number(ctx.db.prepare('INSERT INTO supplier_payments (pay_no, request_key, supplier_id, amount, method, paid_on, reference, shift_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(payNo, input.requestKey, sup.id, input.amount, input.method, input.paidOn, input.reference?.trim() || null, shiftId, userId, ctx.now()).lastInsertRowid);
    postEntry(ctx, { date: input.paidOn, sourceType: 'supplier_payment', sourceId: id, memo: `Payment to ${sup.name} ${payNo}`, lines: [{ account: '2000', debit: input.amount }, { account: input.method === 'till' ? '1010' : '1030', credit: input.amount }] });
    appendAudit(ctx, { userId, action: 'purchase.pay', entity: 'supplier', entityId: sup.id, details: { payNo, amount: input.amount, method: input.method } });
    return { paymentId: id, payNo, replayed: false };
  })();
}

export function reverseSupplierPayment(ctx: Ctx, userId: number, paymentId: number, requestKey: string, reason: string): number {
  requirePermission(ctx, userId, 'purchase.pay');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  if (!KEY.test(requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id FROM supplier_payments WHERE request_key = ?').get(requestKey) as { id: number } | undefined;
    if (done) return done.id;
    const p = ctx.db.prepare('SELECT id, pay_no, supplier_id, amount, method FROM supplier_payments WHERE id = ? AND amount > 0').get(paymentId) as
      | { id: number; pay_no: string; supplier_id: number; amount: number; method: 'bank' | 'till' }
      | undefined;
    if (!p) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (ctx.db.prepare('SELECT 1 FROM supplier_payments WHERE reversed_of = ?').get(p.id)) throw new DomainError('CONFLICT', 'This payment is already reversed');
    let shiftId: number | null = null;
    if (p.method === 'till') {
      shiftId = openShiftId(ctx);
      if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'Returning cash to the till needs an open shift');
    }
    const payNo = nextNo(ctx, 'SPAY', 'SP');
    const id = Number(ctx.db.prepare('INSERT INTO supplier_payments (pay_no, request_key, supplier_id, amount, method, paid_on, shift_id, reversed_of, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(payNo, requestKey, p.supplier_id, -p.amount, p.method, today(ctx), shiftId, p.id, reason.trim(), userId, ctx.now()).lastInsertRowid);
    postEntry(ctx, { date: today(ctx), sourceType: 'supplier_payment', sourceId: id, memo: `Reversal of ${p.pay_no}: ${reason.trim()}`, lines: [{ account: p.method === 'till' ? '1010' : '1030', debit: p.amount }, { account: '2000', credit: p.amount }] });
    appendAudit(ctx, { userId, action: 'purchase.payment_reversed', entity: 'supplier', entityId: p.supplier_id, details: { payNo: p.pay_no, amount: p.amount, reason } });
    return id;
  })();
}

// ── balances, statements, ageing ────────────────────────────

function supplierBalanceOf(ctx: Ctx, supplierId: number, asOf = '9999-12-31'): number {
  const v = (sql: string) => (ctx.db.prepare(sql).get(supplierId, asOf) as { v: number }).v;
  return (
    v('SELECT COALESCE(SUM(amount),0) AS v FROM supplier_opening_balances WHERE supplier_id = ? AND as_of <= ?') +
    v('SELECT COALESCE(SUM(gross),0) AS v FROM purchase_invoices WHERE supplier_id = ? AND invoice_date <= ?') -
    v('SELECT COALESCE(SUM(gross),0) AS v FROM purchase_returns WHERE supplier_id = ? AND return_date <= ?') -
    v('SELECT COALESCE(SUM(amount),0) AS v FROM supplier_payments WHERE supplier_id = ? AND paid_on <= ?')
  );
}

export interface StatementLine {
  date: string;
  doc: string;
  type: 'opening' | 'invoice' | 'return' | 'payment';
  ref: string | null;
  owedIncrease: number; // + we owe more, − we owe less
  balance: number;
}

/** Supplier statement: every document in date order with the running balance owed. */
export function supplierStatement(ctx: Ctx, userId: number, supplierId: number): { supplier: string; lines: StatementLine[]; balance: number } {
  requirePermission(ctx, userId, 'purchase.view');
  const sup = supplier(ctx, supplierId);
  const rows = ctx.db
    .prepare(
      `SELECT as_of AS date, 'OPENING' AS doc, 'opening' AS type, reference AS ref, amount AS amt, 0 AS ord, id FROM supplier_opening_balances WHERE supplier_id = @sid
       UNION ALL SELECT invoice_date, pinv_no, 'invoice', supplier_invoice_no, gross, 1, id FROM purchase_invoices WHERE supplier_id = @sid
       UNION ALL SELECT return_date, pret_no, 'return', supplier_credit_ref, -gross, 2, id FROM purchase_returns WHERE supplier_id = @sid
       UNION ALL SELECT paid_on, pay_no, 'payment', COALESCE(reference, reason), -amount, 3, id FROM supplier_payments WHERE supplier_id = @sid
       ORDER BY date, ord, id`,
    )
    .all({ sid: supplierId }) as { date: string; doc: string; type: StatementLine['type']; ref: string | null; amt: number }[];
  let bal = 0;
  const lines = rows.map((r) => ({ date: r.date, doc: r.doc, type: r.type, ref: r.ref, owedIncrease: r.amt, balance: (bal += r.amt) }));
  return { supplier: sup.name, lines, balance: bal };
}

export interface AgeingRow {
  supplierId: number;
  supplier: string;
  balance: number;
  notDue: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  over90: number;
}

/**
 * Supplier ageing as of a day: payments and returns settle the oldest amounts first (first in, first out);
 * what remains is grouped by days past its due date.
 */
export function supplierAgeing(ctx: Ctx, userId: number, asOf: string): AgeingRow[] {
  requirePermission(ctx, userId, 'purchase.view');
  if (!DAY.test(asOf)) throw new DomainError('VALIDATION', 'Date must be YYYY-MM-DD');
  const sups = ctx.db.prepare('SELECT id, name FROM suppliers ORDER BY name').all() as { id: number; name: string }[];
  const out: AgeingRow[] = [];
  for (const s of sups) {
    const items = ctx.db
      .prepare(
        `SELECT as_of AS due, amount AS amt FROM supplier_opening_balances WHERE supplier_id = @sid AND as_of <= @asOf
         UNION ALL SELECT due_date, gross FROM purchase_invoices WHERE supplier_id = @sid AND invoice_date <= @asOf ORDER BY due`,
      )
      .all({ sid: s.id, asOf }) as { due: string; amt: number }[];
    let credits =
      (ctx.db.prepare('SELECT COALESCE(SUM(gross),0) AS v FROM purchase_returns WHERE supplier_id = ? AND return_date <= ?').get(s.id, asOf) as { v: number }).v +
      (ctx.db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM supplier_payments WHERE supplier_id = ? AND paid_on <= ?').get(s.id, asOf) as { v: number }).v;
    const row: AgeingRow = { supplierId: s.id, supplier: s.name, balance: 0, notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
    for (const it of items) {
      const used = Math.min(credits, it.amt);
      credits -= used;
      const open = it.amt - used;
      if (open === 0) continue;
      const late = roundDiv(Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${it.due}T00:00:00Z`), 86_400_000); // whole days (both at midnight UTC)
      if (late <= 0) row.notDue += open;
      else if (late <= 30) row.d1_30 += open;
      else if (late <= 60) row.d31_60 += open;
      else if (late <= 90) row.d61_90 += open;
      else row.over90 += open;
    }
    row.balance = row.notDue + row.d1_30 + row.d31_60 + row.d61_90 + row.over90 - credits; // leftover credit = supplier owes us
    if (items.length || credits) out.push(row);
  }
  return out;
}

export function purchaseRegister(ctx: Ctx, userId: number, fromDay: string, toDay: string) {
  requirePermission(ctx, userId, 'purchase.view');
  if (!DAY.test(fromDay) || !DAY.test(toDay) || toDay < fromDay) throw new DomainError('VALIDATION', 'Check the dates');
  return {
    invoices: ctx.db
      .prepare(`SELECT i.id, i.pinv_no AS pinvNo, s.name AS supplier, i.supplier_invoice_no AS supplierInvoiceNo, i.invoice_date AS invoiceDate, i.due_date AS dueDate,
                  i.goods_net AS goodsNet, i.invoice_net AS invoiceNet, i.vat_amount AS vat, i.vat_recoverable AS vatRecoverable, i.gross, i.difference_reason AS differenceReason
                FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date, i.id`)
      .all(fromDay, toDay),
    returns: ctx.db
      .prepare(`SELECT r.id, r.pret_no AS pretNo, s.name AS supplier, r.supplier_credit_ref AS ref, r.return_date AS returnDate, r.stock_value AS stockValue, r.credit_net AS creditNet, r.vat_amount AS vat, r.gross, r.reason
                FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id WHERE r.return_date BETWEEN ? AND ? ORDER BY r.return_date, r.id`)
      .all(fromDay, toDay),
    payments: ctx.db
      .prepare(`SELECT p.id, p.pay_no AS payNo, s.name AS supplier, p.amount, p.method, p.paid_on AS paidOn, p.reference, p.reason, p.reversed_of AS reversedOf,
                  (SELECT 1 FROM supplier_payments x WHERE x.reversed_of = p.id) AS reversed
                FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on, p.id`)
      .all(fromDay, toDay),
  };
}

export function supplierBalances(ctx: Ctx, userId: number): { supplierId: number; supplier: string; balance: number }[] {
  requirePermission(ctx, userId, 'purchase.view');
  return (ctx.db.prepare('SELECT id, name FROM suppliers ORDER BY name').all() as { id: number; name: string }[])
    .map((s) => ({ supplierId: s.id, supplier: s.name, balance: supplierBalanceOf(ctx, s.id) }))
    .filter((r) => r.balance !== 0);
}
