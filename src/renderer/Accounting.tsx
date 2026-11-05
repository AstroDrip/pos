import { useEffect, useState } from 'react';
import { formatSar } from '../core/money';
import { storeDay } from '../core/store-time';
import type { BalanceSheet, OwnerKpis, ProfitAndLoss } from '../services/financials';
import type { VatSummary } from '../services/vat-report';
import { call } from './api';
import { PageHeader } from './PageHeader';
import { useI18n } from './i18n';

const todayDay = () => storeDay(new Date().toISOString());
type Tb = { rows: { code: string; nameEn: string; nameAr: string; type: string; debit: number; credit: number }[]; totalDebit: number; totalCredit: number };
type Gl = { account: { code: string; nameEn: string }; opening: number; closing: number; lines: { date: string; source: string; sourceId: number; memo: string; debit: number; credit: number; balance: number }[] };

/** Owner overview and financial statements (ADR-5). Same service as the owner dashboard snapshots. */
export function Accounting() {
  const { t, lang } = useI18n();
  const [from, setFrom] = useState(`${todayDay().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayDay());
  const [k, setK] = useState<OwnerKpis | null>(null);
  const [pl, setPl] = useState<ProfitAndLoss | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [tb, setTb] = useState<Tb | null>(null);
  const [glCode, setGlCode] = useState('1010');
  const [gl, setGl] = useState<Gl | null>(null);
  const [vat, setVat] = useState<VatSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    const fail = (e: Error) => setError(t(e.message));
    call<OwnerKpis>('finance.kpis', { fromDay: from, toDay: to }).then(setK, fail);
    call<ProfitAndLoss>('finance.pl', { fromDay: from, toDay: to }).then(setPl, fail);
    call<BalanceSheet>('finance.bs', { asOf: to }).then(setBs, fail);
    call<Tb>('finance.tb', { fromDay: from, toDay: to }).then(setTb, fail);
    call<VatSummary>('finance.vat', { fromDay: from, toDay: to }).then(setVat, fail);
  }, [from, to]);
  useEffect(() => void call<Gl>('finance.gl', { code: glCode, fromDay: from, toDay: to }).then(setGl, () => setGl(null)), [glCode, from, to]);

  const name = (a: { nameEn: string; nameAr: string }) => (lang === 'ar' ? a.nameAr : a.nameEn);
  const Line = ({ l, v, strong, neg }: { l: string; v: number; strong?: boolean; neg?: boolean }) => (
    <tr><td>{strong ? <strong>{l}</strong> : l}</td><td className={`num${v < 0 ? ' neg' : ''}`}>{strong ? <strong>{neg ? '-' : ''}{formatSar(v)}</strong> : `${neg ? '-' : ''}${formatSar(v)}`}</td></tr>
  );

  return (
    <div className="page">
      <PageHeader title={t('Accounting')} desc={t('Owner overview, profit and loss, balance sheet and ledgers (provisional until the accountant approves).')} />
      <div className="row" style={{ maxWidth: 420 }}>
        <div><label>{t('From')}</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>{t('To')}</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {error && <p className="msg error">{error}</p>}

      {k && (
        <>
          <h3>{t('Owner overview')}</h3>
          <div className="kpis">
            <Tile l={t('Sales incl. VAT')} v={formatSar(k.salesInclVat)} />
            <Tile l={t('Refunds incl. VAT')} v={formatSar(k.refundsInclVat)} />
            <Tile l={t('Transactions')} v={String(k.saleCount)} sub={k.averageBasket !== null ? t('Average basket {0}', formatSar(k.averageBasket)) : undefined} />
            <Tile l={t('Net sales excl. VAT')} v={formatSar(k.netSales)} />
            <Tile l={t('Gross profit')} v={formatSar(k.grossProfit)} />
            <Tile l={t('Operating expenses')} v={formatSar(k.operatingExpenses)} />
            <Tile l={t('Net profit (provisional)')} v={formatSar(k.netProfit)} bad={k.netProfit < 0} />
            <Tile l={t('Cash collected (net)')} v={formatSar(k.cashCollected)} />
            <Tile l={t('Card recorded by cashiers')} v={formatSar(k.cardRecorded)} />
            <Tile l={t('Inventory value (at cost)')} v={formatSar(k.inventoryValue)} />
            <Tile l={t('Expenses still owed')} v={formatSar(k.expensesOutstanding)} />
            <Tile l={t('Products at/below reorder level')} v={String(k.lowStockCount)} />
          </div>
          <h4>{t('Money position (right now)')}</h4>
          <p className="hint">{t('Cash and bank is money the store has. Money customers owe is not cash until they pay; money owed to suppliers is not yet paid out.')}</p>
          <div className="kpis">
            <Tile l={t('Cash and bank (books)')} v={formatSar(k.cashAndBank)} />
            <Tile l={t('Customers owe the store')} v={formatSar(k.receivablesOutstanding)} sub={t('{0} customers · overdue {1} · due soon {2}', k.customersWithBalance, formatSar(k.receivablesOverdue), formatSar(k.receivablesDueSoon))} />
            <Tile l={t('Advances held for customers')} v={formatSar(k.customerAdvances)} />
            <Tile l={t('Store owes suppliers')} v={formatSar(k.payablesOutstanding)} sub={t('{0} suppliers · overdue {1} · due soon {2}', k.suppliersWithBalance, formatSar(k.payablesOverdue), formatSar(k.payablesDueSoon))} />
            <Tile l={t('Paid to suppliers in advance')} v={formatSar(k.supplierAdvances)} />
            <Tile l={t('Customer payments received (period)')} v={formatSar(k.collectionsInPeriod)} />
            <Tile l={t('Supplier payments made (period)')} v={formatSar(k.supplierPaymentsInPeriod)} />
          </div>
        </>
      )}

      {pl && (
        <>
          <h3>{t('Profit and loss')} <span className="tag">{t('accrual basis')}</span></h3>
          <div className="msg warn">
            <strong>{t('Provisional figures')}</strong>
            <ul style={{ margin: 'var(--sp-1) 0 0' }}>{pl.provisionalReasons.map((r) => { const m = /^(\d+) draft/.exec(r); return <li key={r}>{m ? t('{0} draft expense(s) in this period are not posted yet', m[1]!) : t(r)}</li>; })}</ul>
          </div>
          <table className="list" style={{ maxWidth: 560 }}>
            <tbody>
              <Line l={t('Sales (excl. VAT)')} v={pl.salesGross} />
              <Line l={t('Less sales returns')} v={pl.returns} neg />
              <Line l={t('Net sales')} v={pl.netSales} strong />
              <tr><td colSpan={2} className="hint">{t('Discounts given ({0}) are already deducted from sales.', formatSar(pl.discountsGiven))}</td></tr>
              <Line l={t('Cost of goods sold')} v={pl.cogs} neg />
              <Line l={t('Gross profit')} v={pl.grossProfit} strong />
              {pl.grossMarginBp !== null && <tr><td>{t('Gross margin')}</td><td className="num">{formatSar(pl.grossMarginBp)}%{/* basis points shown as a percentage with 2 decimals */}</td></tr>}
              {pl.operating.map((o) => <Line key={o.code} l={`${o.code} ${name(o)}`} v={o.amount} neg />)}
              <Line l={t('Total operating expenses')} v={pl.totalOperating} neg />
              <Line l={t('Net profit')} v={pl.netProfit} strong />
              <tr><td colSpan={2} className="hint">{t('VAT is not income or cost: output VAT {0}, recoverable input VAT {1}.', formatSar(pl.outputVat), formatSar(pl.inputVat))}</td></tr>
            </tbody>
          </table>
        </>
      )}

      {vat && (
        <>
          <h3>{t('VAT summary')} {vat.reconciles ? <span className="tag paid">{t('matches the VAT accounts')}</span> : <span className="tag overdue">{t('DOES NOT match the VAT accounts')}</span>}</h3>
          <p className="msg warn">{t('A working summary for your accountant, not the official VAT return. 0% sales cannot be split into zero-rated and exempt.')}</p>
          <table className="list" style={{ maxWidth: 640 }}>
            <thead><tr><th /><th className="num">{t('Net')}</th><th className="num">{t('VAT')}</th></tr></thead>
            <tbody>
              <tr><td>{t('Sales at 15%')}</td><td className="num">{formatSar(vat.salesStandard.net)}</td><td className="num">{formatSar(vat.salesStandard.vat)}</td></tr>
              <tr><td>{t('Less refunds at 15%')}</td><td className="num">-{formatSar(vat.refundsStandard.net)}</td><td className="num">-{formatSar(vat.refundsStandard.vat)}</td></tr>
              <tr><td>{t('Sales at 0% (zero-rated or exempt)')}</td><td className="num">{formatSar(vat.salesZeroOrExempt.net - vat.refundsZeroOrExempt.net)}</td><td className="num">0.00</td></tr>
              <tr><td><strong>{t('Output VAT')}</strong></td><td /><td className="num"><strong>{formatSar(vat.outputVat)}</strong></td></tr>
              <tr><td>{t('Supplier invoices (recoverable VAT)')}</td><td className="num">{formatSar(vat.purchasesRecoverable.net)}</td><td className="num">{formatSar(vat.purchasesRecoverable.vat)}</td></tr>
              <tr><td>{t('Less returns to suppliers')}</td><td className="num">-{formatSar(vat.purchaseReturnsRecoverable.net)}</td><td className="num">-{formatSar(vat.purchaseReturnsRecoverable.vat)}</td></tr>
              <tr><td>{t('Expenses (recoverable VAT)')}</td><td className="num">{formatSar(vat.expensesRecoverable.net - vat.expensesReversedRecoverable.net)}</td><td className="num">{formatSar(vat.expensesRecoverable.vat - vat.expensesReversedRecoverable.vat)}</td></tr>
              <tr><td><strong>{t('Input VAT')}</strong></td><td /><td className="num"><strong>{formatSar(vat.inputVat)}</strong></td></tr>
              <tr><td><strong>{vat.netVatDue >= 0 ? t('Net VAT payable') : t('Net VAT refundable')}</strong></td><td /><td className="num"><strong>{formatSar(Math.abs(vat.netVatDue))}</strong></td></tr>
              {vat.purchasesNonRecoverableVat !== 0 && <tr><td colSpan={3} className="hint">{t('VAT paid but not recoverable (treated as cost): {0}', formatSar(vat.purchasesNonRecoverableVat))}</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {bs && (
        <>
          <h3>{t('Balance sheet as of {0}', bs.asOf)} {!bs.balanced && <span className="tag overdue">{t('NOT BALANCED')}</span>}</h3>
          <div className="row" style={{ alignItems: 'flex-start', maxWidth: 1000, flexWrap: 'wrap' }}>
            <table className="list"><tbody>
              <tr><th colSpan={2}>{t('Assets')}</th></tr>
              {bs.assets.map((a) => <Line key={a.code} l={`${a.code} ${name(a)}`} v={a.amount} />)}
              <Line l={t('Total assets')} v={bs.totalAssets} strong />
            </tbody></table>
            <table className="list"><tbody>
              <tr><th colSpan={2}>{t('Liabilities')}</th></tr>
              {bs.liabilities.map((a) => <Line key={a.code} l={`${a.code} ${name(a)}`} v={a.amount} />)}
              <tr><th colSpan={2}>{t('Equity')}</th></tr>
              {bs.equity.map((a) => <Line key={a.code} l={`${a.code} ${name(a)}`} v={a.amount} />)}
              <Line l={t('Profit to date (not yet closed)')} v={bs.currentEarnings} />
              <Line l={t('Total liabilities and equity')} v={bs.totalLiabilitiesAndEquity} strong />
            </tbody></table>
          </div>
        </>
      )}

      {tb && (
        <>
          <h3>{t('Trial balance')} {tb.totalDebit === tb.totalCredit ? <span className="tag paid">{t('balanced')}</span> : <span className="tag overdue">{t('NOT BALANCED')}</span>}</h3>
          <table className="list" style={{ maxWidth: 760 }}>
            <thead><tr><th>{t('Account')}</th><th className="num">{t('Debit')}</th><th className="num">{t('Credit')}</th></tr></thead>
            <tbody>
              {tb.rows.map((r) => <tr key={r.code} style={{ cursor: 'pointer' }} onClick={() => setGlCode(r.code)}><td>{r.code} {name(r)}</td><td className="num">{formatSar(r.debit)}</td><td className="num">{formatSar(r.credit)}</td></tr>)}
              <tr><td><strong>{t('Total')}</strong></td><td className="num"><strong>{formatSar(tb.totalDebit)}</strong></td><td className="num"><strong>{formatSar(tb.totalCredit)}</strong></td></tr>
            </tbody>
          </table>
        </>
      )}

      {gl && (
        <>
          <h3>{t('General ledger')}: {gl.account.code} {gl.account.nameEn}</h3>
          <table className="list">
            <thead><tr><th>{t('Date')}</th><th>{t('Source')}</th><th>{t('Memo')}</th><th className="num">{t('Debit')}</th><th className="num">{t('Credit')}</th><th className="num">{t('Balance')}</th></tr></thead>
            <tbody>
              <tr><td colSpan={5}>{t('Opening balance')}</td><td className="num">{formatSar(gl.opening)}</td></tr>
              {gl.lines.map((l, i) => <tr key={i}><td>{l.date}</td><td>{l.source} #{l.sourceId}</td><td>{l.memo}</td><td className="num">{l.debit ? formatSar(l.debit) : ''}</td><td className="num">{l.credit ? formatSar(l.credit) : ''}</td><td className="num">{formatSar(l.balance)}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Tile({ l, v, sub, bad }: { l: string; v: string; sub?: string; bad?: boolean }) {
  return <div className="kpi"><div className="l">{l}</div><div className={`v${bad ? ' neg' : ''}`}>{v}</div>{sub && <div className="l">{sub}</div>}</div>;
}
