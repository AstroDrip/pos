import { useEffect, useRef, useState } from 'react';
import { formatQty, formatSar } from '../core/money';
import { ScanBuffer } from '../core/scan-buffer';
import type { DrawerCheck, LabelDiagnosis } from '../services/hardware';
import { call } from './api';
import { useI18n } from './i18n';

type PrinterRow = { name: string; isDefault: boolean };
type ScanRow = { code: string; ms: number; duplicate: boolean; result: LabelDiagnosis };

function Diagnosis({ d }: { d: LabelDiagnosis }) {
  const { t } = useI18n();
  const row = (l: string, v: string | number | null) => <tr><td>{t(l)}</td><td>{v === null || v === '' ? '—' : v}</td></tr>;
  return (
    <>
      <table className="list" aria-label="label diagnosis"><tbody>
        {row('Raw code', d.raw)}
        {row('Length', d.length)}
        {row('Read as', d.kind)}
        {row('Layout', d.layout)}
        {row('Item code', d.itemCode)}
        {row('PLU', d.plu)}
        {row('Weight in grams', d.weightGrams)}
        {row('Quantity', d.qty === null ? null : formatQty(d.qty, 3))}
        {row('Unit', d.unit)}
        {row('Product', d.product ? `${d.product.sku} ${d.product.name}` : null)}
        {row('Price', d.linePrice === null ? null : formatSar(d.linePrice))}
      </tbody></table>
      {d.errors.map((e) => <p key={e} className="msg error">{t(e)}</p>)}
    </>
  );
}

function ScannerTest() {
  const { t } = useI18n();
  const buffer = useRef(new ScanBuffer());
  const started = useRef<number | null>(null);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    started.current ??= e.timeStamp;
    const scan = buffer.current.key(e.key, e.timeStamp);
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const ms = Math.floor(e.timeStamp - (started.current ?? e.timeStamp));
    started.current = null;
    (e.target as HTMLInputElement).value = '';
    if (!scan) return setRows((r) => [{ code: t('Typed by hand, not a scanner burst'), ms, duplicate: false, result: null as never }, ...r].slice(0, 20));
    void call<LabelDiagnosis>('hw.label', { raw: scan.code }).then((result) => setRows((r) => [{ code: scan.code, ms, duplicate: scan.possibleDuplicate, result }, ...r].slice(0, 20)));
  };
  return (
    <div className="card section">
      <h4>{t('Barcode scanner')}</h4>
      <p className="hint">{t('Click the box and scan. Nothing is sold. Scan fast, scan the same item twice, and scan a code that is not in the shop.')}</p>
      <input aria-label="scanner test box" onKeyDown={onKey} autoComplete="off" />
      <table className="list" aria-label="scan log">
        <thead><tr><th>{t('Code')}</th><th className="num">{t('Time (ms)')}</th><th>{t('Result')}</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.code}</td><td className="num">{r.ms}</td><td>{r.duplicate ? `${t('Double read flagged')} · ` : ''}{r.result ? r.result.product?.name ?? r.result.errors.join(', ') : ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function LabelTest() {
  const { t } = useI18n();
  const [raw, setRaw] = useState('');
  const [d, setD] = useState<LabelDiagnosis | null>(null);
  const check = () => void call<LabelDiagnosis>('hw.label', { raw }).then(setD);
  return (
    <div className="card section">
      <h4>{t('Weighing label reader')}</h4>
      <p className="msg warn">{t('The real store label has not been tested yet. Scan one here before relying on a layout.')}</p>
      <div className="row"><input aria-label="label test box" value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} /><button disabled={!raw.trim()} onClick={check}>{t('Read label')}</button></div>
      {d && <Diagnosis d={d} />}
    </div>
  );
}

function PrinterTest() {
  const { t } = useI18n();
  const [printers, setPrinters] = useState<PrinterRow[] | null>(null);
  const [width, setWidth] = useState<58 | 80>(80);
  const [device, setDevice] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => void call<{ printers: PrinterRow[]; paperMm: 58 | 80 }>('hw.printers').then((r) => { setPrinters(r.printers); setWidth(r.paperMm); }, (e: Error) => setMsg({ kind: 'error', text: t(e.message) })), []);
  const changeWidth = (mm: 58 | 80) => { setWidth(mm); void call('hw.paper', { mm }); };
  const print = () => void call('hw.testReceipt', { device: device || undefined }).then(() => setMsg({ kind: 'ok', text: t('Sent to the printer. Check the slip for cut-off text and alignment.') }), (e: Error) => setMsg({ kind: 'error', text: t(e.message) }));
  return (
    <div className="card section">
      <h4>{t('Receipt printer')}</h4>
      {printers && printers.length === 0 && <p className="msg error">{t('Windows reports no printers.')}</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select aria-label="printer" value={device} onChange={(e) => setDevice(e.target.value)}>
          <option value="">{t('Windows default printer')}</option>
          {printers?.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' *' : ''}</option>)}
        </select>
        <select aria-label="paper width" value={width} onChange={(e) => changeWidth(Number(e.target.value) as 58 | 80)}><option value={80}>80 mm</option><option value={58}>58 mm</option></select>
        <button onClick={print}>{t('Print test receipt')}</button>
      </div>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}

function DrawerInfo() {
  const { t } = useI18n();
  const [d, setD] = useState<DrawerCheck | null>(null);
  useEffect(() => void call<DrawerCheck>('hw.drawer').then(setD, () => setD(null)), []);
  if (!d) return null;
  return (
    <div className="card section">
      <h4>{t('Cash drawer')}</h4>
      <p className="msg warn">{t('This app has no command that opens a drawer. A drawer wired to the printer usually opens through the Windows printer setting, on each print. Set that up and test it with the printer test above.')}</p>
      <table className="list" aria-label="cash check"><tbody>
        <tr><td>{t('Expected cash, open shift')}</td><td className="num">{d.openShift ? formatSar(d.openShift.expectedCash) : t('No open shift')}</td></tr>
        <tr><td>{t('Last closed shift: expected')}</td><td className="num">{d.lastClosed ? formatSar(d.lastClosed.expectedCash) : '—'}</td></tr>
        <tr><td>{t('Last closed shift: counted')}</td><td className="num">{d.lastClosed?.countedCash != null ? formatSar(d.lastClosed.countedCash) : '—'}</td></tr>
        <tr><td>{t('Cash records that do not add up')}</td><td className="num">{d.shiftCashProblems}</td></tr>
      </tbody></table>
    </div>
  );
}

/** Admin screen for checking devices. Nothing here sells anything or opens a drawer. */
export function HardwareTest() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="card section">
      <h3>{t('Hardware test')}</h3>
      <button onClick={() => setOpen(!open)}>{open ? t('Close') : t('Open hardware test')}</button>
      {open && <><ScannerTest /><LabelTest /><PrinterTest /><DrawerInfo /></>}
    </div>
  );
}
