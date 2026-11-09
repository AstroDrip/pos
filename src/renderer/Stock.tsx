import { useEffect, useRef, useState } from 'react';
import { addDays, longDay, shortDay } from '../core/date-range';
import { formatMoney, formatQty, formatSar, parseQty, parseSar } from '../core/money';
import { storeDateTime, storeDay } from '../core/store-time';
import type { Product } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { AdjustmentRow, StockRow } from '../services/reports';
import type { MovementDay, MovementRow } from '../services/series';
import { call } from './api';
import { Chart } from './Chart';
import { DateNavigator, useDateRange } from './DateNavigator';
import { Kpi, Views } from './Figures';
import { InfoIcon } from './InfoIcon';
import { useRemembered, useReturnTick } from './TabHost';
import { validBool, validOneOf, validText } from './remember';
import { EmptyRow, PageHeader } from './PageHeader';
import { useSuggest } from './useSuggest';
import { HelpLink } from './HelpLink';
import { ProductName, useI18n } from './i18n';

interface GrnLine {
  product: Product;
  qty: string;
  cost: string;
}

const VIEWS = ['attention', 'all', 'movements', 'receive', 'wastage', 'count'] as const;
type View = (typeof VIEWS)[number];

export function Stock({ can }: { can: (p: string) => boolean }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(0);
  const [reference, setReference] = useState('');
  const [search, setSearch] = useRemembered('stock', 'search', '', validText);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [onlyLow, setOnlyLow] = useRemembered('stock', 'onlyLow', false, validBool);
  const [saving, setSaving] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const canSee = can('reports.view');
  const [view, setView] = useRemembered<View>('stock', 'view', canSee ? 'attention' : 'receive', validOneOf(VIEWS));
  const [find, setFind] = useState('');
  const [low, setLow] = useState<StockRow[]>([]);
  const [changes, setChanges] = useState<AdjustmentRow[]>([]);
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (!canSee) return;
    const to = storeDay(new Date().toISOString());
    void call<StockRow[]>('report.stock', { onlyLow: true }).then(setLow, () => setLow([]));
    void call<AdjustmentRow[]>('report.adjustments', { fromDay: addDays(to, -30), toDay: to }).then(setChanges, () => setChanges([]));
    if (can('finance.view')) void call<{ inventoryValue: number }>('finance.kpis', { fromDay: to, toDay: to }).then((k) => setValue(k.inventoryValue), () => setValue(null));
  }, [back, msg, canSee]);

  useEffect(() => void call<Supplier[]>('supplier.list').then(setSuppliers), [back]);
  useEffect(() => {
    if (can('reports.view')) void call<StockRow[]>('report.stock', { onlyLow }).then(setRows);
  }, [onlyLow, msg, can, back]);
  const { items: found } = useSuggest<Product>(search, (q) => call<Product[]>('catalog.search', { text: q }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        requestKey: requestKey.current,
        supplierId,
        reference: reference || undefined,
        lines: lines.map((l) => ({ productId: l.product.id, qty: parseQty(l.qty), unitCost: parseSar(l.cost) })),
      };
      const r = await call<{ grnNo: string }>('grn.create', payload);
      setMsg({ kind: 'ok', text: t('Received {0}', r.grnNo) });
      setLines([]);
      setReference('');
      requestKey.current = crypto.randomUUID(); // next delivery is a new receipt
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('Stock')} desc={t('Receive deliveries, record wastage, count the shelves.')} actions={<HelpLink article="stock-overview" />} />
      {canSee && <div style={{ maxWidth: 420, marginBottom: 'var(--sp-3)' }}><input data-kb-search="product" data-kb-suggest aria-label="find in stock" placeholder={t('Find a product in stock')} value={find} onChange={(e) => { setFind(e.target.value); if (e.target.value && view !== 'all') setView('all'); }} /></div>}
      <Views name="stock view" value={view} onChange={setView} options={[
        ...(canSee ? [{ id: 'attention' as const, label: t('Needs attention') }, { id: 'all' as const, label: t('Stock on hand') }, { id: 'movements' as const, label: t('Movements') }] : []),
        ...(can('stock.receive') ? [{ id: 'receive' as const, label: t('Receive goods') }] : []),
        ...(can('stock.adjust') ? [{ id: 'wastage' as const, label: t('Record wastage') }, { id: 'count' as const, label: t('Stock count') }] : []),
      ]} />
      {view === 'attention' && canSee && <Attention low={low} changes={changes} value={value} />}
      {view === 'movements' && canSee && <Movements tick={back} />}
      {/* These stay mounted while hidden, so half-entered lines survive moving between views. */}
      {can('stock.receive') && (
        <div className="card section" hidden={view !== 'receive'}>
          <h3>{t('Receive goods')}</h3>
          <label>{t('Supplier')} <InfoIcon id="field.grn.supplier" /></label>
          <select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            <option value={0}>{t('— choose —')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label>{t('Supplier invoice / delivery note no.')} <InfoIcon id="field.grn.reference" /></label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
          <label>{t('Add product')}</label>
          <input data-kb-search="product" data-kb-suggest placeholder={t('Search name or SKU')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.map((p) => (
            <button key={p.id} style={{ margin: 4 }} onClick={() => { setLines([...lines, { product: p, qty: '', cost: '' }]); setSearch(''); }}>
              {p.nameEn}
            </button>
          ))}
          <table className="list">
            <thead><tr><th>{t('Product')}</th><th>Qty ({'pcs / kg'})</th><th>{t('Unit cost excl. VAT')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.product.nameEn}</td>
                  <td><input value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td><input value={l.cost} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, cost: e.target.value } : x)))} /></td>
                  <td><button className="danger" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
          <p><button className="primary" disabled={saving || !supplierId || lines.length === 0} onClick={save}>{t('Save receipt')}</button></p>
        </div>
      )}
      {can('stock.adjust') && <div hidden={view !== 'wastage'}><AdjustCard kind="waste" onDone={() => setMsg(null)} /></div>}
      {can('stock.adjust') && <div hidden={view !== 'count'}><AdjustCard kind="count" onDone={() => setMsg(null)} /></div>}
      {view === 'all' && canSee && (
        <div>
          <label><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> {t('Only at or below reorder level')}</label>
          <table className="list" aria-label="stock on hand">
            <thead><tr><th>SKU</th><th>{t('Product')}</th><th className="num">{t('Qty')} <InfoIcon id="metric.stock.qty" /></th><th className="num">{t('Reorder at')} <InfoIcon id="metric.stock.reorder" /></th><th className="num">{t('Avg cost')} <InfoIcon id="metric.stock.cost" /></th></tr></thead>
            <tbody>
              {rows.length === 0 && <EmptyRow cols={5} text={onlyLow ? t('Nothing is at or below its reorder level.') : t('No products yet.')} />}
              {rows.filter((r) => !find.trim() || `${r.sku} ${r.nameEn} ${r.nameAr}`.toLowerCase().includes(find.trim().toLowerCase())).map((r) => (
                <tr key={r.productId}>
                  <td>{r.sku}</td><td><ProductName en={r.nameEn} ar={r.nameAr} /></td>
                  <td className={`num${r.qty < 0 ? ' neg' : ''}`}>{formatQty(r.qty, 0)}</td><td className="num">{formatQty(r.reorderLevel, 0)}</td><td className="num">{formatSar(r.avgCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const REASON: Record<string, string> = { sale: 'Sold', refund: 'Returned by customer', grn: 'Received', purchase_return: 'Returned to supplier', waste: 'Wastage', count_adj: 'Stock count' };

/** What needs a decision today. It only lists: every number comes from the stock report. */
function Attention({ low, changes, value }: { low: StockRow[]; changes: AdjustmentRow[]; value: number | null }) {
  const { t } = useI18n();
  const out = low.filter((r) => r.qty <= 0);
  const running = low.filter((r) => r.qty > 0);
  const list = (rows: StockRow[], empty: string, label: string) => (
    <table className="list" aria-label={label}>
      <thead><tr><th>{t('Product')}</th><th className="num">{t('Qty')}</th><th className="num">{t('Reorder at')}</th></tr></thead>
      <tbody>{rows.length === 0 && <EmptyRow cols={3} text={empty} />}{rows.slice(0, 50).map((r) => <tr key={r.productId}><td><ProductName en={r.nameEn} ar={r.nameAr} /></td><td className={`num${r.qty < 0 ? ' neg' : ''}`}>{formatQty(r.qty, 0)}</td><td className="num">{formatQty(r.reorderLevel, 0)}</td></tr>)}</tbody>
    </table>
  );
  return (
    <>
      <div className="kpis">
        <Kpi lead l={t('Out of stock')} v={String(out.length)} bad={out.length > 0} />
        <Kpi l={t('Running low')} v={String(running.length)} />
        <Kpi l={t('Wastage and count changes, 30 days')} v={String(changes.length)} />
        {value !== null && <Kpi info="metric.inventoryValue" l={t('Inventory value (at cost)')} v={formatMoney(value)} />}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 'var(--sp-3)' }}>
        <div style={{ flex: '1 1 320px' }}><h4 style={{ marginTop: 0 }}>{t('Out of stock')}</h4>{list(out, t('Nothing is out of stock.'), 'out of stock')}</div>
        <div style={{ flex: '1 1 320px' }}><h4 style={{ marginTop: 0 }}>{t('Running low')}</h4>{list(running, t('Nothing is running low.'), 'running low')}</div>
      </div>
      <h4>{t('Unusual changes in the last 30 days')}</h4>
      <table className="list" aria-label="unusual changes">
        <thead><tr><th>{t('Time')}</th><th>{t('Product')}</th><th>{t('Type')}</th><th>{t('Reason')}</th><th className="num">{t('Change')}</th><th className="num">{t('Value')}</th></tr></thead>
        <tbody>{changes.length === 0 && <EmptyRow cols={6} text={t('No wastage or count differences in these dates.')} />}{changes.slice(0, 15).map((a, i) => <tr key={i}><td>{storeDateTime(a.at)}</td><td>{a.nameEn}</td><td>{a.kind === 'waste' ? t('Wastage') : t('Stock count')}</td><td>{t(a.reason)}</td><td className="num">{formatQty(a.qty, 0)}</td><td className={`num${a.value < 0 ? ' neg' : ''}`}>{formatSar(a.value)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

/** Everything that moved stock, in time order, with the same dates driving the chart and the list. */
function Movements({ tick }: { tick: number }) {
  const { t } = useI18n();
  const [dates, setDates] = useDateRange('stock-movements', 'week');
  const [data, setData] = useState<{ days: MovementDay[]; rows: MovementRow[]; more: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); void call<{ days: MovementDay[]; rows: MovementRow[]; more: boolean }>('stock.movements', dates).then(setData, (e: Error) => setError(t(e.message))); }, [dates.from, dates.to, tick]);
  return (
    <>
      <DateNavigator name="Stock movements" value={dates} onChange={setDates} />
      {error && <p className="msg error">{error}</p>}
      {data && (
        <>
          <section className="chart-card" aria-label="stock movements chart">
            <div className="chart-head"><h4>{t('Records in and out')} <small>{t('Number of stock records each day')}</small></h4></div>
            <Chart name={t('Records in and out')} kind="bar" info="metric.chart.movements" axisFormat={(v) => String(v)} series={[{ name: t('Stock in'), format: String }, { name: t('Stock out'), format: String }]}
              points={data.days.map((d) => ({ key: d.day, axis: shortDay(d.day), title: longDay(d.day), values: [d.inLines, d.outLines] }))}
              onPick={(p) => setDates({ from: p.key, to: p.key })} />
          </section>
          <table className="list" aria-label="stock movements">
            <thead><tr><th>{t('Time')}</th><th>{t('Product')}</th><th>{t('What happened')}</th><th>{t('User')}</th><th className="num">{t('Change')}</th></tr></thead>
            <tbody>{data.rows.length === 0 && <EmptyRow cols={5} text={t('Nothing moved in these dates.')} />}{data.rows.map((m) => <tr key={m.id}><td>{storeDateTime(m.at)}</td><td>{m.sku} {m.nameEn}</td><td>{t(REASON[m.reason] ?? m.reason)}</td><td>{m.user}</td><td className={`num${m.qty < 0 ? ' neg' : ''}`}>{formatQty(m.qty, 0)}</td></tr>)}</tbody>
          </table>
          {data.more && <p className="hint">{t('Showing the newest 300. Choose fewer dates to see the rest.')}</p>}
        </>
      )}
    </>
  );
}

const WASTE_REASONS = ['Expired', 'Damaged', 'Spoiled', 'Other'] as const;

interface AdjLine {
  product: Product;
  qty: string;
}

/**
 * Wastage (goods thrown away) or a stock count (stock set to what is on the shelf). The count is blind:
 * the counter does not see the system quantity, so they count what is really there.
 */
function AdjustCard({ kind, onDone }: { kind: 'waste' | 'count'; onDone: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<AdjLine[]>([]);
  const [reason, setReason] = useState(kind === 'waste' ? 'Expired' : '');
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const requestKey = useRef(crypto.randomUUID());

  const { items: found } = useSuggest<Product>(search, (q) => call<Product[]>('catalog.search', { text: q }));

  const reasonText = kind === 'waste' && reason === 'Other' ? other.trim() : reason.trim();

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const parsed = lines.map((l) => ({ productId: l.product.id, q: parseQty(l.qty) }));
      const r = await call<{ adjNo: string | null; changedLines: number; totalValue: number }>(
        kind === 'waste' ? 'stock.waste' : 'stock.count',
        kind === 'waste'
          ? { requestKey: requestKey.current, reason: reasonText, lines: parsed.map((l) => ({ productId: l.productId, qty: l.q })) }
          : { requestKey: requestKey.current, reason: reasonText, lines: parsed.map((l) => ({ productId: l.productId, countedQty: l.q })) },
      );
      setMsg({
        kind: 'ok',
        text: r.adjNo
          ? t('{0} saved: {1} products changed, value {2}', r.adjNo, r.changedLines, formatSar(r.totalValue))
          : t('Count matches the system: nothing changed'),
      });
      setLines([]);
      requestKey.current = crypto.randomUUID();
      onDone();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card section">
      <h3>{kind === 'waste' ? t('Record wastage') : t('Stock count')}</h3>
      {kind === 'count' && <p style={{ opacity: 0.8 }}>{t('Count when the shop is closed. Enter what is on the shelf; stock is set to it.')}</p>}
      <label>{t('Reason')} <InfoIcon id="field.stock.reason" /></label>
      {kind === 'waste' ? (
        <>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {WASTE_REASONS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
          </select>
          {reason === 'Other' && <input placeholder={t('Describe the reason')} value={other} onChange={(e) => setOther(e.target.value)} />}
        </>
      ) : (
        <input placeholder={t('e.g. Monthly count, aisle 3')} value={reason} onChange={(e) => setReason(e.target.value)} />
      )}
      <label>{t('Add product')}</label>
      <input data-kb-search="product" data-kb-suggest placeholder={t('Search name or SKU')} aria-label={`${kind} product search`} value={search} onChange={(e) => setSearch(e.target.value)} />
      {found.map((p) => (
        <button key={p.id} style={{ margin: 4 }} onClick={() => { if (!lines.some((l) => l.product.id === p.id)) setLines([...lines, { product: p, qty: '' }]); setSearch(''); }}>
          {p.nameEn}
        </button>
      ))}
      <table className="list">
        <thead><tr><th>{t('Product')}</th><th>{kind === 'waste' ? t('Qty thrown away') : t('Counted qty')} (pcs / kg)</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.product.id}>
              <td><ProductName en={l.product.nameEn} ar={l.product.nameAr} /></td>
              <td><input aria-label={`${kind} qty ${i + 1}`} value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td>
              <td><button className="danger" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p><button className="primary" disabled={saving || lines.length === 0 || !reasonText || lines.some((l) => !l.qty.trim())} onClick={save}>{kind === 'waste' ? t('Save wastage') : t('Post count')}</button></p>
    </div>
  );
}
