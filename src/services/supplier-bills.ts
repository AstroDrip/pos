import { MILLI_PER_UNIT, roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import { computeBill, splitCost, type BillLineInput, type BillTotals } from '../core/supplier-bill';
import { appendAudit } from './audit';
import { getProduct, type Product } from './catalog';
import { DomainError, type Ctx } from './context';
import { receiveGoods } from './inventory';
import { createPurchaseInvoice } from './purchasing';
import { requirePermission } from './users';

// One screen for any supplier paper. Stock and accounts go through the existing receiveGoods and
// createPurchaseInvoice; this module only keeps the line detail and works out the cost per piece.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[\w-]{8,64}$/;

export type DocType = 'tax_invoice' | 'delivery_note' | 'proforma' | 'other';

export interface SupplierBillLine extends BillLineInput {
  productId: number;
  supplierCode?: string;
  billText?: string;
  tariffCode?: string;
  packName: string;
  pageNo: number;
}

export interface SupplierBillInput {
  requestKey: string;
  supplierId: number;
  docType: DocType;
  docNo: string;
  docDate: string;
  deliveryDate?: string;
  salesAgent?: string;
  /** Copied from the paper. Not used for a delivery note: no invoice exists yet. */
  payType: 'paid' | 'credit';
  payMethod?: 'till' | 'bank';
  /** Part paid at delivery on a credit bill. */
  paidNow?: number;
  dueDate?: string;
  noDueDate?: boolean;
  /** Claim the VAT. Default: yes on a tax invoice, no on anything else. */
  claimVat?: boolean;
  pages: number;
  billDiscount: number;
  billCharge: number;
  paper: { gross?: number; discount?: number; net: number; vat: number; total: number };
  differenceReason?: string;
  supplierVatNo?: string;
  notes?: string;
  lines: SupplierBillLine[];
}

export interface SupplierItem {
  id: number;
  supplierCode: string | null;
  productId: number;
  packName: string;
  unitsPerPack: number;
  lastPrice: number;
  product: Product;
}

function checkPaper(input: SupplierBillInput, b: BillTotals) {
  const p = input.paper;
  const gap = (label: string, paper: number, lines: number) => {
    if (paper !== lines) throw new DomainError('VALIDATION', `${label} on the paper is ${paper / 100} but the lines add up to ${lines / 100}`);
  };
  gap('Net', p.net, b.net);
  gap('VAT', p.vat, b.vat);
  gap('Total', p.total, b.total);
  if (p.gross !== undefined) gap('Gross', p.gross, b.gross);
  if (p.discount !== undefined) gap('Discount', p.discount, b.discount);
}

function compute(input: SupplierBillInput): BillTotals {
  try {
    return computeBill(input.lines, input.billDiscount, input.billCharge);
  } catch (e) {
    if (e instanceof RangeError) throw new DomainError('VALIDATION', e.message);
    throw e;
  }
}

/** Remembers the code, pack and price, so next time the code fills them in. */
function remember(ctx: Ctx, supplierId: number, l: SupplierBillLine) {
  const code = l.supplierCode?.trim() || null;
  const packPrice = l.priceBasis === 'pack' ? l.price : roundDiv(l.price * l.unitsPerPack, MILLI_PER_UNIT);
  const packName = l.packName.trim();
  const byCode = code ? (ctx.db.prepare('SELECT id, product_id FROM supplier_items WHERE supplier_id = ? AND supplier_code = ?').get(supplierId, code) as { id: number; product_id: number } | undefined) : undefined;
  if (byCode && byCode.product_id !== l.productId) {
    const other = getProduct(ctx, byCode.product_id);
    throw new DomainError('CONFLICT', `Code ${code} is already used for ${other?.nameEn ?? 'another product'}`);
  }
  if (byCode) {
    ctx.db.prepare('UPDATE supplier_items SET pack_name = ?, units_per_pack = ?, last_price = ?, updated_at = ? WHERE id = ?').run(packName, l.unitsPerPack, packPrice, ctx.now(), byCode.id);
    return;
  }
  ctx.db
    .prepare(
      `INSERT INTO supplier_items (supplier_id, product_id, supplier_code, pack_name, units_per_pack, last_price, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(supplier_id, product_id, pack_name) DO UPDATE SET supplier_code = COALESCE(excluded.supplier_code, supplier_code), units_per_pack = excluded.units_per_pack, last_price = excluded.last_price, updated_at = excluded.updated_at`,
    )
    .run(supplierId, l.productId, code, packName, l.unitsPerPack, packPrice, ctx.now());
}

export function createSupplierBill(ctx: Ctx, userId: number, input: SupplierBillInput): { billId: number; grnNo: string; pinvNo: string | null; replayed: boolean } {
  const delivery = input.docType === 'delivery_note';
  requirePermission(ctx, userId, 'stock.receive');
  if (!delivery) requirePermission(ctx, userId, 'purchase.manage');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  const docNo = input.docNo.trim();
  if (!docNo) throw new DomainError('VALIDATION', 'Enter the number printed on the paper');
  if (!DAY.test(input.docDate) || (input.deliveryDate && !DAY.test(input.deliveryDate))) throw new DomainError('VALIDATION', 'Dates must be YYYY-MM-DD');
  if (input.docDate > storeDay(ctx.now())) throw new DomainError('VALIDATION', 'The paper date cannot be in the future');
  if (input.lines.length === 0) throw new DomainError('VALIDATION', 'Add at least one line');
  if (input.lines.some((l) => !l.packName.trim())) throw new DomainError('VALIDATION', 'Every line needs a pack name');

  return ctx.db.transaction(() => {
    const done = ctx.db
      .prepare(
        `SELECT b.id, g.grn_no, i.pinv_no FROM supplier_bills b JOIN goods_receipts g ON g.id = b.grn_id
         LEFT JOIN purchase_invoice_grns x ON x.grn_id = b.grn_id LEFT JOIN purchase_invoices i ON i.id = x.invoice_id WHERE b.request_key = ?`,
      )
      .get(input.requestKey) as { id: number; grn_no: string; pinv_no: string | null } | undefined;
    if (done) return { billId: done.id, grnNo: done.grn_no, pinvNo: done.pinv_no, replayed: true };

    const sup = ctx.db.prepare('SELECT id, name, vat_number FROM suppliers WHERE id = ? AND active = 1').get(input.supplierId) as { id: number; name: string; vat_number: string | null } | undefined;
    if (!sup) throw new DomainError('NOT_FOUND', 'Supplier not found');
    const dup = ctx.db.prepare('SELECT id FROM supplier_bills WHERE supplier_id = ? AND doc_type = ? AND doc_no = ?').get(sup.id, input.docType, docNo);
    if (dup) throw new DomainError('CONFLICT', `Paper ${docNo} from ${sup.name} is already entered`);

    const totals = compute(input);
    checkPaper(input, totals);
    for (const l of input.lines) {
      if (!getProduct(ctx, l.productId)) throw new DomainError('NOT_FOUND', 'Product not found');
      remember(ctx, sup.id, l);
    }

    const grnLines: { productId: number; qty: number; unitCost: number }[] = [];
    const ranges = totals.lines.map((r, i) => {
      const from = grnLines.length + 1;
      const parts = splitCost(r.stockValue, r.stockQty);
      for (const p of parts) grnLines.push({ productId: input.lines[i]!.productId, qty: p.qty, unitCost: p.unitCost });
      return { from, count: parts.length };
    });
    if (grnLines.length === 0) throw new DomainError('VALIDATION', 'Nothing was received on this bill');

    let grnId: number;
    let pinvNo: string | null = null;
    if (delivery) {
      grnId = receiveGoods(ctx, userId, { requestKey: `${input.requestKey}-grn`, supplierId: sup.id, reference: docNo, lines: grnLines }).grnId;
    } else {
      const goods = grnLines.reduce((s, l) => s + roundDiv(l.qty * l.unitCost, MILLI_PER_UNIT), 0);
      const difference = input.paper.net - goods;
      const reason = input.differenceReason?.trim() || (difference !== 0 && Math.abs(difference) <= input.lines.length ? 'Rounding' : undefined);
      const claim = input.paper.vat > 0 && (input.claimVat ?? input.docType === 'tax_invoice');
      const amount = input.payType === 'paid' ? input.paper.total : (input.paidNow ?? 0);
      if (amount > 0) requirePermission(ctx, userId, 'purchase.pay');
      const inv = createPurchaseInvoice(ctx, userId, {
        requestKey: input.requestKey, supplierId: sup.id, supplierInvoiceNo: docNo, supplierVatNo: input.supplierVatNo?.trim() || sup.vat_number || undefined, invoiceDate: input.docDate,
        dueDate: input.dueDate, grnIds: [], newLines: grnLines, invoiceNet: input.paper.net, vatAmount: input.paper.vat, vatRecoverable: claim, differenceReason: reason, notes: input.notes,
        noDueDate: input.noDueDate,
        payNow: amount > 0 ? { requestKey: `${input.requestKey.slice(0, 50)}-pay`, amount, method: input.payMethod ?? 'till', reference: docNo } : undefined,
      });
      pinvNo = inv.pinvNo;
      grnId = (ctx.db.prepare('SELECT grn_id FROM purchase_invoice_grns WHERE invoice_id = ?').get(inv.invoiceId) as { grn_id: number }).grn_id;
    }

    const billId = Number(
      ctx.db
        .prepare(
          `INSERT INTO supplier_bills (request_key, supplier_id, doc_type, doc_no, doc_date, delivery_date, sales_agent, pay_type, grn_id, bill_discount, bill_charge,
             paper_gross, paper_discount, paper_net, paper_vat, paper_total, pages, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.requestKey, sup.id, input.docType, docNo, input.docDate, input.deliveryDate ?? null, input.salesAgent?.trim() || null, input.payType, grnId, input.billDiscount, input.billCharge,
          input.paper.gross ?? null, input.paper.discount ?? null, input.paper.net, input.paper.vat, input.paper.total, input.pages, input.notes?.trim() || null, userId, ctx.now()).lastInsertRowid,
    );
    const insert = ctx.db.prepare(
      `INSERT INTO supplier_bill_lines (bill_id, line_no, page_no, product_id, supplier_code, bill_text, tariff_code, pack_name, units_per_pack, packs, loose_qty, free_qty, received_qty,
         price_basis, price, gross, discount, discount_bp, net, vat_rate_bp, vat, total, grn_line_from, grn_line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.lines.forEach((l, i) => {
      const r = totals.lines[i]!;
      insert.run(billId, i + 1, l.pageNo, l.productId, l.supplierCode?.trim() || null, l.billText?.trim() || null, l.tariffCode?.trim() || null, l.packName.trim(), l.unitsPerPack, l.packs, l.looseQty, l.freeQty, r.stockQty,
        l.priceBasis, l.price, r.gross, r.discount, l.discountBp ?? null, r.net, l.vatRateBp, r.vat, r.total, ranges[i]!.from, ranges[i]!.count);
    });
    appendAudit(ctx, { userId, action: 'purchase.bill', entity: 'supplier_bill', entityId: billId, details: { docType: input.docType, docNo, supplierId: sup.id, net: input.paper.net, vat: input.paper.vat, lines: input.lines.length } });
    const grnNo = (ctx.db.prepare('SELECT grn_no FROM goods_receipts WHERE id = ?').get(grnId) as { grn_no: string }).grn_no;
    return { billId, grnNo, pinvNo, replayed: false };
  })();
}

const ITEM = 'SELECT id, supplier_code AS supplierCode, product_id AS productId, pack_name AS packName, units_per_pack AS unitsPerPack, last_price AS lastPrice FROM supplier_items';
type ItemRow = Omit<SupplierItem, 'product'>;
const withProduct = (ctx: Ctx, r: ItemRow): SupplierItem | null => {
  const product = getProduct(ctx, r.productId);
  return product ? { ...r, product } : null;
};

export function findSupplierItem(ctx: Ctx, supplierId: number, code: string): SupplierItem | null {
  const r = ctx.db.prepare(`${ITEM} WHERE supplier_id = ? AND supplier_code = ?`).get(supplierId, code.trim()) as ItemRow | undefined;
  return r ? withProduct(ctx, r) : null;
}

export function supplierItemsFor(ctx: Ctx, supplierId: number): SupplierItem[] {
  return (ctx.db.prepare(`${ITEM} WHERE supplier_id = ? ORDER BY updated_at DESC`).all(supplierId) as ItemRow[]).flatMap((r) => withProduct(ctx, r) ?? []);
}
