import { describe, expect, it } from 'vitest';
import type { ReceiptData } from '../services/sales';
import { BLANK_STORE, type StoreDetails } from '../services/store-details';
import { receiptHtml } from './receipt-html';

const store: StoreDetails = {
  ...BLANK_STORE,
  nameAr: 'متجر تجريبي', nameEn: 'Test Mart', legalNameAr: 'شركة تجريبية', vatNumber: '300000000000003', crNumber: '1234567890',
  mobile: '0500000000', addressLine: 'Test District - Test Street', footerAr: 'شكراً لكم', footerEn: 'Thanks for coming',
};
const sale: ReceiptData = {
  invoiceNo: 'INV-00000001', uuid: 'u', createdAt: '2026-11-05T08:00:00.000Z', cashier: 'Test Cashier',
  lines: [{ nameAr: 'ماء', nameEn: 'Water', qty: 1000, unitPriceIncl: 900, discount: 0, lineIncl: 900, lineVat: 117, lineExcl: 783, vatRateBp: 1500 }],
  totalExcl: 1174, totalVat: 176, totalIncl: 1350, totalDiscount: 25, payments: [{ tender: 'cash', amount: 2000 }], changeGiven: 650,
};
const html = (r: Partial<ReceiptData> = {}, s = store) => receiptHtml({ ...sale, ...r }, s, false);

describe('customer receipt', () => {
  it('prints every header field in order', () => {
    const h = html();
    const at = ['متجر تجريبي', 'Test Mart', 'شركة تجريبية', 'Test District - Test Street', '300000000000003', '1234567890', '0500000000'].map((x) => h.indexOf(x));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('keeps the TEST BUILD line and the Simplified Tax Invoice title', () => {
    const h = html();
    expect(h).toContain('Simplified Tax Invoice');
    expect(h).toContain('فاتورة ضريبية مبسطة');
    expect(h).toContain('TEST BUILD');
  });

  it('shows Rate excl. VAT and line VAT', () => {
    const h = html();
    for (const v of ['7.83', '1.17', '9.00']) expect(h).toContain(v);
  });

  it('shows real cash paid and change', () => {
    const h = html();
    expect(h).toContain('20.00');
    expect(h).toContain('6.50');
  });

  it('shows discount total, thank-you and VAT Included', () => {
    const h = html();
    expect(h).toContain('0.25');
    expect(h).toContain('Thanks for coming');
    expect(h).toContain('شكراً لكم');
    expect(h).toContain('VAT Included');
  });

  it('shows the customer and their VAT number when present', () => {
    const h = html({ customerName: 'Test Customer', customerVat: '311111111111113' });
    expect(h).toContain('Test Customer');
    expect(h).toContain('311111111111113');
  });

  it('still prints with no logo and blank details', () => {
    const h = html({}, BLANK_STORE);
    expect(h).toContain('INV-00000001');
    expect(h).not.toContain('<img');
  });

  it('prints the logo, and the page allows it', () => {
    const h = html({}, { ...store, logo: 'data:image/png;base64,AAAA' });
    expect(h).toContain('<img src="data:image/png;base64,AAAA"');
    expect(h).toContain('img-src data:');
  });

  it('escapes what staff typed', () => {
    expect(html({}, { ...store, nameEn: '<b>x</b>' })).not.toContain('<b>x</b>');
  });

  it('a refund slip uses the same header and is not called a tax invoice', () => {
    const h = html({ kind: 'refund', originalInvoiceNo: 'INV-1', reason: 'Test' });
    expect(h).toContain('Test District - Test Street');
    expect(h).not.toContain('Simplified Tax Invoice');
    expect(h).toContain('CREDIT NOTE');
  });

  it('a refund against a credit sale shows what came off the account and what was paid in cash', () => {
    const h = html({ kind: 'refund', originalInvoiceNo: 'INV-1', reason: 'Test', totalIncl: 1350, payments: [{ tender: 'account', amount: 600 }, { tender: 'cash', amount: 750 }] });
    expect(h).toContain('6.00');
    expect(h).toContain('7.50');
    expect(h).not.toMatch(/Paid back in cash[^<]*<\/td><td class="r">13\.50/);
  });

  it('a payment receipt uses the same header', () => {
    const h = html({ kind: 'payment', allocations: [] });
    expect(h).toContain('Test District - Test Street');
    expect(h).toContain('PAYMENT RECEIPT');
  });
});
