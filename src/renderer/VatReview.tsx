import { useEffect, useState } from 'react';
import { formatSar, parseSar } from '../core/money';
import { storeDay } from '../core/store-time';
import type { VatReviewDetail, VatReviewRow } from '../services/vat-review';
import { call } from './api';
import { useI18n } from './i18n';
import { HelpLink } from './HelpLink';
import { InfoIcon } from './InfoIcon';
import { EmptyRow } from './PageHeader';

const today = () => storeDay(new Date().toISOString());
const key = () => `vat-${crypto.randomUUID()}`;
const sar = (s: string) => {
  try {
    return s.trim() ? parseSar(s) : NaN;
  } catch {
    return NaN;
  }
};
const DOC_LABEL: Record<string, string> = { proforma_received: 'Proforma only', final_received: 'Final invoice received', details_verified: 'Details verified' };
const PAY_LABEL: Record<string, string> = { unpaid: 'Unpaid', part: 'Part paid', paid: 'Paid' };
const VAT_LABEL: Record<string, string> = { pending: 'VAT pending', accountant_pending: 'Waiting for accountant', approved: 'VAT approved', rejected: 'VAT refused', claimed: 'VAT claimed', not_claimed: 'VAT not claimed' };
const signed = (h: number) => (h > 0 ? `+${formatSar(h)}` : formatSar(h));

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

/** Proformas whose VAT is still a cost, and the steps that can turn it into input VAT. */
export function VatReview({ can }: { can: (p: string) => boolean }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<VatReviewRow[]>([]);
  const [open, setOpen] = useState<VatReviewDetail | null>(null);
  const [error, setError] = useState('');
  const load = () => void call<VatReviewRow[]>('vat.list').then(setRows, (e: Error) => setError(t(e.message)));
  useEffect(load, []);
  const show = (billId: number) => void call<VatReviewDetail>('vat.get', { billId }).then((d) => { setOpen(d); setError(''); }, (e: Error) => setError(t(e.message)));
  return (
    <div className="card section bill-card">
      <h3>{t('Proforma VAT review')} <HelpLink article="suppliers-proforma-vat" /></h3>
      <p className="hint">{t('VAT on a proforma stays a cost until the final tax invoice is checked and your accountant approves it.')}</p>
      {error && <p className="msg error">{error}</p>}
      <table className="list" aria-label="proforma vat review">
        <thead><tr><th>{t('Date')}</th><th>{t('Supplier')}</th><th>{t('Number on the paper')}</th><th className="num">{t('VAT')}</th><th>{t('Document')}</th><th>{t('Payment')}</th><th>{t('VAT status')}</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={8} text={t('No proforma VAT to review.')} />}
          {rows.map((r) => (
            <tr key={r.billId}>
              <td>{r.docDate}</td><td>{r.supplier}</td><td>{r.docNo}</td><td className="num">{formatSar(r.postedVat)}</td>
              <td>{t(DOC_LABEL[r.docStatus] ?? r.docStatus)}{r.attention ? ' ⚠' : ''}</td><td>{t(PAY_LABEL[r.paymentStatus] ?? r.paymentStatus)}</td><td>{t(VAT_LABEL[r.vatStatus] ?? r.vatStatus)}</td>
              <td><button type="button" aria-label={`open vat review ${r.docNo}`} onClick={() => show(r.billId)}>{t('Open')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <Detail key={`${open.billId}-${open.events.length}`} d={open} can={can} onChange={() => { show(open.billId); load(); }} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Detail({ d, can, onChange, onClose }: { d: VatReviewDetail; can: (p: string) => boolean; onChange: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const run = (p: Promise<unknown>) => void p.then(() => { setError(''); onChange(); }, (e: Error) => setError(t(e.message)));
  const decided = ['approved', 'claimed', 'not_claimed'].includes(d.vatStatus);
  return (
    <div role="region" aria-label="vat review detail" style={{ marginTop: 16 }}>
      <h4>{d.supplier} · {d.docNo} · {d.pinvNo}</h4>
      <p>{t('Document')}: <strong>{t(DOC_LABEL[d.docStatus] ?? d.docStatus)}</strong> · {t('Payment')}: <strong>{t(PAY_LABEL[d.paymentStatus] ?? d.paymentStatus)}</strong> ({formatSar(d.paid)} / {formatSar(d.gross)}) · {t('VAT status')}: <strong>{t(VAT_LABEL[d.vatStatus] ?? d.vatStatus)}</strong></p>
      {error && <p className="msg error">{error}</p>}
      <table className="list" aria-label="compare amounts">
        <thead><tr><th /><th className="num">{t('Net')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total')}</th></tr></thead>
        <tbody>
          <tr><td>{t('Proforma')}</td><td className="num">{formatSar(d.paper.net)}</td><td className="num">{formatSar(d.paper.vat)}</td><td className="num">{formatSar(d.paper.total)}</td></tr>
          {d.final && <tr><td>{t('Final invoice')} {d.final.invoiceNo} ({d.final.invoiceDate})</td><td className="num">{formatSar(d.final.net)}</td><td className="num">{formatSar(d.final.vat)}</td><td className="num">{formatSar(d.final.total)}</td></tr>}
          {d.compare && <tr><td><strong>{t('Difference')}</strong></td><td className="num">{signed(d.compare.netDiff)}</td><td className="num">{signed(d.compare.vatDiff)}</td><td className="num">{signed(d.compare.totalDiff)}</td></tr>}
        </tbody>
      </table>
      {d.discrepancies.map((x) => <p key={x.code} className="msg warn">{x.message}</p>)}
      {d.verifyNote && <p>{t('Note')}: {d.verifyNote}</p>}
      {d.accountantName && <p>{t('Accountant')}: {d.accountantName}{d.decisionRef ? ` · ${d.decisionRef}` : ''}{d.approvedVat !== null ? ` · ${formatSar(d.approvedVat)}` : ''}{d.decisionNote ? ` · ${d.decisionNote}` : ''}</p>}

      {can('vat.review') && !decided && <FinalForm d={d} run={run} />}
      {can('vat.review') && d.final && <Attach d={d} run={run} />}
      {can('vat.review') && d.docStatus === 'final_received' && <VerifyForm d={d} run={run} />}
      {can('vat.approve') && d.vatStatus === 'accountant_pending' && <DecideForm d={d} run={run} />}
      {can('vat.approve') && d.vatStatus === 'approved' && <ClaimForm d={d} run={run} />}
      {can('vat.approve') && (d.vatStatus === 'approved' || d.vatStatus === 'rejected') && <CloseForm d={d} run={run} />}
      {can('vat.approve') && d.vatStatus === 'claimed' && <ReverseForm d={d} run={run} />}

      {d.attachments.length > 0 && <p>{t('Attached')}: {d.attachments.map((a) => `${a.fileName} (${a.userName})`).join(', ')}</p>}
      <h4>{t('History')}</h4>
      <ul aria-label="vat review history">{d.events.map((e, i) => <li key={i}>{e.at.slice(0, 16).replace('T', ' ')} · {e.action} · {e.userName}</li>)}</ul>
      <button type="button" onClick={onClose}>{t('Close')}</button>
    </div>
  );
}

type FormProps = { d: VatReviewDetail; run: (p: Promise<unknown>) => void };

function FinalForm({ d, run }: FormProps) {
  const { t } = useI18n();
  const [f, setF] = useState({ no: d.final?.invoiceNo ?? '', date: d.final?.invoiceDate ?? today(), net: d.final ? formatSar(d.final.net) : '', vat: d.final ? formatSar(d.final.vat) : '', total: d.final ? formatSar(d.final.total) : '', vatNo: d.final?.supplierVatNo ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="bill-fields">
      <div><label>{t('Final invoice number')} <InfoIcon id="field.vat.finalNo" /></label><input aria-label="final invoice number" value={f.no} onChange={set('no')} /></div>
      <div><label>{t('Final invoice date')} <InfoIcon id="field.vat.finalDate" /></label><input aria-label="final invoice date" type="date" value={f.date} onChange={set('date')} /></div>
      <div><label>{t('Net')}</label><input aria-label="final net" value={f.net} onChange={set('net')} /></div>
      <div><label>{t('VAT')}</label><input aria-label="final vat" value={f.vat} onChange={set('vat')} /></div>
      <div><label>{t('Total')}</label><input aria-label="final total" value={f.total} onChange={set('total')} /></div>
      <div><label>{t('Supplier VAT number')}</label><input aria-label="final supplier vat number" maxLength={15} value={f.vatNo} onChange={set('vatNo')} /></div>
      <div><button type="button" className="primary" onClick={() => run(call('vat.recordFinal', { billId: d.billId, invoiceNo: f.no, invoiceDate: f.date, net: sar(f.net), vat: sar(f.vat), total: sar(f.total), supplierVatNo: f.vatNo || undefined }))}>{t('Save final invoice')}</button></div>
    </div>
  );
}

function Attach({ d, run }: FormProps) {
  const { t } = useI18n();
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) run(readBase64(file).then((dataBase64) => call('vat.attach', { billId: d.billId, fileName: file.name, mime: file.type, dataBase64 })));
    e.target.value = '';
  };
  return <p><label>{t('Attach a copy (PDF or photo, up to 5 MB)')}</label> <input aria-label="attach final invoice" type="file" accept="application/pdf,image/jpeg,image/png" onChange={pick} /></p>;
}

function VerifyForm({ d, run }: FormProps) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  return (
    <p className="row">
      <input aria-label="verify note" placeholder={t('Note, needed if there are differences')} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" onClick={() => run(call('vat.verify', { billId: d.billId, note: note || undefined }))}>{t('Mark details verified')}</button>
    </p>
  );
}

function DecideForm({ d, run }: FormProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(formatSar(d.maxClaim));
  const send = (decision: 'approve' | 'reject') => run(call('vat.decide', { billId: d.billId, decision, accountantName: name, reference: ref || undefined, note: note || undefined, approvedVat: decision === 'approve' ? sar(amount) : undefined }));
  return (
    <div className="bill-fields">
      <div><label>{t('Accountant name')} <InfoIcon id="field.vat.accountant" /></label><input aria-label="accountant name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label>{t('Reference')}</label><input aria-label="decision reference" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      <div><label>{t('Note')}</label><input aria-label="decision note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div><label>{t('VAT approved')} <InfoIcon id="field.vat.approved" /></label><input aria-label="approved vat" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="row"><button type="button" className="primary" onClick={() => send('approve')}>{t('Accountant approved')}</button><button type="button" onClick={() => send('reject')}>{t('Accountant refused')}</button></div>
    </div>
  );
}

function ClaimForm({ d, run }: FormProps) {
  const { t } = useI18n();
  const [date, setDate] = useState(today());
  const [requestKey] = useState(key);
  return (
    <p className="row">
      <input aria-label="claim date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="button" className="primary" onClick={() => run(call('vat.claim', { billId: d.billId, requestKey, claimDate: date }))}>{t('Claim VAT {0}', formatSar(d.approvedVat ?? 0))}</button>
    </p>
  );
}

function CloseForm({ d, run }: FormProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <p className="row">
      <input aria-label="not claimed reason" placeholder={t('Reason')} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" onClick={() => run(call('vat.notClaimed', { billId: d.billId, reason }))}>{t('Close as not claimed')}</button>
    </p>
  );
}

function ReverseForm({ d, run }: FormProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [requestKey] = useState(key);
  return (
    <p className="row">
      <input aria-label="reverse claim reason" placeholder={t('Reason')} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" onClick={() => run(call('vat.reverse', { billId: d.billId, reason, requestKey }))}>{t('Reverse claim')}</button>
    </p>
  );
}
