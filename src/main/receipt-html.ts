import { formatQty, formatSar } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { ReceiptData } from '../services/sales';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Receipt as HTML for an 80 mm thermal printer through the Windows driver.
 * Chromium does the Arabic shaping, so the printer's code page does not matter (plan §L-8).
 * NOTE: no ZATCA QR yet; that comes with the ZATCA phase. Labelled as not a tax invoice until then.
 */
export function receiptHtml(r: ReceiptData, store: { nameAr: string; nameEn: string; vatNumber: string }, copy: boolean): string {
  const rows = r.lines
    .map(
      (l) => `<tr><td colspan="3"><div dir="rtl">${esc(l.nameAr)}</div><div>${esc(l.nameEn)}</div></td></tr>
<tr><td>${formatQty(l.qty, 3)} × ${formatSar(l.unitPriceIncl)}</td><td>${l.discount ? '-' + formatSar(l.discount) : ''}</td><td class="r">${formatSar(l.lineIncl)}</td></tr>`,
    )
    .join('');
  const TENDER: Record<string, string> = { cash: 'Cash / نقداً', card: 'Card / بطاقة', bank: 'Bank transfer / تحويل بنكي', account: 'On account / آجل' };
  if (r.kind === 'payment') return paymentReceiptHtml(r, store, TENDER, copy);
  const pays = r.payments.map((p) => `<tr><td>${esc(TENDER[p.tender] ?? p.tender)}</td><td></td><td class="r">${formatSar(p.amount)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  @page { size: 80mm auto; margin: 0 }
  body { width: 72mm; margin: 0 auto; font: 12px Tahoma, Arial, sans-serif; color: #000 }
  table { width: 100%; border-collapse: collapse } td { padding: 1px 0; vertical-align: top } .r { text-align: right }
  .c { text-align: center } hr { border: 0; border-top: 1px dashed #000 } .b { font-weight: bold; font-size: 14px }
</style></head><body>
<div class="c b" dir="rtl">${esc(store.nameAr)}</div><div class="c b">${esc(store.nameEn)}</div>
<div class="c">VAT No. / الرقم الضريبي: ${esc(store.vatNumber || '—')}</div>
${copy ? '<div class="c b">COPY / نسخة</div>' : ''}
${r.kind === 'refund' ? '<div class="c b">REFUND — CREDIT NOTE<br><span dir="rtl">استرداد — إشعار دائن</span></div>' : ''}
<div class="c">TEST BUILD — NOT A ZATCA ${r.kind === 'refund' ? 'CREDIT NOTE' : 'TAX INVOICE'}</div>
<hr>${r.kind === 'refund'
    ? `<div>Credit note: ${esc(r.invoiceNo)}</div><div>Original invoice / الفاتورة الأصلية: ${esc(r.originalInvoiceNo ?? '')}</div><div>Reason / السبب: ${esc(r.reason ?? '')}</div>`
    : `<div>Invoice: ${esc(r.invoiceNo)}</div>`}
<div>Date / التاريخ: ${esc(storeDateTime(r.createdAt))}</div><div>Cashier: ${esc(r.cashier)}</div>${r.approver ? `<div>Approved by: ${esc(r.approver)}</div>` : ''}<hr>
<table>${rows}</table><hr>
<table>
<tr><td>Total excl. VAT</td><td></td><td class="r">${formatSar(r.totalExcl)}</td></tr>
<tr><td>VAT 15%</td><td></td><td class="r">${formatSar(r.totalVat)}</td></tr>
${r.kind === 'refund'
    ? `<tr class="b"><td>Refunded / المبلغ المسترد</td><td></td><td class="r">${formatSar(r.totalIncl)}</td></tr>
<tr><td>Paid back in cash / نقداً</td><td></td><td class="r">${formatSar(r.totalIncl)}</td></tr>`
    : `<tr class="b"><td>Total / الإجمالي</td><td></td><td class="r">${formatSar(r.totalIncl)}</td></tr>
${pays}<tr><td>Change / الباقي</td><td></td><td class="r">${formatSar(r.changeGiven)}</td></tr>
${r.remainingOnAccount ? `<tr class="b"><td>Paid now / المدفوع الآن</td><td></td><td class="r">${formatSar(r.totalIncl - r.remainingOnAccount)}</td></tr>
<tr class="b"><td>Remaining on account / المتبقي آجل</td><td></td><td class="r">${formatSar(r.remainingOnAccount)}</td></tr>
<tr><td colspan="3">Customer / العميل: ${esc(r.customerName ?? '')} · ${r.remainingOnAccount === r.totalIncl ? 'UNPAID / غير مدفوع' : 'PARTIALLY PAID / مدفوع جزئياً'}</td></tr>` : ''}`}
</table></body></html>`;
}

function paymentReceiptHtml(r: ReceiptData, store: { nameAr: string; nameEn: string; vatNumber: string }, TENDER: Record<string, string>, copy: boolean): string {
  const allocs = (r.allocations ?? []).map((a) => `<tr><td>${esc(a.invoiceNo)}</td><td></td><td class="r">${formatSar(a.amount)}</td></tr>`).join('');
  const applied = (r.allocations ?? []).reduce((s, a) => s + a.amount, 0);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>@page { size: 80mm auto; margin: 0 } body { width: 72mm; margin: 0 auto; font: 12px Tahoma, Arial, sans-serif; color: #000 }
table { width: 100%; border-collapse: collapse } td { padding: 1px 0 } .r { text-align: right } .c { text-align: center } hr { border: 0; border-top: 1px dashed #000 } .b { font-weight: bold; font-size: 14px }</style></head><body>
<div class="c b" dir="rtl">${esc(store.nameAr)}</div><div class="c b">${esc(store.nameEn)}</div>
${copy ? '<div class="c b">COPY / نسخة</div>' : ''}
<div class="c b">PAYMENT RECEIPT / سند قبض</div><hr>
<div>Receipt: ${esc(r.invoiceNo)}</div><div>Date / التاريخ: ${esc(storeDateTime(r.createdAt))}</div>
<div>Customer / العميل: ${esc(r.customerName ?? '')}</div><div>Received by: ${esc(r.cashier)}</div><hr>
<table><tr class="b"><td>Amount / المبلغ</td><td></td><td class="r">${formatSar(r.totalIncl)}</td></tr>
${r.payments.map((p) => `<tr><td>${esc(TENDER[p.tender] ?? p.tender)}</td><td></td><td class="r">${formatSar(p.amount)}</td></tr>`).join('')}
</table><hr><div>Applied to / سداد الفواتير:</div><table>${allocs || '<tr><td>—</td></tr>'}</table>
${r.totalIncl - applied > 0 ? `<div>Held as advance / رصيد مقدم: ${formatSar(r.totalIncl - applied)}</div>` : ''}
<hr><div class="b">Balance still owed / الرصيد المتبقي: ${formatSar(r.remainingOnAccount ?? 0)}</div>
</body></html>`;
}
