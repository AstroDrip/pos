# Where every dashboard figure comes from

The dashboard does no accounting of its own. The till works out each figure with the same services as its own reports, and sends the results. The dashboard only adds days together.

All amounts are integer halalas. Days are Saudi business days. The figures are provisional until an accountant approves the setup.

| Figure | Source on the till | Over a period |
|---|---|---|
| Sales, including VAT | `ownerKpis.salesInclVat` (`sales.total_incl`) | Sum of days |
| Transactions | `ownerKpis.saleCount` | Sum of days |
| Average sale | Sales ÷ transactions | Worked from the two sums. Blank if there were no sales |
| Revenue (net sales) | `profitAndLoss.netSales` (account 4000) | Sum of days |
| Returns | `profitAndLoss.returns` | Sum of days |
| Discounts | `profitAndLoss.discountsGiven` | Sum of days |
| Cost of goods sold | `profitAndLoss.cogs` (account 5000) | Sum of days |
| Gross profit | `profitAndLoss` | Sum of days |
| Expenses | `profitAndLoss.totalOperating` | Sum of days |
| Net operating result | `profitAndLoss.netProfit`. Provisional | Sum of days |
| Cash sales | `ownerKpis.cashCollected`: cash tendered − change − refunds | Sum of days |
| Card sales | `ownerKpis.cardRecorded`. As recorded by cashiers, not checked with the bank | Sum of days |
| Credit sales | `payments` with tender `account` | Sum of days |
| Credit purchases | Supplier invoice gross less what was paid at the time | Sum of days |
| Expenses by type | `profitAndLoss.operating` | Sum of days per account |
| By category, by product | `sale_lines`, excluding VAT, before returns | Sum of days |
| Stock value | Balance of account 1200, at average cost | Right now only |
| Customers owe the store | Open credit invoices | Right now only |
| Store owes suppliers | Open items less unused return credits | Right now only |
| Ageing | Same open items, by due date | Right now only |
| Low and out of stock | `stock_balances` against `reorder_level` | Right now only |

## Missing is not zero

- The till sends a record for every day from its first accounting entry onward. A day it sent with no sales is a real SAR 0.00.
- A day it never sent has no record. It shows as **Not available**, and a notice says how many days are missing.
- A period with some days missing adds up the days received and says so.

## Do the figures match?

Each upload includes the till's own totals for the last 35 days. **More → Till connection** compares those with the daily figures added up on the dashboard, and says whether they agree. Tests prove the same on the demo data.
