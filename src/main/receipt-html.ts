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
  const TENDER: Record<string, string> = { cash: 'Cash / نقداً', card: 'Card / بطاقة' };
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
${pays}<tr><td>Change / الباقي</td><td></td><td class="r">${formatSar(r.changeGiven)}</td></tr>`}
</table></body></html>`;
}
