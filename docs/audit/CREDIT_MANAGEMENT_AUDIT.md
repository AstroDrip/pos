# Credit Management Audit (Phase 0)

Date: 2026-11-06. Code inspected: branch `feature/owner-tools` @ `4ac8ad4`; 183 tests passing before this work.

## 1. What already exists

| Area | Where | State |
|---|---|---|
| Customers | `customers` table (name, unique phone, VAT number); `services/parties.ts` create/find/history; Sell screen attaches a customer by phone | Identity only: no credit, terms, limit or notes |
| Sales | `sales` + `sale_lines` + `payments`; `services/sales.ts` | **Every sale must be fully paid.** Two database rules enforce it: `CHECK (paid_total - change_given = total_incl)` on `sales`, and `payments.tender IN ('cash','card')` |
| Refunds / credit notes | `services/refunds.ts` | Always pay cash out of the drawer (policy D1); no notion of an unpaid invoice |
| Suppliers | `suppliers` (payment terms days); `services/parties.ts` | Identity and terms |
| Purchase invoices | `services/purchasing.ts` (migration 9) | Matched to goods receipts, payable in 2000, due date from terms, returns, opening balances |
| Supplier payments | `supplier_payments` | Bank/till, partial, reversible, never more than owed. **No allocation to invoices:** ageing assumes oldest-first. No supplier advances. No "no due date" |
| Journal engine | `services/ledger.ts` `postEntry` | Balanced, one posting per source; reused for everything |
| Chart | Draft (provisional) | Has 2000 Accounts payable. **No Accounts receivable, customer advances, supplier advances or bad debts account** |
| Payments engine | Sale payments (cash/card), expense payments, supplier payments: three similar small patterns | Each is a table, an idempotency key, a journal entry and an optional shift link |
| Shift cash | `shiftSummary` | Expected cash = float + cash sales − change ± cash in/out − cash refunds − till expense payments − till supplier payments |
| Reports / dashboard | `financials.ts` `ownerKpis`, `dashboard-sync.ts` snapshots | No receivables or advances |
| Permissions | Roles admin / supervisor / cashier; backend checks | `customer.manage` is held by cashiers |
| Audit log | Hash-chained `audit_log` | Reused |
| Legacy (ZAT Pro) | Parity doc: credit limits, outstanding/ageing reports, "By Credit" in the day summary | Owner question Q-1 asked whether credit is used. **The owner now asks for it, so Q-1 = yes for customer credit** |

## 2. Partially implemented

- Supplier payables: everything except allocation, advances, "no due date" and pay-at-invoice.
- Customer identity: exists, but there is no financial profile.

## 3. Missing

- Customer credit sales (full or partial).
- Accounts receivable.
- Customer receipts with allocation, customer advances, write-offs.
- Customer statements and AR ageing.
- Credit limits and overrides.
- Refunds on unpaid invoices.
- Supplier payment allocation and supplier advances.
- "No due date" and informal supplier arrangements.
- A shared status presentation.
- Receivables in the dashboard.

## 4. Reused, not duplicated

- **One sale path:** `finalizeSale` stays the only way to create a sale. An unpaid portion is recorded as a third tender, `account` ("on account"), in the existing `payments` table. A credit sale is therefore an ordinary sale: same invoice numbering, stock, COGS, VAT, receipt, refunds and idempotency.
- **One journal engine:** every new document posts through `postEntry`.
- **One customer and one supplier table,** extended with new columns.
- **One refund path:** `createRefund` is extended so that a refund on an invoice that still has money owed reduces what the customer owes first, and only the rest is paid in cash.
- **Supplier payments:** the existing table and service are kept; allocation rows are added.
- **Status:** a single status function is used for customer invoices, supplier invoices and expenses, shown by one shared badge component.

## 5. Table extensions (migration 10)

| Table | Change | Why |
|---|---|---|
| `payments` | Rebuilt to allow tender `account` | SQLite cannot change a CHECK in place. All rows are copied. The table is a child only (nothing references it), so the rebuild is safe inside the migration transaction. The immutability triggers are recreated and the row count is checked |
| `customers` | Add `credit_enabled`, `credit_limit` (null = no fixed limit), `payment_terms_days` (null = no due date), `address`, `notes`, `updated_at` | Credit profile on the existing record |
| `purchase_invoices` | Add `no_due_date`, `arrangement_note` | Informal supplier credit; `due_date` is ignored when `no_due_date = 1` |

## 6. New tables (justified)

| Table | Purpose |
|---|---|
| `receivables` | One row per sale with an on-account amount: customer, amount, due date (or none), credit-limit override approver. Immutable |
| `customer_receipts` | A customer payment (cash/card/bank), idempotency key, shift link for cash and card. Reversal rows are negative, like supplier payments |
| `receipt_allocations` | Which invoice a receipt (or an earlier advance) settles, and how much. Immutable; reversals are negative rows |
| `customer_writeoffs` | Bad debt written off against an invoice: reason, approver |
| `refund_account_offsets` | The part of a refund that reduced the customer's debt instead of paying cash |
| `invoice_disputes` | Mark or clear a disputed invoice (audited) |
| `supplier_payment_allocations` | Which supplier invoice (or opening balance) a payment settles; unallocated = supplier advance |

## 7. Accounting integration (PROVISIONAL, accountant to approve)

New accounts:
- 1100 Accounts receivable (control);
- 2300 Customer advances (liability);
- 1310 Supplier advances (asset);
- 6910 Bad debts.

| Event | Entry |
|---|---|
| Sale, part or all on account | Today's sale entry with **Dr 1100** for the on-account part (the cash and card parts stay as today). Revenue and VAT are recognised once, at the sale |
| Customer receipt | Dr 1010 cash / 1020 card / 1030 bank; Cr 1100 for the allocated part; Cr 2300 for the unallocated part (advance) |
| Advance applied later | Dr 2300 / Cr 1100 |
| Refund on an invoice with money owed | Revenue/VAT/stock reversal as today; Cr 1100 for the part that reduces the debt, Cr 1010 only for the cash paid out |
| Write-off | Dr 6910 / Cr 1100 (needs `customer.writeoff`) |
| Supplier payment | Dr 2000 for the allocated part; Dr 1310 for the unallocated part (supplier advance) |
| Supplier advance applied later | Dr 2000 / Cr 1310 |

**Control checks (automated):**
- open customer invoice balances = 1100;
- unallocated customer receipts = 2300;
- open supplier items = 2000;
- unallocated supplier payments = 1310.

## 8. Risks and how they are handled

| Risk | Handling |
|---|---|
| A second payment engine | No new engine: the sale tender list gets `account`; receipts follow the same small pattern as the existing supplier and expense payments |
| Revenue counted twice | Receipts never touch revenue or VAT (tested) |
| `payments` table rebuild | Inside the migration transaction; row count checked before and after; pre-migration encrypted snapshot (existing) |
| Shift cash wrong | Cash and card collections link to the open shift; expected cash adds cash collections and subtracts only the cash part of refunds (tested) |
| Existing supplier payments have no allocations | Back-filled oldest-first, once, when the app opens after the migration. Recorded in the audit log |
| Status meanings drifting between screens | One status function plus one badge component |
| Refund of an unpaid credit invoice paying out cash | The refund first reduces the debt (owner approval needed, see §9) |

## 9. Decisions needing owner or accountant approval (safe defaults used)

| # | Decision | Default built |
|---|---|---|
| C-1 | Who may sell on credit? | Cashiers, within the customer's limit; going over the limit needs a supervisor PIN |
| C-2 | Who may collect customer payments? | Cashiers, into their open shift (cash/card); bank transfers are recorded by supervisor/owner |
| C-3 | Who sets limits and terms, reverses payments, writes off debts? | Owner (admin) only; write-off also needs a reason |
| C-4 | Refund on a credit invoice | Reduces what is owed first, then cash for any part already paid (extends refund policy D1) |
| C-5 | Payment allocation policy | Manual by default: the screen suggests oldest-first and shows the split before confirming |
| C-6 | New customer without terms | No due date (never shown as overdue) until terms are set |
| C-7 | Accounts 1100 / 2300 / 1310 / 6910 and the entries above | Provisional |
