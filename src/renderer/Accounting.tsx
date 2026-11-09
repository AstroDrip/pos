import { useEffect, useState } from 'react';
import { formatSar } from '../core/money';
import { storeDay } from '../core/store-time';
import type { CashFlow, BalanceSheet, OwnerKpis, ProfitAndLoss } from '../services/financials';
import type { VatSummary } from '../services/vat-report';
import { call } from './api';
import { InfoIcon } from './InfoIcon';
import { useRemembered, useReturnTick } from './TabHost';
import { validDay, validText } from './remember';
import { PageHeader } from './PageHeader';
import { useI18n } from './i18n';

const todayDay = () => storeDay(new Date().toISOString());
type Tb = { rows: { code: string; nameEn: string; nameAr: string; type: string; debit: number; credit: number }[]; totalDebit: number; totalCredit: number };
type Gl = { account: { code: string; nameEn: string }; opening: number; closing: number; lines: { date: string; source: string; sourceId: number; memo: string; debit: number; credit: number; balance: number }[] };

/** Owner overview and financial statements (ADR-5). Same service as the owner dashboard snapshots. */
const FLOW_LABEL: Record<CashFlow['groups'][number]['id'], string> = {
  sales: 'Sales', refunds: 'Refunds', customers: 'Customer payments', suppliers: 'Supplier payments', expenses: 'Expenses',
  cash_moves: 'Cash in and out', differences: 'Cash differences', other: 'Other',
};

export function Accounting() {
  const back = useReturnTick();
  const { t, lang } = useI18n();
  const [from, setFrom] = useRemembered('accounting', 'from', `${todayDay().slice(0, 7)}-01`, validDay);
  const [to, setTo] = useRemembered('accounting', 'to', todayDay(), validDay);
  const [k, setK] = useState<OwnerKpis | null>(null);
  const [pl, setPl] = useState<ProfitAndLoss | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [tb, setTb] = useState<Tb | null>(null);
  const [glCode, setGlCode] = useRemembered('accounting', 'account', '1010', validText);
  const [gl, setGl] = useState<Gl | null>(null);
  const [vat, setVat] = useState<VatSummary | null>(null);
  const [cf, setCf] = useState<CashFlow | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    const fail = (e: Error) => setError(t(e.message));
    call<OwnerKpis>('finance.kpis', { fromDay: from, toDay: to }).then(setK, fail);
    call<ProfitAndLoss>('finance.pl', { fromDay: from, toDay: to }).then(setPl, fail);
    call<BalanceSheet>('finance.bs', { asOf: to }).then(setBs, fail);
    call<Tb>('finance.tb', { fromDay: from, toDay: to }).then(setTb, fail);
    call<VatSummary>('finance.vat', { fromDay: from, toDay: to }).then(setVat, fail);
    call<CashFlow>('finance.cashflow', { fromDay: from, toDay: to }).then(setCf, fail);
  }, [from, to, back]);
  useEffect(() => void call<Gl>('finance.gl', { code: glCode, fromDay: from, toDay: to }).then(setGl, () => setGl(null)), [back, glCode, from, to]);

  const name = (a: { nameEn: string; nameAr: string }) => (lang === 'ar' ? a.nameAr : a.nameEn);
  const Line = ({ l, v, strong, neg, info }: { l: string; v: number; strong?: boolean; neg?: boolean; info?: string }) => (
    <tr><td>{strong ? <strong>{l}</strong> : l}{info && <InfoIcon id={info} />}</td><td className={`num${v < 0 ? ' neg' : ''}`}>{strong ? <strong>{neg ? '-' : ''}{formatSar(v)}</strong> : `${neg ? '-' : ''}${formatSar(v)}`}</td></tr>
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
            <Tile info="metric.salesIncl" l={t('Sales incl. VAT')} v={formatSar(k.salesInclVat)} />
            <Tile info="metric.refundsIncl" l={t('Refunds incl. VAT')} v={formatSar(k.refundsInclVat)} />
            <Tile info="metric.transactions" l={t('Transactions')} v={String(k.saleCount)} sub={k.averageBasket !== null ? t('Average basket {0}', formatSar(k.averageBasket)) : undefined} />
            <Tile info="metric.netSales" l={t('Net sales excl. VAT')} v={formatSar(k.netSales)} />
            <Tile info="metric.grossProfit" l={t('Gross profit')} v={formatSar(k.grossProfit)} />
            <Tile info="metric.operating" l={t('Operating expenses')} v={formatSar(k.operatingExpenses)} />
            <Tile info="metric.netProfit" l={t('Net profit (provisional)')} v={formatSar(k.netProfit)} bad={k.netProfit < 0} />
            <Tile info="metric.cashCollected" l={t('Cash collected (net)')} v={formatSar(k.cashCollected)} />
            <Tile info="metric.cardRecorded" l={t('Card recorded by cashiers')} v={formatSar(k.cardRecorded)} />
            <Tile info="metric.inventoryValue" l={t('Inventory value (at cost)')} v={formatSar(k.inventoryValue)} />
            <Tile info="metric.expensesOwed" l={t('Expenses still owed')} v={formatSar(k.expensesOutstanding)} />
            <Tile info="metric.lowStock" l={t('Products at/below reorder level')} v={String(k.lowStockCount)} />
          </div>
          <h4>{t('Money position (right now)')}</h4>
          <p className="hint">{t('Cash and bank is money the store has. Money customers owe is not cash until they pay; money owed to suppliers is not yet paid out.')}</p>
          <div className="kpis">
            <Tile info="metric.cashBank" l={t('Cash and bank (books)')} v={formatSar(k.cashAndBank)} />
            <Tile info="metric.receivables" l={t('Customers owe the store')} v={formatSar(k.receivablesOutstanding)} sub={t('{0} customers · overdue {1} · due soon {2}', k.customersWithBalance, formatSar(k.receivablesOverdue), formatSar(k.receivablesDueSoon))} />
            <Tile info="metric.customerAdvances" l={t('Advances held for customers')} v={formatSar(k.customerAdvances)} />
            <Tile info="metric.payables" l={t('Store owes suppliers')} v={formatSar(k.payablesOutstanding)} sub={t('{0} suppliers · overdue {1} · due soon {2}', k.suppliersWithBalance, formatSar(k.payablesOverdue), formatSar(k.payablesDueSoon))} />
            <Tile info="metric.supplierAdvances" l={t('Paid to suppliers in advance')} v={formatSar(k.supplierAdvances)} />
            <Tile info="metric.collections" l={t('Customer payments received (period)')} v={formatSar(k.collectionsInPeriod)} />
            <Tile info="metric.supplierPayments" l={t('Supplier payments made (period)')} v={formatSar(k.supplierPaymentsInPeriod)} />
          </div>
        </>
      )}

      {pl && (
        <>
          <h3>{t('Profit and loss')} <span className="tag">{t('accrual basis')}</span></h3>
          {pl.entryCount === 0 && <p className="msg warn">{t('No records for this period. The zeros below mean nothing was recorded.')}</p>}
          {pl.prepaidWaiting > 0 && <p className="msg warn">{t('Prepaid expenses of {0} are due but not recognised yet. Confirm them under Expenses.', formatSar(pl.prepaidWaiting))}</p>}
          <div className="msg warn">
            <strong>{t('Provisional figures')}</strong>
            <ul style={{ margin: 'var(--sp-1) 0 0' }}>{pl.provisionalReasons.map((r) => { const m = /^(\d+) draft/.exec(r); return <li key={r}>{m ? t('{0} draft expense(s) in this period are not posted yet', m[1]!) : t(r)}</li>; })}</ul>
          </div>
          <table className="list" style={{ maxWidth: 560 }}>
            <tbody>
              <Line info="metric.salesGross" l={t('Sales (excl. VAT)')} v={pl.salesGross} />
              <Line info="metric.returns" l={t('Less sales returns')} v={pl.returns} neg />
              <Line info="metric.netSales" l={t('Net sales')} v={pl.netSales} strong />
              <tr><td colSpan={2} className="hint">{t('Discounts given ({0}) are already deducted from sales.', formatSar(pl.discountsGiven))}</td></tr>
              <Line info="metric.cogs" l={t('Cost of goods sold')} v={pl.cogs} neg />
              <Line info="metric.grossProfit" l={t('Gross profit')} v={pl.grossProfit} strong />
              {pl.grossMarginBp !== null && <tr><td>{t('Gross margin')}</td><td className="num">{formatSar(pl.grossMarginBp)}%{/* basis points shown as a percentage with 2 decimals */}</td></tr>}
              {pl.operating.map((o) => <Line key={o.code} l={`${o.code} ${name(o)}`} v={o.amount} neg />)}
              <Line info="metric.operating" l={t('Total operating expenses')} v={pl.totalOperating} neg />
              <Line info="metric.netProfit" l={t('Net profit')} v={pl.netProfit} strong />
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
              <tr><td><strong>{t('Output VAT')} <InfoIcon id="metric.outputVat" /></strong></td><td /><td className="num"><strong>{formatSar(vat.outputVat)}</strong></td></tr>
              <tr><td>{t('Supplier invoices (recoverable VAT)')}</td><td className="num">{formatSar(vat.purchasesRecoverable.net)}</td><td className="num">{formatSar(vat.purchasesRecoverable.vat)}</td></tr>
              <tr><td>{t('Less returns to suppliers')}</td><td className="num">-{formatSar(vat.purchaseReturnsRecoverable.net)}</td><td className="num">-{formatSar(vat.purchaseReturnsRecoverable.vat)}</td></tr>
              <tr><td>{t('Expenses (recoverable VAT)')}</td><td className="num">{formatSar(vat.expensesRecoverable.net - vat.expensesReversedRecoverable.net)}</td><td className="num">{formatSar(vat.expensesRecoverable.vat - vat.expensesReversedRecoverable.vat)}</td></tr>
              <tr><td><strong>{t('Input VAT')} <InfoIcon id="metric.inputVat" /></strong></td><td /><td className="num"><strong>{formatSar(vat.inputVat)}</strong></td></tr>
              <tr><td><strong>{vat.netVatDue >= 0 ? t('Net VAT payable') : t('Net VAT refundable')}</strong> <InfoIcon id="metric.netVat" /></td><td /><td className="num"><strong>{formatSar(Math.abs(vat.netVatDue))}</strong></td></tr>
              {vat.supplierVatClaims !== 0 && <tr><td colSpan={3} className="hint">{t('Proforma VAT claimed this period (part of input VAT): {0}', formatSar(vat.supplierVatClaims))}</td></tr>}
              {vat.supplierVatPending !== 0 && <tr><td colSpan={3} className="hint">{t('Proforma VAT still under review (estimate, not input VAT): {0}', formatSar(vat.supplierVatPending))}</td></tr>}
              {vat.purchasesNonRecoverableVat !== 0 && <tr><td colSpan={3} className="hint">{t('VAT paid but not recoverable (treated as cost): {0}', formatSar(vat.purchasesNonRecoverableVat))}</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {cf && (
        <div className="card section" aria-label="cash flow">
          <h3>{t('Cash flow')}</h3>
          <p className="hint">{t('Money that actually moved in and out of cash and bank. This is not the same as profit: a sale on credit is profit before any money arrives.')}</p>
          <table className="list"><tbody>
            <Line info="metric.cashOpening" l={t('Cash and bank at the start')} v={cf.opening} strong />
            {cf.groups.filter((g) => g.amount !== 0).map((g) => <Line key={g.id} l={t(FLOW_LABEL[g.id])} v={g.amount} />)}
            <Line info="metric.cashNet" l={t('Net change')} v={cf.net} strong />
            <Line info="metric.cashClosing" l={t('Cash and bank at the end')} v={cf.closing} strong />
          </tbody></table>
        </div>
      )}
      {bs && (
        <>
          <h3>{t('Balance sheet as of {0}', bs.asOf)} {!bs.balanced && <span className="tag overdue">{t('NOT BALANCED')}</span>}</h3>
          <div className="row" style={{ alignItems: 'flex-start', maxWidth: 1000, flexWrap: 'wrap' }}>
            <table className="list"><tbody>
              <tr><th colSpan={2}>{t('Assets')}</th></tr>
              {bs.assets.map((a) => <Line key={a.code} l={`${a.code} ${name(a)}`} v={a.amount} />)}
              <Line info="metric.totalAssets" l={t('Total assets')} v={bs.totalAssets} strong />
            </tbody></table>
            <table className="list"><tbody>
              <tr><th colSpan={2}>{t('Liabilities')}</th></tr>
              {bs.liabilities.map((a) => <Line key={a.code} l={`${a.code} ${name(a)}`} v={a.amount} />)}
              <tr><th colSpan={2}>{t('Equity')}</th></tr>
              {bs.equity.map((a) => <Line key={a.code} l={`${a.code} ${name(a)}`} v={a.amount} />)}
              <Line l={t('Profit to date (not yet closed)')} v={bs.currentEarnings} />
              <Line info="metric.totalLE" l={t('Total liabilities and equity')} v={bs.totalLiabilitiesAndEquity} strong />
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

function Tile({ l, v, sub, bad, info }: { l: string; v: string; sub?: string; bad?: boolean; info?: string }) {
  return <div className="kpi"><div className="l">{l}{info && <InfoIcon id={info} />}</div><div className={`v${bad ? ' neg' : ''}`}>{v}</div>{sub && <div className="l">{sub}</div>}</div>;
}
