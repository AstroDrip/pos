# Reporting impact

Status: approved 2026-11-10 with defaults. Section 3 views built locally 2026-11-13 (Phase F). Accountant review still open.

## 1. Principle

An online order becomes a normal POS sale at handover. So most financial reports are already right once that sale exists. No separate reporting engine is built. Combined totals cannot double count, because an order is only counted through its one POS sale.

Channel comes from a join: `sales LEFT JOIN commerce_order_links`. No link means physical store.

## 2. Audit of existing reports

| Report | Code | Effect of online sales | Change |
|---|---|---|---|
| Sales summary | `reports.salesSummary` | Included. Tender split only knows cash and card | Add online tender row, channel filter |
| Top products | `Reports.tsx`, from `salesSummary` | Included | Add in-store and online columns |
| Cashier activity | `reports.cashierActivity` | Staff who hand over online orders would look like they rang those sales | Show online handovers separately |
| Sales series and list | `series.salesSeries`, `salesList` | Included. Payments listed by tender | Channel filter |
| Refunds | `reports.refundsReport` | Included once posted | Add tender and channel |
| Voids | `reports.voidsReport` | None | None |
| Adjustments | `reports.adjustmentsReport` | None | None |
| Stock on hand | `reports.stockOnHand` | On hand correct | Add reserved and available, labelled |
| Stock movements | `series.stockMovementLog` | Included as `sale` | Label order number |
| Purchases | `series.purchaseSeries` | None | None |
| Shift totals | `shifts.ts` | Filtered by tender, so online stays out of the drawer count | Show online handovers as information |
| Profit and loss, balance sheet, trial balance | `financials.ts` | Correct from the journal, if online posts to `1020` | Accountant review |
| KPIs, cash collected | `financials.periodKpis`, `ownerKpis` | `cardRecorded` uses tender `card` only, so online would be missing | Add online figure |
| Cash flow | `financials.cashFlowData` | Uses `1010`, `1020`, `1030` | None if `1020` is used |
| VAT | `vat-report.ts`, `vat-review.ts` | Included, from invoices | None. Accountant to confirm VAT date |
| Integrity | `integrity.ts` | `sale_payments`, `cash_sources` and `shift_cash` must allow `online` | Update and test |
| Customer balances | `credit.ts` | None. Online buyers are not POS customers | None |
| Demand scores | `demand.ts` | Online sales count as demand | Accept |
| Owner dashboard | `dashboard-sync.ts` | Sales included. `card` field is tender-based, so online would be missing from the split | Add a field in a later, separately approved change. Dashboard stays read-only |

## 3. New views, inside existing screens

| Need | Where |
|---|---|
| Physical vs online, delivery vs pickup, payment method | Sales filters in POS Reports |
| Product: units in store, units online, total, order count, revenue by channel, refunds by channel, availability | New Product performance view in Reports |
| Stock: on hand, reserved, available as separate columns | Stock report |
| Online cancellations, released reservations, discrepancies, sync delay, conflicts | Web admin Stock and sync page |
| Orders by status, unpaid, failed payments | Web admin |

Pending, rejected, cancelled or expired orders appear only in web admin operations views. They are never in POS sales or revenue.

## 4. Financial lifecycle

| Event | POS books | Web |
|---|---|---|
| Place Order | Nothing | Order, reservation |
| Authorised | Nothing | Payment `authorized` |
| Accepted and captured | Nothing in the first design | Payment `paid` |
| Handover, paid online | Sale. Dr `1020`, Cr `4000`, Cr `2200`, cost entries | Invoice number stored |
| Handover, pay at pickup | Sale, tender cash or card | Payment `paid` |
| Delivery fee | Service line on the same sale. Cr income, Cr VAT | |
| Rejected or cancelled before handover | Nothing | Void or refund |
| Refund after handover | Credit note, tender `online` | Refund recorded |
| Provider fee | Not recorded automatically. Entered from statement as an expense | Reference kept |

**For the accountant to rule on:**
1. Money captured at Accept and handed over later. As far as is known, receiving payment can set the VAT date. This was not confirmed against ZATCA. If so, either capture must move to handover, or an advance entry through account `2300` is needed.
2. Whether online money should sit in `1020` or its own account.
3. Which income account takes delivery fees.
4. How provider fees and net settlements are booked.
5. Cash on delivery, if enabled, since the driver holds the money after the sale.

## 5. ZATCA

| Finding | Effect |
|---|---|
| No ZATCA Phase 2 code exists yet | Online sales cannot go live until it does |
| Invoice numbers come only from `invoice_counters` | Web never creates an invoice number |
| Order confirmation | Not a tax invoice. Worded so |
| Scope is simplified B2C, EGS function `0100` | Online sales to consumers fit. A business buyer needing a standard invoice is out of scope |

| Event | Proposed result |
|---|---|
| Handover | Simplified tax invoice issued by the POS |
| Reporting | Through the future POS ZATCA queue, same as any sale |
| Refund after handover | Credit note linked to the invoice |
| Cancel before handover | No document |

Getting the invoice to an online customer, such as a printed copy with the delivery or a link, needs ZATCA and accountant review. Any ZATCA change is documented and tested separately. Nothing in this project alters ZATCA processing.

## 6. Tests

See `SECURITY_AND_TEST_PLAN.md` section 6. The key test: a day with shop sales, online sales and refunds gives a combined total equal to the sum of channels, and existing report numbers for shop-only days do not change.
