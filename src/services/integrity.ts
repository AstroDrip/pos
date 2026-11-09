import { formatSar, roundDiv } from '../core/money';
import { verifyAuditChain } from './audit';
import type { Ctx } from './context';
import { cashFlowData, type CashFlow } from './financials';

// The books check. Read only: it never changes a record, and it has no correction of its own.
// Each check is written fresh over the source documents. It deliberately does not call trialBalance, stockDrift,
// creditControls, supplierControls, shiftSummary or ownerKpis, because a figure compared with itself proves nothing.

export interface Finding {
  checkId: string;
  severity: 'critical' | 'warning';
  entityType: string;
  entityId: string;
  problem: string;
  explanation: string;
  suggestion: string;
}

type Check = (ctx: Ctx) => Finding[];
const ASK = 'Do not change anything. Keep a backup and ask your accountant or support to look at this record.';
const fmt = formatSar;
const all = <T>(ctx: Ctx, sql: string, ...args: unknown[]) => ctx.db.prepare(sql).all(...args) as T[];
const one = (ctx: Ctx, sql: string, ...args: unknown[]) => (ctx.db.prepare(sql).get(...args) as { v: number }).v;
const balance = (ctx: Ctx, code: string) =>
  one(ctx, 'SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?', code);

const jeBalanced: Check = (ctx) =>
  all<{ id: number; d: number; c: number }>(ctx, 'SELECT entry_id AS id, SUM(debit) AS d, SUM(credit) AS c FROM journal_lines GROUP BY entry_id HAVING SUM(debit) <> SUM(credit)').map((r) => ({
    checkId: 'je_balanced', severity: 'critical', entityType: 'journal_entry', entityId: String(r.id),
    problem: `Journal entry ${r.id} does not balance.`,
    explanation: `Debits are SAR ${fmt(r.d)} and credits are SAR ${fmt(r.c)}. Every entry must have equal sides.`,
    suggestion: ASK,
  }));

const tbBalanced: Check = (ctx) => {
  const r = ctx.db.prepare('SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM journal_lines').get() as { d: number; c: number };
  return r.d === r.c ? [] : [{
    checkId: 'tb_balanced', severity: 'critical', entityType: 'ledger', entityId: 'all',
    problem: 'Total debits and total credits are not equal.',
    explanation: `All debits come to SAR ${fmt(r.d)} and all credits to SAR ${fmt(r.c)}. The trial balance cannot be right until they agree.`,
    suggestion: ASK,
  }];
};

const bsBalanced: Check = (ctx) => {
  const by = (type: string, sign: string) => one(ctx, `SELECT COALESCE(SUM(${sign}), 0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.type = ?`, type);
  const assets = by('asset', 'l.debit - l.credit');
  const claims = by('liability', 'l.credit - l.debit') + by('equity', 'l.credit - l.debit') + by('income', 'l.credit - l.debit') - by('expense', 'l.debit - l.credit');
  return assets === claims ? [] : [{
    checkId: 'bs_balanced', severity: 'critical', entityType: 'ledger', entityId: 'balance sheet',
    problem: 'Assets do not equal liabilities plus equity.',
    explanation: `Assets are SAR ${fmt(assets)}. Liabilities, equity and earnings to date are SAR ${fmt(claims)}.`,
    suggestion: ASK,
  }];
};

const saleLines: Check = (ctx) =>
  all<{ id: number; no: string }>(ctx, `SELECT s.id, s.invoice_no AS no FROM sales s LEFT JOIN sale_lines l ON l.sale_id = s.id GROUP BY s.id
    HAVING COUNT(l.line_no) = 0 OR s.total_incl <> SUM(l.line_incl) OR s.total_vat <> SUM(l.line_vat) OR s.total_excl <> SUM(l.line_excl) OR s.total_discount <> SUM(l.discount)`).map((r) => ({
    checkId: 'sale_lines', severity: 'critical', entityType: 'sale', entityId: r.no,
    problem: `The totals of sale ${r.no} do not match its items.`,
    explanation: 'The total, VAT, net or discount on the sale differs from the sum of its lines.',
    suggestion: ASK,
  }));

const salePayments: Check = (ctx) => {
  const paid = all<{ no: string }>(ctx, `SELECT s.invoice_no AS no FROM sales s LEFT JOIN payments p ON p.sale_id = s.id GROUP BY s.id HAVING COALESCE(SUM(p.amount), 0) <> s.paid_total`);
  const account = all<{ no: string }>(ctx, `SELECT s.invoice_no AS no FROM sales s
    LEFT JOIN receivables r ON r.sale_id = s.id
    WHERE COALESCE(r.amount, 0) <> COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id = s.id AND p.tender = 'account'), 0)`);
  return [
    ...paid.map((r): Finding => ({ checkId: 'sale_payments', severity: 'critical', entityType: 'sale', entityId: r.no, problem: `The payments of sale ${r.no} do not add up.`, explanation: 'The payment records differ from the amount the sale says was paid.', suggestion: ASK })),
    ...account.map((r): Finding => ({ checkId: 'sale_payments', severity: 'critical', entityType: 'sale', entityId: r.no, problem: `The on-account part of sale ${r.no} does not match the customer's debt.`, explanation: 'The amount put on account differs from the amount recorded as owed.', suggestion: ASK })),
  ];
};

function posted(ctx: Ctx, source: string, code: string): Map<number, { d: number; c: number }> {
  return new Map(all<{ id: number; d: number; c: number }>(ctx, `SELECT j.source_id AS id, SUM(l.debit) AS d, SUM(l.credit) AS c FROM journal_entries j JOIN journal_lines l ON l.entry_id = j.id JOIN accounts a ON a.id = l.account_id
    WHERE j.source_type = ? AND a.code = ? GROUP BY j.source_id`, source, code).map((r) => [r.id, { d: r.d, c: r.c }]));
}

const ledgerSalesVat: Check = (ctx) => {
  const out: Finding[] = [];
  const flag = (kind: string, no: string, what: string) => out.push({ checkId: 'ledger_sales_vat', severity: 'critical', entityType: kind, entityId: no, problem: `The ${what} booked for ${kind} ${no} differs from the document.`, explanation: `The accounts and the ${kind} should show the same ${what}.`, suggestion: ASK });
  const check = (kind: 'sale' | 'refund', table: string, noCol: string, side: 'c' | 'd') => {
    const income = posted(ctx, kind, '4000');
    const vat = posted(ctx, kind, '2200');
    for (const r of all<{ id: number; no: string; excl: number; vat: number }>(ctx, `SELECT id, ${noCol} AS no, total_excl AS excl, total_vat AS vat FROM ${table}`)) {
      if ((income.get(r.id)?.[side] ?? 0) !== r.excl) flag(kind, r.no, 'net sales');
      if ((vat.get(r.id)?.[side] ?? 0) !== r.vat) flag(kind, r.no, 'VAT');
    }
  };
  check('sale', 'sales', 'invoice_no', 'c');
  check('refund', 'refunds', 'refund_no', 'd');
  return out;
};

const lineCost = (qty: number, unitCost: number) => roundDiv(qty * unitCost, 1000);

const cogs: Check = (ctx) => {
  const out: Finding[] = [];
  const posted5000 = posted(ctx, 'sale', '5000');
  const expected = new Map<number, number>();
  for (const l of all<{ id: number; qty: number; cost: number }>(ctx, 'SELECT sale_id AS id, qty, unit_cost AS cost FROM sale_lines')) expected.set(l.id, (expected.get(l.id) ?? 0) + lineCost(l.qty, l.cost));
  for (const s of all<{ id: number; no: string }>(ctx, 'SELECT id, invoice_no AS no FROM sales')) {
    const p = posted5000.get(s.id);
    const net = (p?.d ?? 0) - (p?.c ?? 0);
    const want = expected.get(s.id) ?? 0;
    if (net !== want) out.push({ checkId: 'cogs', severity: 'warning', entityType: 'sale', entityId: s.no, problem: `The cost booked for sale ${s.no} differs from its items.`, explanation: `Booked SAR ${fmt(net)}. The items at their cost come to SAR ${fmt(want)}.`, suggestion: ASK });
  }
  // A refund has one line for goods back on the shelf. A second line can appear when stock had gone negative, so one of them must match.
  const restocked = new Map<number, number>();
  for (const l of all<{ id: number; qty: number; cost: number }>(ctx, 'SELECT refund_id AS id, qty, unit_cost AS cost FROM refund_lines WHERE restock = 1')) restocked.set(l.id, (restocked.get(l.id) ?? 0) + lineCost(l.qty, l.cost));
  const credits = ctx.db.prepare("SELECT l.credit AS c FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN accounts a ON a.id = l.account_id WHERE j.source_type = 'refund' AND j.source_id = ? AND a.code = '5000' AND l.credit > 0");
  for (const r of all<{ id: number; no: string }>(ctx, 'SELECT id, refund_no AS no FROM refunds')) {
    const want = restocked.get(r.id) ?? 0;
    const lines = (credits.all(r.id) as { c: number }[]).map((x) => x.c);
    if (want === 0 ? lines.length > 0 : !lines.includes(want)) out.push({ checkId: 'cogs', severity: 'warning', entityType: 'refund', entityId: r.no, problem: `The cost booked for refund ${r.no} differs from the goods put back.`, explanation: `The goods put back on the shelf come to SAR ${fmt(want)} at cost.`, suggestion: ASK });
  }
  return out;
};

const refundLimits: Check = (ctx) => [
  ...all<{ no: string; line: number }>(ctx, `SELECT s.invoice_no AS no, sl.line_no AS line FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
    JOIN (SELECT r.original_sale_id AS sid, rl.sale_line_no AS ln, SUM(rl.qty) AS q FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id GROUP BY sid, ln) x ON x.sid = sl.sale_id AND x.ln = sl.line_no
    WHERE x.q > sl.qty`).map((r): Finding => ({ checkId: 'refund_limits', severity: 'critical', entityType: 'sale', entityId: `${r.no} line ${r.line}`, problem: `More of line ${r.line} of sale ${r.no} was refunded than was sold.`, explanation: 'The refunded quantity is larger than the quantity on the sale.', suggestion: ASK })),
  ...all<{ no: string }>(ctx, 'SELECT r.refund_no AS no FROM refunds r LEFT JOIN sales s ON s.id = r.original_sale_id WHERE s.id IS NULL').map((r): Finding => ({ checkId: 'refund_limits', severity: 'critical', entityType: 'refund', entityId: r.no, problem: `Refund ${r.no} has no original sale.`, explanation: 'Every refund must belong to a sale.', suggestion: ASK })),
];

const stockMovements: Check = (ctx) =>
  all<{ p: number; bal: number | null; moved: number | null }>(ctx, `SELECT p.id AS p, b.qty AS bal, (SELECT SUM(m.qty) FROM stock_movements m WHERE m.product_id = p.id) AS moved FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id
    WHERE COALESCE(b.qty, 0) <> COALESCE((SELECT SUM(m.qty) FROM stock_movements m WHERE m.product_id = p.id), 0)`).map((r) => ({
    checkId: 'stock_movements', severity: 'critical', entityType: 'product', entityId: String(r.p),
    problem: `The stock of product ${r.p} differs from its movements.`,
    explanation: `On hand is ${(r.bal ?? 0) / 1000}. All movements add up to ${(r.moved ?? 0) / 1000}.`,
    suggestion: ASK,
  }));

const inventoryValue: Check = (ctx) => {
  const stock = all<{ qty: number; cost: number }>(ctx, 'SELECT qty, avg_cost AS cost FROM stock_balances');
  const atCost = stock.reduce((s, r) => s + lineCost(r.qty, r.cost), 0);
  const booked = balance(ctx, '1200');
  // Each movement can round by a halala, and the average cost per unit is held to the nearest halala, so up to half a
  // halala per unit on hand can also be out.
  const limit = one(ctx, 'SELECT count(*) AS v FROM stock_movements') + stock.reduce((s, r) => s + Math.ceil(Math.abs(r.qty) / 2000), 0);
  return Math.abs(booked - atCost) <= limit ? [] : [{
    checkId: 'inventory_value', severity: 'warning', entityType: 'ledger', entityId: '1200',
    problem: 'Inventory in the accounts differs from stock at cost.',
    explanation: `The accounts show SAR ${fmt(booked)}. Quantity times average cost comes to SAR ${fmt(atCost)}. That is more than rounding can explain.`,
    suggestion: ASK,
  }];
};

const control = (id: string, code: string, label: string, booked: number, records: number): Finding[] =>
  booked === records ? [] : [{ checkId: id, severity: 'critical', entityType: 'ledger', entityId: code, problem: `${label} in the accounts differs from the records.`, explanation: `The accounts show SAR ${fmt(booked)}. The records add up to SAR ${fmt(records)}.`, suggestion: ASK }];

const receivables: Check = (ctx) => {
  const open = one(ctx, `SELECT (SELECT COALESCE(SUM(amount), 0) FROM receivables)
    - (SELECT COALESCE(SUM(amount), 0) FROM receipt_allocations)
    - (SELECT COALESCE(SUM(amount), 0) FROM customer_writeoffs)
    - (SELECT COALESCE(SUM(amount), 0) FROM refund_account_offsets) AS v`);
  const advances = one(ctx, `SELECT (SELECT COALESCE(SUM(amount), 0) FROM customer_receipts) - (SELECT COALESCE(SUM(amount), 0) FROM receipt_allocations) AS v`);
  return [...control('receivables', '1100', 'What customers owe', balance(ctx, '1100'), open), ...control('receivables', '2300', 'Money held for customers', -balance(ctx, '2300'), advances)];
};

const payables: Check = (ctx) => {
  const open = one(ctx, `SELECT (SELECT COALESCE(SUM(gross), 0) FROM purchase_invoices) + (SELECT COALESCE(SUM(amount), 0) FROM supplier_opening_balances)
    - (SELECT COALESCE(SUM(amount), 0) FROM supplier_payment_allocations WHERE payment_id IS NOT NULL)
    - (SELECT COALESCE(SUM(gross), 0) FROM purchase_returns) AS v`);
  const advances = one(ctx, `SELECT (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments) - (SELECT COALESCE(SUM(amount), 0) FROM supplier_payment_allocations WHERE payment_id IS NOT NULL) AS v`);
  return [...control('payables', '2000', 'What the store owes suppliers', -balance(ctx, '2000'), open), ...control('payables', '1310', 'Money paid to suppliers in advance', balance(ctx, '1310'), advances)];
};

const shiftCash: Check = (ctx) =>
  all<{ id: number; stored: number; worked: number }>(ctx, `SELECT r.id, r.expected_cash AS stored,
      r.opening_float
      + COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = r.id AND p.tender = 'cash'), 0)
      - COALESCE((SELECT SUM(change_given) FROM sales s WHERE s.shift_id = r.id), 0)
      + COALESCE((SELECT SUM(amount) FROM customer_receipts c WHERE c.shift_id = r.id AND c.method = 'cash'), 0)
      + COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.shift_id = r.id AND m.kind = 'in'), 0)
      - COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.shift_id = r.id AND m.kind = 'out'), 0)
      - COALESCE((SELECT SUM(total_incl) FROM refunds f WHERE f.shift_id = r.id), 0)
      + COALESCE((SELECT SUM(o.amount) FROM refund_account_offsets o JOIN refunds f ON f.id = o.refund_id WHERE f.shift_id = r.id), 0)
      - COALESCE((SELECT SUM(amount) FROM expense_payments e WHERE e.shift_id = r.id AND e.method = 'till'), 0)
      - COALESCE((SELECT SUM(amount) FROM supplier_payments p WHERE p.shift_id = r.id AND p.method = 'till'), 0) AS worked
    FROM register_shifts r WHERE r.status = 'closed'`).filter((r) => r.stored !== r.worked).map((r) => ({
    checkId: 'shift_cash', severity: 'critical', entityType: 'shift', entityId: String(r.id),
    problem: `Shift ${r.id}: the expected cash does not match its records.`,
    explanation: `The shift stored SAR ${fmt(r.stored)}. Working it out from the float and every cash record gives SAR ${fmt(r.worked)}.`,
    suggestion: ASK,
  }));

const cashSources: Check = (ctx) => {
  const sources: { type: string; label: string; doc: string; want: string }[] = [
    { type: 'sale', label: 'sales', doc: 'SELECT id FROM sales WHERE shift_id = @s', want: "(SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN sales x ON x.id = p.sale_id WHERE x.shift_id = @s AND p.tender = 'cash') - (SELECT COALESCE(SUM(change_given), 0) FROM sales WHERE shift_id = @s)" },
    { type: 'refund', label: 'refunds', doc: 'SELECT id FROM refunds WHERE shift_id = @s', want: '(SELECT COALESCE(SUM(o.amount), 0) FROM refund_account_offsets o JOIN refunds f ON f.id = o.refund_id WHERE f.shift_id = @s) - (SELECT COALESCE(SUM(total_incl), 0) FROM refunds WHERE shift_id = @s)' },
    { type: 'cash_movement', label: 'cash in and out', doc: 'SELECT id FROM cash_movements WHERE shift_id = @s', want: "(SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END), 0) FROM cash_movements WHERE shift_id = @s)" },
    { type: 'customer_receipt', label: 'customer payments', doc: "SELECT id FROM customer_receipts WHERE shift_id = @s AND method = 'cash'", want: "(SELECT COALESCE(SUM(amount), 0) FROM customer_receipts WHERE shift_id = @s AND method = 'cash')" },
    { type: 'expense_payment', label: 'expenses paid from the till', doc: "SELECT id FROM expense_payments WHERE shift_id = @s AND method = 'till'", want: "-(SELECT COALESCE(SUM(amount), 0) FROM expense_payments WHERE shift_id = @s AND method = 'till')" },
    { type: 'supplier_payment', label: 'suppliers paid from the till', doc: "SELECT id FROM supplier_payments WHERE shift_id = @s AND method = 'till'", want: "-(SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE shift_id = @s AND method = 'till')" },
  ];
  const out: Finding[] = [];
  const shifts = all<{ id: number }>(ctx, 'SELECT id FROM register_shifts');
  for (const src of sources) {
    const q = ctx.db.prepare(`SELECT (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN accounts a ON a.id = l.account_id
        WHERE a.code = '1010' AND j.source_type = @type AND j.source_id IN (${src.doc})) AS booked, ${src.want} AS want`);
    for (const s of shifts) {
      const r = q.get({ type: src.type, s: s.id }) as { booked: number; want: number };
      if (r.booked !== r.want) out.push({ checkId: 'cash_sources', severity: 'warning', entityType: 'shift', entityId: `${s.id} ${src.type}`, problem: `Shift ${s.id}: the till money booked for ${src.label} differs from the documents.`, explanation: `The accounts show SAR ${fmt(r.booked)}. The documents show SAR ${fmt(r.want)}.`, suggestion: ASK });
    }
  }
  return out;
};

export function checkCashFlow(ctx: Ctx, report?: CashFlow): Finding[] {
  const range = ctx.db.prepare('SELECT MIN(entry_date) AS a, MAX(entry_date) AS b FROM journal_entries').get() as { a: string | null; b: string | null };
  if (!range.a || !range.b) return [];
  const r = report ?? cashFlowData(ctx, range.a, range.b);
  const moved = one(ctx, `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.entry_id
    WHERE a.code IN ('1010', '1020', '1030') AND j.entry_date BETWEEN ? AND ?`, r.fromDay, r.toDay);
  const groups = r.groups.reduce((s, g) => s + g.amount, 0);
  return r.net === moved && groups === moved && r.closing - r.opening === moved ? [] : [{
    checkId: 'cash_flow', severity: 'critical', entityType: 'report', entityId: 'cash flow',
    problem: 'The cash flow report does not tie to the accounts.',
    explanation: `The report shows SAR ${fmt(r.net)} moved. The cash and bank accounts show SAR ${fmt(moved)}.`,
    suggestion: ASK,
  }];
}

const SOURCE_TABLES: Record<string, string> = {
  sale: 'sales', refund: 'refunds', cash_movement: 'cash_movements', customer_receipt: 'customer_receipts', customer_writeoff: 'customer_writeoffs', expense: 'expenses',
  expense_payment: 'expense_payments', expense_amort: 'expense_amortization', expense_reversal: 'expenses', customer_advance_applied: 'receipt_allocations', supplier_advance_applied: 'supplier_payment_allocations', grn: 'goods_receipts', purchase_invoice: 'purchase_invoices', purchase_return: 'purchase_returns', shift_close: 'register_shifts',
  vat_claim: 'supplier_vat_claims', stock_adjustment: 'stock_adjustments', supplier_opening: 'supplier_opening_balances', supplier_payment: 'supplier_payments',
};

/** Entries that do not come from a document in the app. */
const NO_DOCUMENT = new Set(['demo_opening']);

const orphans: Check = (ctx) => {
  const out: Finding[] = [];
  const add = (entityType: string, entityId: string, problem: string) => out.push({ checkId: 'orphans', severity: 'critical', entityType, entityId, problem, explanation: 'A record points to another record that does not exist.', suggestion: ASK });
  for (const [type, table] of Object.entries(SOURCE_TABLES)) {
    for (const r of all<{ id: number; sid: number }>(ctx, `SELECT j.id, j.source_id AS sid FROM journal_entries j WHERE j.source_type = ? AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.id = j.source_id)`, type)) add('journal_entry', String(r.id), `Journal entry ${r.id} points to ${type} ${r.sid}, which is missing.`);
    for (const r of all<{ id: number; sid: number }>(ctx, `SELECT m.id, m.source_id AS sid FROM stock_movements m WHERE m.source_type = ? AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.id = m.source_id)`, type)) add('stock_movement', String(r.id), `Stock movement ${r.id} points to ${type} ${r.sid}, which is missing.`);
  }
  for (const r of all<{ t: string }>(ctx, 'SELECT DISTINCT source_type AS t FROM journal_entries')) {
    if (!SOURCE_TABLES[r.t] && !NO_DOCUMENT.has(r.t)) add('journal_entry', r.t, `Journal entries of type "${r.t}" are not recognised.`);
  }
  for (const r of all<{ id: number }>(ctx, 'SELECT p.id FROM payments p LEFT JOIN sales s ON s.id = p.sale_id WHERE s.id IS NULL')) add('payment', String(r.id), `Payment ${r.id} has no sale.`);
  for (const r of all<{ no: string }>(ctx, 'SELECT r.receipt_no AS no FROM customer_receipts r WHERE r.amount > 0 AND r.reversed_of IS NULL AND COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a.receipt_id = r.id), 0) > r.amount')) add('customer_receipt', r.no, `Customer payment ${r.no} was applied for more than was received.`);
  for (const r of all<{ no: string }>(ctx, 'SELECT p.pay_no AS no FROM supplier_payments p WHERE p.amount > 0 AND p.reversed_of IS NULL AND COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.payment_id = p.id), 0) > p.amount')) add('supplier_payment', r.no, `Supplier payment ${r.no} was applied for more than was paid.`);
  for (const r of all<{ id: number }>(ctx, 'SELECT s.id FROM sales s LEFT JOIN register_shifts x ON x.id = s.shift_id WHERE x.id IS NULL')) add('sale', String(r.id), `Sale ${r.id} belongs to a shift that is missing.`);
  for (const r of all<{ id: number; no: number }>(ctx, 'SELECT l.sale_id AS id, l.line_no AS no FROM sale_lines l LEFT JOIN products p ON p.id = l.product_id WHERE p.id IS NULL')) add('sale', `${r.id} line ${r.no}`, `A line of sale ${r.id} is for a product that is missing.`);
  return out;
};

/** The same document number used more than once in one table. */
export function duplicatesIn(ctx: Ctx, table: string, column: string): Finding[] {
  return all<{ no: string }>(ctx, `SELECT ${column} AS no FROM ${table} GROUP BY ${column} HAVING COUNT(*) > 1`).map((r) => ({
    checkId: 'duplicates', severity: 'critical', entityType: table, entityId: r.no,
    problem: `The number ${r.no} is used more than once.`,
    explanation: 'Each document must have its own number.',
    suggestion: ASK,
  }));
}

const duplicates: Check = (ctx) => [
  ...[['sales', 'invoice_no'], ['sales', 'uuid'], ['refunds', 'refund_no'], ['purchase_invoices', 'pinv_no'], ['customer_receipts', 'receipt_no'], ['supplier_payments', 'pay_no']].flatMap(([t, c]) => duplicatesIn(ctx, t!, c!)),
  ...all<{ id: number }>(ctx, "SELECT id FROM sales WHERE trim(invoice_no) = '' OR trim(uuid) = ''").map((r): Finding => ({ checkId: 'duplicates', severity: 'critical', entityType: 'sale', entityId: String(r.id), problem: `Sale ${r.id} has no tax document number.`, explanation: 'Every sale needs an invoice number and a unique id.', suggestion: ASK })),
];

const auditChain: Check = (ctx) => {
  const broken = verifyAuditChain(ctx);
  return broken === null ? [] : [{ checkId: 'audit_chain', severity: 'critical', entityType: 'audit_log', entityId: String(broken), problem: `Audit record ${broken} has been changed.`, explanation: 'The log is chained so that any change outside the app shows up here.', suggestion: 'Keep a copy of the database and contact support.' }];
};

const backupRecords: Check = (ctx) =>
  all<{ id: number }>(ctx, "SELECT id FROM backup_jobs WHERE status = 'verified_local' AND (file_name IS NULL OR file_sha256 IS NULL OR manifest_json IS NULL)").map((r) => ({
    checkId: 'backup_records', severity: 'warning', entityType: 'backup', entityId: String(r.id),
    problem: `Backup record ${r.id} is missing details.`,
    explanation: 'It says the backup was checked, but its file name, fingerprint or contents list is missing.',
    suggestion: 'Run a new backup from the Admin tab and check that it succeeds.',
  }));

/** Every VAT claim in the ledger has a claim record, for the same amount, and claimed reviews net to their approved VAT. */
const vatClaims: Check = (ctx) => {
  const out: Finding[] = [];
  for (const r of all<{ id: number; d: number; c: number; amount: number | null; kind: string | null }>(ctx, `SELECT j.id, SUM(CASE WHEN a.code = '2210' THEN l.debit ELSE 0 END) AS d, SUM(CASE WHEN a.code = '2210' THEN l.credit ELSE 0 END) AS c, x.amount, x.kind
    FROM journal_entries j JOIN journal_lines l ON l.entry_id = j.id JOIN accounts a ON a.id = l.account_id LEFT JOIN supplier_vat_claims x ON x.id = j.source_id WHERE j.source_type = 'vat_claim' GROUP BY j.id`)) {
    const moved = r.kind === 'reverse' ? r.c : r.d;
    if (r.amount === null || moved !== r.amount) out.push({ checkId: 'vat_claims', severity: 'critical', entityType: 'journal_entry', entityId: String(r.id), problem: `VAT entry ${r.id} does not match a claim.`, explanation: 'Input VAT moved in the ledger with no matching claim record, or for a different amount.', suggestion: ASK });
  }
  for (const r of all<{ id: number; net: number; want: number }>(ctx, `SELECT v.id, COALESCE((SELECT SUM(CASE c.kind WHEN 'claim' THEN c.amount ELSE -c.amount END) FROM supplier_vat_claims c WHERE c.review_id = v.id), 0) AS net,
    CASE WHEN v.vat_status = 'claimed' THEN v.approved_vat ELSE 0 END AS want FROM supplier_vat_reviews v`)) {
    if (r.net !== r.want) out.push({ checkId: 'vat_claims', severity: 'critical', entityType: 'supplier_vat_review', entityId: String(r.id), problem: `VAT review ${r.id} does not match its claims.`, explanation: `Its status needs SAR ${fmt(r.want)} claimed. The claims come to SAR ${fmt(r.net)}. VAT may be claimed twice or not at all.`, suggestion: ASK });
  }
  return out;
};

/** Account 1300 holds exactly what posted prepaid expenses have not yet released. */
const prepaidBalance: Check = (ctx) => {
  const want = one(ctx, `SELECT COALESCE(SUM(e.gross - CASE WHEN e.vat_recoverable = 1 THEN e.vat_amount ELSE 0 END), 0) -
    COALESCE((SELECT SUM(a.amount) FROM expense_amortization a JOIN expenses x ON x.id = a.expense_id WHERE x.status = 'posted'), 0) AS v
    FROM expenses e WHERE e.status = 'posted' AND e.period_start IS NOT NULL AND e.period_start <> e.period_end`);
  const have = balance(ctx, '1300');
  return want === have ? [] : [{ checkId: 'prepaid_balance', severity: 'warning', entityType: 'account', entityId: '1300', problem: 'Prepaid expenses do not match their account.', explanation: `Account 1300 holds SAR ${fmt(have)}. Posted prepaid expenses still to be released come to SAR ${fmt(want)}.`, suggestion: ASK }];
};

/** An expense category must point at an expense or asset account. */
const expenseAccounts: Check = (ctx) =>
  all<{ name: string; code: string }>(ctx, "SELECT c.name_en AS name, c.account_code AS code FROM expense_categories c LEFT JOIN accounts a ON a.code = c.account_code WHERE a.id IS NULL OR a.type NOT IN ('expense','asset')").map((r) => ({
    checkId: 'expense_accounts', severity: 'warning', entityType: 'expense_category', entityId: r.name,
    problem: `Expense category ${r.name} points to account ${r.code}, which is not an expense or asset account.`,
    explanation: 'Expenses in this category would land in the wrong place in the reports.',
    suggestion: ASK,
  }));

export const CHECKS: { id: string; run: Check }[] = [
  { id: 'je_balanced', run: jeBalanced },
  { id: 'tb_balanced', run: tbBalanced },
  { id: 'bs_balanced', run: bsBalanced },
  { id: 'sale_lines', run: saleLines },
  { id: 'sale_payments', run: salePayments },
  { id: 'ledger_sales_vat', run: ledgerSalesVat },
  { id: 'cogs', run: cogs },
  { id: 'refund_limits', run: refundLimits },
  { id: 'stock_movements', run: stockMovements },
  { id: 'inventory_value', run: inventoryValue },
  { id: 'receivables', run: receivables },
  { id: 'payables', run: payables },
  { id: 'shift_cash', run: shiftCash },
  { id: 'cash_sources', run: cashSources },
  { id: 'cash_flow', run: (ctx) => checkCashFlow(ctx) },
  { id: 'orphans', run: orphans },
  { id: 'duplicates', run: duplicates },
  { id: 'audit_chain', run: auditChain },
  { id: 'backup_records', run: backupRecords },
  { id: 'vat_claims', run: vatClaims },
  { id: 'prepaid_balance', run: prepaidBalance },
  { id: 'expense_accounts', run: expenseAccounts },
];

export const runChecks = (ctx: Ctx): Finding[] => CHECKS.flatMap((c) => c.run(ctx));
