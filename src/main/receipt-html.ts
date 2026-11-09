import { formatQty, formatSar, roundDiv } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { ReceiptData } from '../services/sales';
import type { StoreDetails } from '../services/store-details';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TENDER: Record<string, string> = { cash: 'Cash / نقداً', card: 'Card / بطاقة', bank: 'Bank transfer / تحويل بنكي', account: 'On account / آجل' };

const style = (mm: 58 | 80) => `<style>
  @page { size: ${mm}mm auto; margin: 0 }
  body { width: ${mm - 8}mm; margin: 0 auto; overflow-wrap: anywhere; font: 12px Tahoma, Arial, sans-serif; color: #000 }
  table { width: 100%; border-collapse: collapse } td { padding: 1px 0; vertical-align: top } .r { text-align: right }
  .c { text-align: center } hr { border: 0; border-top: 1px dashed #000 } .b { font-weight: bold; font-size: 14px }
  img { max-width: 40mm; max-height: 20mm }
</style>`;

function open(mm: 58 | 80 = 80): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
${style(mm)}</head><body>`;
}

function line(cls: string, text: string, rtl = false): string {
  return text ? `<div class="${cls}"${rtl ? ' dir="rtl"' : ''}>${esc(text)}</div>` : '';
}

/** The store's own details, the same on every slip. Stored values only. */
function header(s: StoreDetails): string {
  return `${s.logo ? `<div class="c"><img src="${esc(s.logo)}" alt=""></div>` : ''}
${line('c b', s.nameAr, true)}${line('c b', s.nameEn)}
${line('c', s.legalNameAr, true)}${line('c', s.legalNameEn)}
${line('c', s.addressLine, true)}
<div class="c">VAT No. / الرقم الضريبي: ${esc(s.vatNumber || '—')}</div>
${s.crNumber ? `<div class="c">CR / السجل التجاري: ${esc(s.crNumber)}</div>` : ''}
${s.mobile ? `<div class="c">Mob / جوال: ${esc(s.mobile)}</div>` : ''}`;
}

function rowsOf(r: ReceiptData): string {
  return r.lines
    .map(
      (l, i) => `<tr><td colspan="4">${i + 1}. <span dir="rtl">${esc(l.nameAr)}</span><div>${esc(l.nameEn)}</div></td></tr>
<tr><td>${formatQty(l.qty, 3)}</td><td class="r">${formatSar(roundDiv(l.lineExcl * 1000, l.qty))}</td><td class="r">${formatSar(l.lineVat)}</td><td class="r">${formatSar(l.lineIncl)}</td></tr>
${l.discount ? `<tr><td colspan="3">Discount / خصم</td><td class="r">-${formatSar(l.discount)}</td></tr>` : ''}`,
    )
    .join('');
}

const money = (label: string, amount: number, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td><td class="r">${formatSar(amount)}</td></tr>`;

/**
 * Receipt as HTML for an 80 mm thermal printer through the Windows driver.
 * Chromium does the Arabic shaping, so the printer's code page does not matter (plan §L-8).
 * NOTE: no ZATCA QR yet; that comes with the ZATCA phase. The TEST BUILD line stays until then.
 */
export function receiptHtml(r: ReceiptData, store: StoreDetails, copy: boolean, mm: 58 | 80 = 80): string {
  if (r.kind === 'payment') return paymentReceiptHtml(r, store, copy, mm);
  const refund = r.kind === 'refund';
  const payType = r.payments.map((p) => esc(TENDER[p.tender] ?? p.tender)).join(' + ');
  return `${open(mm)}
${header(store)}
${copy ? '<div class="c b">COPY / نسخة</div>' : ''}
${refund ? '<div class="c b">REFUND — CREDIT NOTE<br><span dir="rtl">استرداد — إشعار دائن</span></div>' : '<div class="c b">Simplified Tax Invoice<br><span dir="rtl">فاتورة ضريبية مبسطة</span></div>'}
<div class="c">TEST BUILD — NOT A ZATCA ${refund ? 'CREDIT NOTE' : 'TAX INVOICE'}</div>
<hr>${refund
    ? `<div>Credit note: ${esc(r.invoiceNo)}</div><div>Original invoice / الفاتورة الأصلية: ${esc(r.originalInvoiceNo ?? '')}</div><div>Reason / السبب: ${esc(r.reason ?? '')}</div>`
    : `<div>Invoice / الفاتورة: ${esc(r.invoiceNo)}</div>`}
<div>Date / التاريخ: ${esc(storeDateTime(r.createdAt))}</div>
${r.customerName ? `<div>Customer / العميل: ${esc(r.customerName)}</div>` : ''}${r.customerVat ? `<div>Customer VAT / ضريبة العميل: ${esc(r.customerVat)}</div>` : ''}
<div>Payment / الدفع: ${payType}</div>
<div>Cashier / الكاشير: ${esc(r.cashier)}</div>${r.approver ? `<div>Approved by: ${esc(r.approver)}</div>` : ''}<hr>
<table><tr><td>Qty</td><td class="r">Rate</td><td class="r">VAT</td><td class="r">Total</td></tr>${rowsOf(r)}</table><hr>
<table>
${money('Before VAT / قبل الضريبة', r.totalExcl)}
${money('Discount / الخصم', r.totalDiscount)}
${money('VAT 15% / الضريبة', r.totalVat)}
${refund
    ? `${money('Refunded / المبلغ المسترد', r.totalIncl, 'b')}${r.payments.map((p) => money(p.tender === 'cash' ? 'Paid back in cash / نقداً' : 'Taken off the account / خصم من الحساب', p.amount)).join('')}`
    : `${money('Grand Total / الإجمالي', r.totalIncl, 'b')}
${r.payments.map((p) => money(esc(TENDER[p.tender] ?? p.tender), p.amount)).join('')}
${money('Change / الباقي', r.changeGiven)}
${r.remainingOnAccount ? `${money('Paid now / المدفوع الآن', r.totalIncl - r.remainingOnAccount, 'b')}${money('Remaining on account / المتبقي آجل', r.remainingOnAccount, 'b')}
<tr><td colspan="2">${r.remainingOnAccount === r.totalIncl ? 'UNPAID / غير مدفوع' : 'PARTIALLY PAID / مدفوع جزئياً'}</td></tr>` : ''}`}
</table><hr>
${refund ? '' : `${line('c', store.footerAr || 'شكراً لتسوقكم معنا', true)}${line('c', store.footerEn || 'Thank you for shopping with us')}<div class="c">VAT Included / شامل الضريبة</div>`}
</body></html>`;
}

function paymentReceiptHtml(r: ReceiptData, store: StoreDetails, copy: boolean, mm: 58 | 80): string {
  const allocs = (r.allocations ?? []).map((a) => `<tr><td>${esc(a.invoiceNo)}</td><td class="r">${formatSar(a.amount)}</td></tr>`).join('');
  const applied = (r.allocations ?? []).reduce((s, a) => s + a.amount, 0);
  return `${open(mm)}
${header(store)}
${copy ? '<div class="c b">COPY / نسخة</div>' : ''}
<div class="c b">PAYMENT RECEIPT / سند قبض</div><hr>
<div>Receipt: ${esc(r.invoiceNo)}</div><div>Date / التاريخ: ${esc(storeDateTime(r.createdAt))}</div>
<div>Customer / العميل: ${esc(r.customerName ?? '')}</div><div>Received by: ${esc(r.cashier)}</div><hr>
<table>${money('Amount / المبلغ', r.totalIncl, 'b')}
${r.payments.map((p) => money(esc(TENDER[p.tender] ?? p.tender), p.amount)).join('')}
</table><hr><div>Applied to / سداد الفواتير:</div><table>${allocs || '<tr><td>—</td></tr>'}</table>
${r.totalIncl - applied > 0 ? `<div>Held as advance / رصيد مقدم: ${formatSar(r.totalIncl - applied)}</div>` : ''}
<hr><div class="b">Balance still owed / الرصيد المتبقي: ${formatSar(r.remainingOnAccount ?? 0)}</div>
</body></html>`;
}
