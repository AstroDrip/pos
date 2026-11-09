// VAT on a proforma: every name here is made up.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import { datedTrialBalance } from './financials';
import { unbalancedEntries } from './ledger';
import { createSupplier } from './parties';
import { paySupplier, supplierBalances } from './purchasing';
import { createSupplierBill, type SupplierBillInput } from './supplier-bills';
import { makeTestCtx, seedUsers } from './test-helpers';
import { attachFinalDocument, claimVat, decideVat, getVatReview, listVatReviews, markNotClaimed, recordFinalInvoice, reverseVatClaim, verifyFinalInvoice } from './vat-review';
import { vatSummary } from './vat-report';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let apple: number;
let sup: number;
let n = 0;
const key = () => `vat-key-${++n}-xxxx`;
const TODAY = '2026-11-05';
const VATNO = '300000000000003';

const acct = (code: string) => {
  const r = datedTrialBalance(ctx, u.admin, '2000-01-01', '2099-12-31').rows.find((x) => x.code === code);
  return r ? r.debit - r.credit : 0;
};
const count = (table: string) => (ctx.db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
const owed = () => supplierBalances(ctx, u.admin).find((r) => r.supplierId === sup)?.balance ?? 0;
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW ${(e as Error).message}`;
  }
};

const proforma = (o: Partial<SupplierBillInput> = {}) =>
  createSupplierBill(ctx, u.admin, {
    requestKey: key(), supplierId: sup, docType: 'proforma', docNo: 'PF-1', docDate: '2026-11-01', payType: 'credit', pages: 1, billDiscount: 0, billCharge: 0,
    paper: { net: 20_000, vat: 3_000, total: 23_000 },
    lines: [{ productId: apple, packName: 'CTN', pageNo: 1, unitsPerPack: 10_000, packs: 2, looseQty: 0, freeQty: 0, priceBasis: 'pack', price: 10_000, vatRateBp: 1500 }],
    ...o,
  }).billId;

const FINAL = { invoiceNo: 'TAX-1', invoiceDate: '2026-11-04', net: 20_000, vat: 3_000, total: 23_000, supplierVatNo: VATNO };
const record = (billId: number, o: Partial<typeof FINAL> = {}) => recordFinalInvoice(ctx, u.admin, { billId, ...FINAL, ...o });
const approve = (billId: number, approvedVat = 3_000) => decideVat(ctx, u.admin, { billId, decision: 'approve', accountantName: 'Made Up Accountant', approvedVat });
const toApproved = (billId: number) => {
  record(billId);
  verifyFinalInvoice(ctx, u.admin, { billId });
  approve(billId);
};
const claim = (billId: number, requestKey = key()) => claimVat(ctx, u.admin, { billId, requestKey, claimDate: TODAY });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  apple = createProduct(ctx, u.admin, { sku: 'APPLE', nameEn: 'Item', nameAr: 'صنف', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 900 });
  sup = createSupplier(ctx, u.admin, { name: 'Made Up Dairy', vatNumber: VATNO, paymentTermsDays: 30 });
});
afterEach(() => t.cleanup());

describe('states stay separate', () => {
  it('a new proforma is listed: document, payment and VAT each have their own status', () => {
    proforma();
    const [r] = listVatReviews(ctx, u.admin);
    expect(r).toMatchObject({ docNo: 'PF-1', docStatus: 'proforma_received', paymentStatus: 'unpaid', vatStatus: 'pending', postedVat: 3_000 });
  });

  it('paying the proforma changes only the payment status', () => {
    const billId = proforma();
    paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 10_000, method: 'bank', paidOn: TODAY });
    const r = getVatReview(ctx, u.admin, billId);
    expect(r.paymentStatus).toBe('part');
    expect(r.docStatus).toBe('proforma_received');
    expect(r.vatStatus).toBe('pending');
  });

  it('a proforma whose VAT was already claimed at entry, and a delivery note, are not listed', () => {
    proforma({ claimVat: true });
    proforma({ docType: 'delivery_note', docNo: 'DN-1', notSameGoods: true });
    expect(listVatReviews(ctx, u.admin)).toEqual([]);
  });
});

describe('final invoice', () => {
  it('links to the purchase: no second purchase, payable, stock or VAT', () => {
    const billId = proforma();
    const before = { inv: count('purchase_invoices'), bills: count('supplier_bills'), move: count('stock_movements'), je: count('journal_entries'), owed: owed(), a2210: acct('2210'), a5010: acct('5010') };
    record(billId);
    expect({ inv: count('purchase_invoices'), bills: count('supplier_bills'), move: count('stock_movements'), je: count('journal_entries'), owed: owed(), a2210: acct('2210'), a5010: acct('5010') }).toEqual(before);
    expect(getVatReview(ctx, u.admin, billId)).toMatchObject({ docStatus: 'final_received', vatStatus: 'pending' });
  });

  it('a total that does not add up is refused', () => {
    expect(code(() => record(proforma(), { total: 99_999 }))).toBe('VALIDATION');
  });

  it('the same final invoice number cannot serve two proformas, or match an entered purchase', () => {
    const a = proforma();
    const b = proforma({ docNo: 'PF-2', notSameGoods: true });
    record(a);
    expect(code(() => record(b))).toBe('CONFLICT');
    expect(code(() => record(b, { invoiceNo: 'PF-1' }))).toBe('CONFLICT');
  });

  it('a date before the proforma is refused and a date in the future is refused', () => {
    const billId = proforma();
    expect(code(() => record(billId, { invoiceDate: '2026-10-31' }))).toBe('VALIDATION');
    expect(code(() => record(billId, { invoiceDate: '2099-01-01' }))).toBe('VALIDATION');
  });

  it('shows the difference when amounts changed', () => {
    const billId = proforma();
    record(billId, { net: 19_000, vat: 2_850, total: 21_850 });
    const r = getVatReview(ctx, u.admin, billId);
    expect(r.compare).toEqual({ netDiff: -1_000, vatDiff: -150, totalDiff: -1_150 });
    expect(r.discrepancies.map((d) => d.code)).toEqual(expect.arrayContaining(['net_diff', 'vat_diff', 'total_diff']));
  });

  it('cannot be changed after the VAT is approved', () => {
    const billId = proforma();
    toApproved(billId);
    expect(code(() => record(billId, { invoiceNo: 'TAX-9' }))).toBe('CONFLICT');
  });
});

describe('attachments', () => {
  const file = { fileName: 'inv.pdf', mime: 'application/pdf' as const, dataBase64: Buffer.from('%PDF-made-up').toString('base64') };

  it('uploading a document never makes the VAT eligible', () => {
    const billId = proforma();
    record(billId);
    attachFinalDocument(ctx, u.admin, { billId, ...file });
    expect(getVatReview(ctx, u.admin, billId)).toMatchObject({ vatStatus: 'pending', docStatus: 'final_received' });
    expect(getVatReview(ctx, u.admin, billId).attachments).toHaveLength(1);
    expect(acct('2210')).toBe(0);
  });

  it('the same file cannot be attached twice', () => {
    const billId = proforma();
    record(billId);
    attachFinalDocument(ctx, u.admin, { billId, ...file });
    expect(code(() => attachFinalDocument(ctx, u.admin, { billId, ...file }))).toBe('CONFLICT');
  });

  it('needs a final invoice first, and refuses a file over 5 MB', () => {
    const billId = proforma();
    expect(code(() => attachFinalDocument(ctx, u.admin, { billId, ...file }))).toBe('CONFLICT');
    record(billId);
    expect(code(() => attachFinalDocument(ctx, u.admin, { billId, ...file, dataBase64: Buffer.alloc(5_000_001).toString('base64') }))).toBe('VALIDATION');
  });
});

describe('verification and accountant decision', () => {
  it('verify with no final invoice is refused', () => {
    expect(code(() => verifyFinalInvoice(ctx, u.admin, { billId: proforma() }))).toBe('CONFLICT');
  });

  it('verify moves VAT to accountant pending, and verifying twice is refused', () => {
    const billId = proforma();
    record(billId);
    verifyFinalInvoice(ctx, u.admin, { billId });
    expect(getVatReview(ctx, u.admin, billId)).toMatchObject({ docStatus: 'details_verified', vatStatus: 'accountant_pending' });
    expect(acct('2210')).toBe(0);
    expect(code(() => verifyFinalInvoice(ctx, u.admin, { billId }))).toBe('CONFLICT');
  });

  it('differences need a written note before verifying', () => {
    const billId = proforma();
    record(billId, { net: 19_000, vat: 2_850, total: 21_850 });
    expect(code(() => verifyFinalInvoice(ctx, u.admin, { billId }))).toBe('VALIDATION');
    verifyFinalInvoice(ctx, u.admin, { billId, note: 'Supplier gave a discount' });
    expect(getVatReview(ctx, u.admin, billId).docStatus).toBe('details_verified');
  });

  it('cannot approve before verification, without an accountant name, or without a valid supplier VAT number', () => {
    const billId = proforma();
    record(billId);
    expect(code(() => approve(billId))).toBe('CONFLICT');
    verifyFinalInvoice(ctx, u.admin, { billId });
    expect(code(() => decideVat(ctx, u.admin, { billId, decision: 'approve', accountantName: ' ', approvedVat: 3_000 }))).toBe('VALIDATION');

    const other = proforma({ docNo: 'PF-2', notSameGoods: true });
    record(other, { invoiceNo: 'TAX-2', supplierVatNo: '123' });
    verifyFinalInvoice(ctx, u.admin, { billId: other, note: 'Number looks short' });
    expect(code(() => approve(other))).toBe('VALIDATION');
  });

  it('approved VAT cannot pass the VAT posted or the VAT on the final invoice', () => {
    const billId = proforma();
    record(billId, { net: 19_000, vat: 2_850, total: 21_850 });
    verifyFinalInvoice(ctx, u.admin, { billId, note: 'Lower' });
    expect(code(() => approve(billId, 3_000))).toBe('VALIDATION');
    approve(billId, 2_850);
    expect(getVatReview(ctx, u.admin, billId).approvedVat).toBe(2_850);
  });

  it('approval posts nothing: only claiming does', () => {
    const billId = proforma();
    toApproved(billId);
    expect(acct('2210')).toBe(0);
    expect(acct('5010')).toBe(3_000);
    expect(getVatReview(ctx, u.admin, billId).vatStatus).toBe('approved');
  });

  it('rejected VAT stays as cost and can be marked not claimed', () => {
    const billId = proforma();
    record(billId);
    verifyFinalInvoice(ctx, u.admin, { billId });
    decideVat(ctx, u.admin, { billId, decision: 'reject', accountantName: 'Made Up Accountant', note: 'Not a valid invoice' });
    expect(code(() => claim(billId))).toBe('CONFLICT');
    markNotClaimed(ctx, u.admin, { billId, reason: 'Accountant refused it' });
    expect(getVatReview(ctx, u.admin, billId).vatStatus).toBe('not_claimed');
    expect(acct('2210')).toBe(0);
  });

  it('only those with the right permission can act', () => {
    const billId = proforma();
    expect(code(() => recordFinalInvoice(ctx, u.cashier, { billId, ...FINAL }))).toBe('PERMISSION_DENIED');
    expect(code(() => decideVat(ctx, u.supervisor, { billId, decision: 'reject', accountantName: 'X' }))).toBe('PERMISSION_DENIED');
  });
});

describe('claiming', () => {
  it('moves the VAT from cost to input VAT, keeps the original, and touches nothing else', () => {
    const billId = proforma();
    toApproved(billId);
    const before = { inv: count('purchase_invoices'), move: count('stock_movements'), owed: owed(), stock: acct('1200') };
    claim(billId);
    expect(acct('2210')).toBe(3_000);
    expect(acct('5010')).toBe(0);
    expect({ inv: count('purchase_invoices'), move: count('stock_movements'), owed: owed(), stock: acct('1200') }).toEqual(before);
    expect(unbalancedEntries(ctx)).toEqual([]);
    expect(getVatReview(ctx, u.admin, billId).vatStatus).toBe('claimed');
    const orig = ctx.db.prepare('SELECT vat_recoverable AS v FROM purchase_invoices').get() as { v: number };
    expect(orig.v).toBe(0);
  });

  it('claiming again is refused; the same request key replays without posting', () => {
    const billId = proforma();
    toApproved(billId);
    const k = key();
    claim(billId, k);
    const je = count('journal_entries');
    expect(claim(billId, k).replayed).toBe(true);
    expect(code(() => claim(billId))).toBe('CONFLICT');
    expect(count('journal_entries')).toBe(je);
    expect(acct('2210')).toBe(3_000);
  });

  it('a part-paid proforma claims the full approved VAT and the supplier balance stays the same', () => {
    const billId = proforma();
    paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 10_000, method: 'bank', paidOn: TODAY });
    toApproved(billId);
    const o = owed();
    claim(billId);
    expect(owed()).toBe(o);
    expect(acct('2210')).toBe(3_000);
  });

  it('a claim cannot be dated in the future or before the final invoice', () => {
    const billId = proforma();
    toApproved(billId);
    expect(code(() => claimVat(ctx, u.admin, { billId, requestKey: key(), claimDate: '2099-01-01' }))).toBe('VALIDATION');
    expect(code(() => claimVat(ctx, u.admin, { billId, requestKey: key(), claimDate: '2026-11-02' }))).toBe('VALIDATION');
  });

  it('the VAT summary counts a claim in its own period and still ties to the ledger', () => {
    const billId = proforma();
    toApproved(billId);
    claim(billId);
    const v = vatSummary(ctx, u.admin, '2026-11-01', '2026-11-30');
    expect(v.supplierVatClaims).toBe(3_000);
    expect(v.inputVat).toBe(3_000);
    expect(v.reconciles).toBe(true);
  });

  it('VAT still under review is reported as pending, not as input VAT', () => {
    proforma();
    const v = vatSummary(ctx, u.admin, '2026-11-01', '2026-11-30');
    expect(v.supplierVatPending).toBe(3_000);
    expect(v.inputVat).toBe(0);
  });

  it('reversing a claim puts the VAT back, needs a reason, and it can be claimed once more', () => {
    const billId = proforma();
    toApproved(billId);
    claim(billId);
    expect(code(() => reverseVatClaim(ctx, u.admin, { billId, reason: ' ', requestKey: key() }))).toBe('VALIDATION');
    reverseVatClaim(ctx, u.admin, { billId, reason: 'Accountant changed their mind', requestKey: key() });
    expect(acct('2210')).toBe(0);
    expect(acct('5010')).toBe(3_000);
    expect(getVatReview(ctx, u.admin, billId).vatStatus).toBe('approved');
    expect(code(() => reverseVatClaim(ctx, u.admin, { billId, reason: 'Again', requestKey: key() }))).toBe('CONFLICT');
    claim(billId);
    expect(acct('2210')).toBe(3_000);
    expect(unbalancedEntries(ctx)).toEqual([]);
  });

  it('every step is recorded with who did it, and in the audit log', () => {
    const billId = proforma();
    toApproved(billId);
    claim(billId);
    const r = getVatReview(ctx, u.admin, billId);
    expect(r.events.map((e) => e.action)).toEqual(['final_recorded', 'verified', 'approved', 'claimed']);
    expect(r.events.every((e) => e.userName.length > 0)).toBe(true);
    const actions = (ctx.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'vat.%' ORDER BY id").all() as { action: string }[]).map((a) => a.action);
    expect(actions).toEqual(['vat.final_recorded', 'vat.verified', 'vat.approved', 'vat.claimed']);
  });
});
