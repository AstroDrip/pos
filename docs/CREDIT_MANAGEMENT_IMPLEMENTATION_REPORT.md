# Credit Management: Implementation Report

Date: 2026-11-06. Branch `feature/owner-tools`. Design and audit: `docs/audit/CREDIT_MANAGEMENT_AUDIT.md`.
Accounting is **PROVISIONAL** until the accountant approves (decision C-7).

## Features implemented

**Customer credit (accounts receivable):**
- **Credit at the till.** On the Sell screen, attach the customer by phone. The screen then shows what they owe now and what credit is still available (or "no fixed limit"), plus "paid now / on account".
  - **Credit (rest on account)** finalises the sale once, with the same idempotency key as any sale.
  - Going over the limit needs a supervisor name and PIN. The approver is stored on the receivable.
- **Receipts** print **Paid now**, **Remaining on account**, the customer and **PARTIALLY PAID / UNPAID**.
- **Customers tab.** Search by name, phone or ID. The account page shows:
  - owed now, overdue, advance held, limit, available credit, terms;
  - unpaid / partly paid counts, lifetime purchases and payments, last purchase and last payment;
  - notes;
  - credit invoices with total, paid, remaining, due date and a status badge;
  - filters: all / still owed / paid / partial / unpaid / overdue / due soon / no due date / disputed;
  - payment history;
  - the statement (debit, credit, running balance), which can be copied as CSV;
  - credit settings.
- **Receive a payment:**
  - enter the amount and the method (cash or card into the open shift; bank for supervisor/owner);
  - "Suggest: oldest first" fills the split, which the cashier can change before confirming;
  - anything not applied becomes an **advance**;
  - a payment receipt prints.
- **Advances** can be applied to invoices later. Payments can be reversed (owner). Invoices can be marked disputed and cleared. Debts can be written off (owner, with a reason).
- **Refunds on a credit invoice** reduce what is owed first; cash is paid only for what was already paid. A full refund cancels the invoice.
- **Receivables ageing:** not due / 1–30 / 31–60 / 61–90 / 90+ / **no due date**, plus advance, most overdue invoice and last payment.

**Supplier credit (accounts payable), built on the purchasing done earlier:**
- **Pay a supplier** with an explicit allocation per invoice or opening balance (oldest-first suggestion first).
  - An unallocated amount is refused unless "record the rest as an advance" is ticked.
  - Supplier advances (1310) can be applied later.
- **Pay at invoice entry** (fully or partly). **No due date** and an informal **arrangement note** ("collects at the next delivery").
- **Returns** take their credit off a chosen invoice (or the oldest).
- The supplier account shows owed, overdue, paid in advance, return credit, totals, and every invoice with total / paid / remaining / due / status.
- **Payment reversal** button in the purchase register.
- **Supplier ageing** now uses the allocations, with "no due date", advance and return-credit columns.
- **Existing supplier payments** made before this change are allocated oldest-first, once, when the app first opens. This matches how the old ageing worked, and it is recorded in the audit log.

**Status system:**
- `core/status.ts` gives one definition for customer invoices, supplier invoices and expenses.
- `StatusBadge` shows an icon, a word and a colour, with a legend.
- The colours are tokens defined for both light and dark mode.
- An overdue badge is stronger (thicker border, stronger red). An unpaid badge is muted. Paid always shows as paid.

**Dashboard:**
- The owner overview has a **Money position** block: cash and bank (books), customers owe the store, advances held for customers, the store owes suppliers, paid to suppliers in advance, plus collections and supplier payments in the period.
- It states that money owed is not cash.
- The same figures go into the phone dashboard's "position" snapshot. The phone service itself is still not built.

## Existing features reused (nothing duplicated)

- **One sale path:** `finalizeSale` gained a third tender, `account`.
- **One journal engine:** `postEntry`.
- **One customer table and one supplier table:** extended with new columns.
- **One refund path:** `createRefund` is extended.
- **Supplier payments:** the existing table and service are kept, with an allocation table added.
- **Shift reconciliation:** the existing `shiftSummary` is extended.
- **Hash-chained audit log, printer, permissions and IPC validation:** all reused.

## Database migration 10 (`src/db/migrations/010_credit.ts`)

- **`payments` rebuilt** to allow `account`. Every row is copied, the count and total are checked in SQL before the old table is dropped, and the immutability triggers are recreated. A test migrates a version-9 database that already has payments.
- **Columns added:**
  - `customers`: credit enabled, limit (null = no fixed limit), terms (null = no due date), address, notes;
  - `suppliers`: notes, address;
  - `purchase_invoices`: no-due-date, arrangement note.
- **New immutable tables:**
  - `receivables`;
  - `customer_receipts`;
  - `receipt_allocations`;
  - `customer_writeoffs`;
  - `refund_account_offsets`;
  - `invoice_disputes`;
  - `supplier_payment_allocations` (from a payment or a return).
- **Accounts added:** 1100, 1310, 2300, 6910.
- **Permissions added:** 8 `customer.*`.

## Accounting treatment (provisional)

| Event | Entry |
|---|---|
| Credit sale (part or all on account) | Sale entry as before, plus **Dr 1100** for the on-account part. Revenue and VAT once |
| Customer payment | Dr 1010 / 1020 / 1030; Cr 1100 (allocated); Cr 2300 (advance) |
| Advance applied | Dr 2300 / Cr 1100 |
| Refund on a credit invoice | Usual revenue/VAT/stock reversal; Cr 1100 for the debt reduced; Cr 1010 only for cash paid |
| Write-off | Dr 6910 / Cr 1100 |
| Supplier payment | Dr 2000 (allocated) + Dr 1310 (advance) / Cr 1030 or 1010 |
| Supplier advance applied | Dr 2000 / Cr 1310 |
| Reversals | Exact opposite, linked to the original; the original rows stay |

## Test results (run 2026-11-06, after the last code change)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run` | **19 files, 200 passed**, 0 failed (17 new tests in `credit.test.ts`; permission matrix +9 channels) |
| `npm run build` | exit 0 |
| `node e2e/smoke.mjs` | **29/29** (new step: owner enables credit → till sale 1.00 paid / 1.50 on account → receipt shows remaining → payment 1.50 allocated → owed 0.00 → dashboard owed 0.00) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Red-green check | The refund-reduces-debt rule was disabled on purpose: the edge-case test failed (1 failed / 16 passed); restored: 17/17 |

### Edge cases (prompt §18) covered by `credit.test.ts`

| Cases | Covered by |
|---|---|
| 1–3 | Paid, credit, partial |
| 4 | Instalments |
| 5–6 | Several invoices and one split payment |
| 7–8 | Overpayment = advance, then applied |
| 9–11 | Refunds after partial payment, partial return, full cancellation |
| 12–13 | Limit and override |
| 14–15 | Duplicate payment, reversal |
| 16–17 | No due date, overdue + partial, dispute, write-off |
| 18–20 | Supplier credit, instalments, multi-invoice payment |
| 21 | Supplier advance, applied and reversed |
| 22–24 | Returns, duplicate goods receipt refused, no-due-date ageing |
| 25 | Cashier refused |
| 26 | Failed payment saves nothing |
| 27 | Backup copy reopened with controls OK |
| 28 | Covered by the existing dashboard outbox tests (simulated server) |

**Not separately tested:** 23, cancelling or correcting a purchase invoice. There is no cancel function; corrections go through a return (debit note) and a new invoice.

## Reconciliation

Every test above checks:
- customer open invoices = 1100;
- customer advances = 2300;
- supplier open items − unused return credits = 2000;
- supplier advances = 1310;
- balanced journals and no stock drift.

All differences are 0.

## Known limitations

- **One payment method per customer payment** (no split cash + card in a single collection; record two payments).
- **No printed supplier payment voucher.** Statements can be copied as CSV but not printed, and supplier statements have no export.
- **Ageing buckets are fixed.** The due-soon window (7 days) is a setting with no screen yet.
- **"Disputed" exists for customer invoices only.**
- **The phone dashboard screen is not built.** The figures are in the snapshot; the hosting decision is still open.
- **Fixed during this work:** the credit-settings form pre-ticked "No fixed limit" for new customers. Enabling credit would have given unlimited credit. It now needs an explicit limit or an explicit tick.

## Decisions for the owner or accountant (defaults in use)

| # | Decision | Default |
|---|---|---|
| C-1 | Who can sell on credit | Cashiers, within the limit; a supervisor PIN to go over it |
| C-2 | Who collects payments | Cashiers (cash/card, into their shift); bank transfers supervisor/owner |
| C-3 | Who sets limits, reverses payments, writes off | Owner only; write-offs need a reason |
| C-4 | Refund on a credit invoice | Reduces the debt first, cash for the rest (extends refund policy D1) |
| C-5 | Payment allocation | Manual, with an oldest-first suggestion shown before confirming |
| C-6 | New customer terms | No due date until set |
| C-7 | Accounts 1100 / 1310 / 2300 / 6910 and the entries above | Provisional, accountant to approve |
