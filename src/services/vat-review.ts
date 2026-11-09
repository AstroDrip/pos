import { createHash } from 'node:crypto';
import { formatSar as sar } from '../core/money';
import { storeDay } from '../core/store-time';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { postEntry } from './ledger';
import { requirePermission } from './users';

// A proforma is entered with its VAT as a cost (5010). When the real tax invoice arrives it is linked here.
// Nothing new is purchased, stocked or owed. Three separate questions, three separate answers:
//   document: proforma received → final received → details verified
//   payment:  worked out from the supplier's payments, never stored here
//   VAT:      pending → accountant pending → approved or rejected → claimed or not claimed
// Only an explicit claim posts anything: Dr 2210 / Cr 5010, as its own entry. Uploading a file changes no status.
// PROVISIONAL: the accountant decides eligibility. The app only records that decision.

export type DocStatus = 'proforma_received' | 'final_received' | 'details_verified';
export type VatStatus = 'pending' | 'accountant_pending' | 'approved' | 'rejected' | 'claimed' | 'not_claimed';
export type PaymentStatus = 'unpaid' | 'part' | 'paid';

export interface VatReviewRow {
  billId: number;
  supplier: string;
  docNo: string;
  docDate: string;
  pinvNo: string;
  postedVat: number;
  gross: number;
  docStatus: DocStatus;
  paymentStatus: PaymentStatus;
  vatStatus: VatStatus;
  finalNo: string | null;
  attention: boolean;
}

export interface Discrepancy {
  code: 'net_diff' | 'vat_diff' | 'total_diff' | 'vat_no' | 'vat_rate' | 'return_after' | 'no_copy';
  message: string;
}

export interface VatReviewDetail extends VatReviewRow {
  paper: { net: number; vat: number; total: number };
  paid: number;
  final: { invoiceNo: string; invoiceDate: string; net: number; vat: number; total: number; supplierVatNo: string | null } | null;
  compare: { netDiff: number; vatDiff: number; totalDiff: number } | null;
  discrepancies: Discrepancy[];
  maxClaim: number;
  approvedVat: number | null;
  accountantName: string | null;
  decisionRef: string | null;
  decisionNote: string | null;
  verifyNote: string | null;
  attachments: { id: number; fileName: string; mime: string; bytes: number; at: string; userName: string }[];
  events: { action: string; at: string; userName: string; details: Record<string, unknown> }[];
}

interface BillBase {
  billId: number; supplierId: number; supplier: string; docNo: string; docDate: string; invoiceId: number; pinvNo: string; postedVat: number; gross: number;
  paperNet: number; paperVat: number; paperTotal: number; invoiceDate: string; paid: number;
}
interface Review {
  id: number; doc_status: 'final_received' | 'details_verified'; vat_status: VatStatus; final_no: string; final_date: string; final_net: number; final_vat: number; final_total: number; final_vat_no: string | null;
  verify_note: string | null; accountant_name: string | null; decision_ref: string | null; decision_note: string | null; approved_vat: number | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[\w-]{8,64}$/;
const MAX_FILE = 5_000_000;
const today = (ctx: Ctx) => storeDay(ctx.now());
const validVatNo = (v: string | null) => v !== null && /^3\d{13}3$/.test(v);

// Only unclaimed VAT on proformas with a purchase invoice can be reviewed. A delivery note has no invoice, so no VAT was posted.
const BASE = `
  SELECT b.id AS billId, s.id AS supplierId, s.name AS supplier, b.doc_no AS docNo, b.doc_date AS docDate, i.id AS invoiceId, i.pinv_no AS pinvNo, i.vat_amount AS postedVat, i.gross,
    b.paper_net AS paperNet, b.paper_vat AS paperVat, b.paper_total AS paperTotal, i.invoice_date AS invoiceDate,
    COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.invoice_id = i.id), 0) AS paid
  FROM supplier_bills b
  JOIN suppliers s ON s.id = b.supplier_id
  JOIN purchase_invoice_grns x ON x.grn_id = b.grn_id
  JOIN purchase_invoices i ON i.id = x.invoice_id
  WHERE b.doc_type = 'proforma' AND i.vat_recoverable = 0 AND i.vat_amount > 0`;

const paymentStatus = (paid: number, gross: number): PaymentStatus => (paid <= 0 ? 'unpaid' : paid >= gross ? 'paid' : 'part');

function loadBase(ctx: Ctx, billId: number): BillBase {
  const b = ctx.db.prepare(`${BASE} AND b.id = ?`).get(billId) as BillBase | undefined;
  if (!b) throw new DomainError('NOT_FOUND', 'This paper has no VAT waiting for review');
  return b;
}
const loadReview = (ctx: Ctx, billId: number) => ctx.db.prepare('SELECT * FROM supplier_vat_reviews WHERE bill_id = ?').get(billId) as Review | undefined;

function needReview(ctx: Ctx, billId: number): Review {
  loadBase(ctx, billId);
  const r = loadReview(ctx, billId);
  if (!r) throw new DomainError('CONFLICT', 'Record the final tax invoice first');
  return r;
}

function log(ctx: Ctx, userId: number, reviewId: number, billId: number, action: string, details: Record<string, unknown>) {
  ctx.db.prepare('INSERT INTO supplier_vat_events (review_id, action, user_id, at, details) VALUES (?, ?, ?, ?, ?)').run(reviewId, action, userId, ctx.now(), JSON.stringify(details));
  appendAudit(ctx, { userId, action: `vat.${action}`, entity: 'supplier_bill', entityId: billId, details });
}

function discrepanciesOf(ctx: Ctx, b: BillBase, r: Review | undefined, attachments: number): Discrepancy[] {
  if (!r) return [];
  const out: Discrepancy[] = [];
  const diff = (code: Discrepancy['code'], label: string, was: number, now: number) => {
    if (was !== now) out.push({ code, message: `${label} on the proforma was ${sar(was)}, on the final invoice ${sar(now)}.` });
  };
  diff('net_diff', 'Net', b.paperNet, r.final_net);
  diff('vat_diff', 'VAT', b.paperVat, r.final_vat);
  diff('total_diff', 'Total', b.paperTotal, r.final_total);
  if (!validVatNo(r.final_vat_no)) out.push({ code: 'vat_no', message: 'The supplier VAT number is missing or is not a 15-digit number that starts and ends with 3.' });
  if (r.final_net > 0 && Math.abs(r.final_vat * 10_000 - r.final_net * 1_500) > r.final_net * 10) out.push({ code: 'vat_rate', message: 'The VAT on the final invoice is not 15% of its net amount. Check for zero-rated lines.' });
  const returned = ctx.db.prepare('SELECT COUNT(*) AS n FROM purchase_returns WHERE supplier_id = ? AND vat_recoverable = 0 AND return_date >= ?').get(b.supplierId, b.invoiceDate) as { n: number };
  if (returned.n > 0) out.push({ code: 'return_after', message: 'Goods were returned to this supplier after this purchase. Check that the VAT on them is not claimed as well.' });
  if (attachments === 0) out.push({ code: 'no_copy', message: 'No copy of the final invoice is attached.' });
  return out;
}

const docStatusOf = (r: Review | undefined): DocStatus => r?.doc_status ?? 'proforma_received';

export function listVatReviews(ctx: Ctx, userId: number): VatReviewRow[] {
  requirePermission(ctx, userId, 'purchase.view');
  const bases = ctx.db.prepare(`${BASE} ORDER BY b.doc_date DESC, b.id DESC LIMIT 500`).all() as BillBase[];
  return bases.map((b) => {
    const r = loadReview(ctx, b.billId);
    const files = r ? (ctx.db.prepare('SELECT COUNT(*) AS n FROM supplier_vat_attachments WHERE review_id = ?').get(r.id) as { n: number }).n : 0;
    return rowOf(b, r, discrepanciesOf(ctx, b, r, files).some((d) => d.code !== 'no_copy'));
  });
}

const rowOf = (b: BillBase, r: Review | undefined, attention: boolean): VatReviewRow => ({
  billId: b.billId, supplier: b.supplier, docNo: b.docNo, docDate: b.docDate, pinvNo: b.pinvNo, postedVat: b.postedVat, gross: b.gross,
  docStatus: docStatusOf(r), paymentStatus: paymentStatus(b.paid, b.gross), vatStatus: r?.vat_status ?? 'pending', finalNo: r?.final_no ?? null, attention,
});

export function getVatReview(ctx: Ctx, userId: number, billId: number): VatReviewDetail {
  requirePermission(ctx, userId, 'purchase.view');
  const b = loadBase(ctx, billId);
  const r = loadReview(ctx, billId);
  const attachments = r
    ? (ctx.db.prepare('SELECT a.id, a.file_name AS fileName, a.mime, a.bytes, a.at, u.display_name AS userName FROM supplier_vat_attachments a JOIN users u ON u.id = a.user_id WHERE a.review_id = ? ORDER BY a.id').all(r.id) as VatReviewDetail['attachments'])
    : [];
  const events = r
    ? (ctx.db.prepare('SELECT e.action, e.at, u.display_name AS userName, e.details FROM supplier_vat_events e JOIN users u ON u.id = e.user_id WHERE e.review_id = ? ORDER BY e.id').all(r.id) as { action: string; at: string; userName: string; details: string }[]).map((e) => ({ ...e, details: JSON.parse(e.details) as Record<string, unknown> }))
    : [];
  const discrepancies = discrepanciesOf(ctx, b, r, attachments.length);
  return {
    ...rowOf(b, r, discrepancies.some((d) => d.code !== 'no_copy')),
    paper: { net: b.paperNet, vat: b.paperVat, total: b.paperTotal },
    paid: b.paid,
    final: r ? { invoiceNo: r.final_no, invoiceDate: r.final_date, net: r.final_net, vat: r.final_vat, total: r.final_total, supplierVatNo: r.final_vat_no } : null,
    compare: r ? { netDiff: r.final_net - b.paperNet, vatDiff: r.final_vat - b.paperVat, totalDiff: r.final_total - b.paperTotal } : null,
    discrepancies,
    maxClaim: r ? Math.min(b.postedVat, r.final_vat) : 0,
    approvedVat: r?.approved_vat ?? null,
    accountantName: r?.accountant_name ?? null,
    decisionRef: r?.decision_ref ?? null,
    decisionNote: r?.decision_note ?? null,
    verifyNote: r?.verify_note ?? null,
    attachments,
    events,
  };
}

export interface FinalInvoiceInput {
  billId: number;
  invoiceNo: string;
  invoiceDate: string;
  net: number;
  vat: number;
  total: number;
  supplierVatNo?: string;
}

/** Links the final tax invoice to the proforma. Correcting it sends the review back to the start. Posts nothing. */
export function recordFinalInvoice(ctx: Ctx, userId: number, input: FinalInvoiceInput): void {
  requirePermission(ctx, userId, 'vat.review');
  ctx.db.transaction(() => {
    const b = loadBase(ctx, input.billId);
    const no = input.invoiceNo.trim();
    if (!no) throw new DomainError('VALIDATION', 'Enter the number printed on the final invoice');
    if (!DAY.test(input.invoiceDate)) throw new DomainError('VALIDATION', 'Dates must be YYYY-MM-DD');
    if (input.invoiceDate > today(ctx)) throw new DomainError('VALIDATION', 'The final invoice date cannot be in the future');
    if (input.invoiceDate < b.docDate) throw new DomainError('VALIDATION', 'The final invoice cannot be dated before the proforma');
    if ([input.net, input.vat, input.total].some((v) => !Number.isSafeInteger(v) || v < 0)) throw new DomainError('VALIDATION', 'Check the amounts');
    if (input.net + input.vat !== input.total) throw new DomainError('VALIDATION', 'Net plus VAT must equal the total');

    const other = ctx.db.prepare('SELECT bill_id FROM supplier_vat_reviews WHERE supplier_id = ? AND final_no = ? AND bill_id <> ?').get(b.supplierId, no, b.billId);
    if (other) throw new DomainError('CONFLICT', `Final invoice ${no} is already linked to another proforma`);
    const entered = ctx.db.prepare('SELECT pinv_no FROM purchase_invoices WHERE supplier_id = ? AND supplier_invoice_no = ?').get(b.supplierId, no) as { pinv_no: string } | undefined;
    if (entered) throw new DomainError('CONFLICT', `Number ${no} from this supplier is already entered as purchase ${entered.pinv_no}`);

    const vatNo = input.supplierVatNo?.trim() || null;
    const r = loadReview(ctx, b.billId);
    if (!r) {
      const id = Number(
        ctx.db
          .prepare(`INSERT INTO supplier_vat_reviews (bill_id, invoice_id, supplier_id, doc_status, vat_status, final_no, final_date, final_net, final_vat, final_total, final_vat_no, updated_at) VALUES (?, ?, ?, 'final_received', 'pending', ?, ?, ?, ?, ?, ?, ?)`)
          .run(b.billId, b.invoiceId, b.supplierId, no, input.invoiceDate, input.net, input.vat, input.total, vatNo, ctx.now()).lastInsertRowid,
      );
      log(ctx, userId, id, b.billId, 'final_recorded', { invoiceNo: no, invoiceDate: input.invoiceDate, net: input.net, vat: input.vat, total: input.total });
      return;
    }
    if (['approved', 'claimed', 'not_claimed'].includes(r.vat_status)) throw new DomainError('CONFLICT', 'The VAT decision is already made, so the final invoice can no longer be changed');
    ctx.db
      .prepare(`UPDATE supplier_vat_reviews SET doc_status = 'final_received', vat_status = 'pending', final_no = ?, final_date = ?, final_net = ?, final_vat = ?, final_total = ?, final_vat_no = ?,
                verify_note = NULL, accountant_name = NULL, decision_ref = NULL, decision_note = NULL, approved_vat = NULL, updated_at = ? WHERE id = ?`)
      .run(no, input.invoiceDate, input.net, input.vat, input.total, vatNo, ctx.now(), r.id);
    log(ctx, userId, r.id, b.billId, 'final_corrected', { was: { invoiceNo: r.final_no, net: r.final_net, vat: r.final_vat, total: r.final_total }, now: { invoiceNo: no, net: input.net, vat: input.vat, total: input.total } });
  })();
}

export interface AttachInput {
  billId: number;
  fileName: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  dataBase64: string;
}

/** Keeps a copy of the final invoice. Having a copy changes no status: a person still has to verify it. */
export function attachFinalDocument(ctx: Ctx, userId: number, input: AttachInput): number {
  requirePermission(ctx, userId, 'vat.review');
  return ctx.db.transaction(() => {
    const r = needReview(ctx, input.billId);
    const data = Buffer.from(input.dataBase64, 'base64');
    if (data.length === 0 || data.length > MAX_FILE) throw new DomainError('VALIDATION', 'The file must be 5 MB or smaller');
    const sha = createHash('sha256').update(data).digest('hex');
    const seen = ctx.db.prepare('SELECT review_id FROM supplier_vat_attachments WHERE sha256 = ?').get(sha);
    if (seen) throw new DomainError('CONFLICT', 'This file is already attached');
    const name = input.fileName.trim().slice(0, 120) || 'invoice';
    const id = Number(ctx.db.prepare('INSERT INTO supplier_vat_attachments (review_id, sha256, file_name, mime, bytes, data, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(r.id, sha, name, input.mime, data.length, data, userId, ctx.now()).lastInsertRowid);
    log(ctx, userId, r.id, input.billId, 'attached', { fileName: name, bytes: data.length, sha256: sha });
    return id;
  })();
}

/** A person has compared the final invoice with the paper. The VAT now waits for the accountant. */
export function verifyFinalInvoice(ctx: Ctx, userId: number, input: { billId: number; note?: string }): void {
  requirePermission(ctx, userId, 'vat.review');
  ctx.db.transaction(() => {
    const r = needReview(ctx, input.billId);
    if (r.doc_status === 'details_verified') throw new DomainError('CONFLICT', 'This final invoice is already verified');
    const b = loadBase(ctx, input.billId);
    const files = (ctx.db.prepare('SELECT COUNT(*) AS n FROM supplier_vat_attachments WHERE review_id = ?').get(r.id) as { n: number }).n;
    const problems = discrepanciesOf(ctx, b, r, files).filter((d) => d.code !== 'no_copy');
    const note = input.note?.trim() || null;
    if (problems.length > 0 && !note) throw new DomainError('VALIDATION', 'There are differences to explain. Write a note before verifying.');
    ctx.db.prepare("UPDATE supplier_vat_reviews SET doc_status = 'details_verified', vat_status = 'accountant_pending', verify_note = ?, updated_at = ? WHERE id = ?").run(note, ctx.now(), r.id);
    log(ctx, userId, r.id, input.billId, 'verified', { note, differences: problems.map((d) => d.code) });
  })();
}

export interface DecisionInput {
  billId: number;
  decision: 'approve' | 'reject';
  accountantName: string;
  reference?: string;
  note?: string;
  approvedVat?: number;
}

/** Records what the accountant decided. The app does not decide. Nothing is posted here. */
export function decideVat(ctx: Ctx, userId: number, input: DecisionInput): void {
  requirePermission(ctx, userId, 'vat.approve');
  ctx.db.transaction(() => {
    const r = needReview(ctx, input.billId);
    if (r.vat_status !== 'accountant_pending') throw new DomainError('CONFLICT', 'This VAT is not waiting for the accountant');
    const name = input.accountantName.trim();
    if (!name) throw new DomainError('VALIDATION', 'Enter the name of the accountant who decided');
    const note = input.note?.trim() || null;
    const ref = input.reference?.trim() || null;
    if (input.decision === 'reject') {
      ctx.db.prepare("UPDATE supplier_vat_reviews SET vat_status = 'rejected', accountant_name = ?, decision_ref = ?, decision_note = ?, updated_at = ? WHERE id = ?").run(name, ref, note, ctx.now(), r.id);
      log(ctx, userId, r.id, input.billId, 'rejected', { accountant: name, reference: ref, note });
      return;
    }
    const b = loadBase(ctx, input.billId);
    if (!validVatNo(r.final_vat_no)) throw new DomainError('VALIDATION', 'A valid supplier VAT number is needed before the VAT can be approved');
    const amount = input.approvedVat ?? 0;
    const max = Math.min(b.postedVat, r.final_vat);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > max) throw new DomainError('VALIDATION', `Approved VAT must be more than zero and no more than ${sar(max)}`);
    ctx.db.prepare("UPDATE supplier_vat_reviews SET vat_status = 'approved', accountant_name = ?, decision_ref = ?, decision_note = ?, approved_vat = ?, updated_at = ? WHERE id = ?").run(name, ref, note, amount, ctx.now(), r.id);
    log(ctx, userId, r.id, input.billId, 'approved', { accountant: name, reference: ref, note, approvedVat: amount });
  })();
}

function claimRow(ctx: Ctx, userId: number, reviewId: number, requestKey: string, kind: 'claim' | 'reverse', amount: number, day: string, reason: string | null): number {
  return Number(ctx.db.prepare('INSERT INTO supplier_vat_claims (review_id, request_key, kind, amount, claim_date, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(reviewId, requestKey, kind, amount, day, reason, userId, ctx.now()).lastInsertRowid);
}

/** Moves the approved VAT out of cost and into input VAT, as a new entry dated on the claim day. */
export function claimVat(ctx: Ctx, userId: number, input: { billId: number; requestKey: string; claimDate: string }): { claimId: number; replayed: boolean } {
  requirePermission(ctx, userId, 'vat.approve');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare("SELECT id FROM supplier_vat_claims WHERE request_key = ? AND kind = 'claim'").get(input.requestKey) as { id: number } | undefined;
    if (done) return { claimId: done.id, replayed: true };
    const r = needReview(ctx, input.billId);
    if (r.vat_status === 'claimed') throw new DomainError('CONFLICT', 'This VAT has already been claimed');
    if (r.vat_status !== 'approved') throw new DomainError('CONFLICT', 'Only VAT the accountant has approved can be claimed');
    if (!DAY.test(input.claimDate) || input.claimDate > today(ctx)) throw new DomainError('VALIDATION', 'The claim date must be today or earlier');
    if (input.claimDate < r.final_date) throw new DomainError('VALIDATION', 'The claim cannot be dated before the final invoice');
    const b = loadBase(ctx, input.billId);
    const amount = r.approved_vat!;
    const claimId = claimRow(ctx, userId, r.id, input.requestKey, 'claim', amount, input.claimDate, null);
    postEntry(ctx, { date: input.claimDate, sourceType: 'vat_claim', sourceId: claimId, memo: `VAT claimed on ${b.docNo} (final invoice ${r.final_no})`, lines: [{ account: '2210', debit: amount }, { account: '5010', credit: amount }] });
    ctx.db.prepare("UPDATE supplier_vat_reviews SET vat_status = 'claimed', updated_at = ? WHERE id = ?").run(ctx.now(), r.id);
    log(ctx, userId, r.id, input.billId, 'claimed', { amount, claimDate: input.claimDate, claimId });
    return { claimId, replayed: false };
  })();
}

/** Undoes a claim with an opposite entry. The first entry stays. The VAT goes back to approved. */
export function reverseVatClaim(ctx: Ctx, userId: number, input: { billId: number; reason: string; requestKey: string }): void {
  requirePermission(ctx, userId, 'vat.approve');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  const reason = input.reason.trim();
  if (!reason) throw new DomainError('VALIDATION', 'Give a reason');
  ctx.db.transaction(() => {
    const r = needReview(ctx, input.billId);
    if (r.vat_status !== 'claimed') throw new DomainError('CONFLICT', 'There is no claim to reverse');
    const b = loadBase(ctx, input.billId);
    const amount = r.approved_vat!;
    const day = today(ctx);
    const id = claimRow(ctx, userId, r.id, input.requestKey, 'reverse', amount, day, reason);
    postEntry(ctx, { date: day, sourceType: 'vat_claim', sourceId: id, memo: `VAT claim reversed on ${b.docNo}: ${reason}`, lines: [{ account: '5010', debit: amount }, { account: '2210', credit: amount }] });
    ctx.db.prepare("UPDATE supplier_vat_reviews SET vat_status = 'approved', updated_at = ? WHERE id = ?").run(ctx.now(), r.id);
    log(ctx, userId, r.id, input.billId, 'claim_reversed', { amount, reason, claimId: id });
  })();
}

/** The VAT stays as a cost, and the review is closed. */
export function markNotClaimed(ctx: Ctx, userId: number, input: { billId: number; reason: string }): void {
  requirePermission(ctx, userId, 'vat.approve');
  const reason = input.reason.trim();
  if (!reason) throw new DomainError('VALIDATION', 'Give a reason');
  ctx.db.transaction(() => {
    const r = needReview(ctx, input.billId);
    if (r.vat_status !== 'approved' && r.vat_status !== 'rejected') throw new DomainError('CONFLICT', 'Only a decided VAT that has not been claimed can be closed');
    ctx.db.prepare("UPDATE supplier_vat_reviews SET vat_status = 'not_claimed', updated_at = ? WHERE id = ?").run(ctx.now(), r.id);
    log(ctx, userId, r.id, input.billId, 'not_claimed', { reason });
  })();
}

/** A copy of the attached file, for opening or printing. */
export function vatAttachment(ctx: Ctx, userId: number, id: number): { fileName: string; mime: string; dataBase64: string } {
  requirePermission(ctx, userId, 'purchase.view');
  const a = ctx.db.prepare('SELECT file_name AS fileName, mime, data FROM supplier_vat_attachments WHERE id = ?').get(id) as { fileName: string; mime: string; data: Buffer } | undefined;
  if (!a) throw new DomainError('NOT_FOUND', 'File not found');
  return { fileName: a.fileName, mime: a.mime, dataBase64: a.data.toString('base64') };
}

/** VAT sitting on proformas whose review is not finished. Dated by the proforma. An estimate, never input VAT. */
export function vatPendingBetween(ctx: Ctx, from: string, to: string): number {
  return (ctx.db
    .prepare(`SELECT COALESCE(SUM(b.vat),0) AS v FROM (${BASE.replace('SELECT b.id AS billId', 'SELECT i.vat_amount AS vat, b.doc_date AS day, b.id AS billId')}) b
              WHERE b.day BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM supplier_vat_reviews r WHERE r.bill_id = b.billId AND r.vat_status IN ('claimed','not_claimed'))`)
    .get(from, to) as { v: number }).v;
}

/** Claims less reversals, by claim date. */
export function vatClaimsBetween(ctx: Ctx, from: string, to: string): number {
  return (ctx.db.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'claim' THEN amount ELSE -amount END),0) AS v FROM supplier_vat_claims WHERE claim_date BETWEEN ? AND ?").get(from, to) as { v: number }).v;
}
