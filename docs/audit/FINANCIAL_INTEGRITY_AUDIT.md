# Financial Integrity Audit

Date: 2026-11-05. Scope: payments, tax, stock and accounting as built in Phase 1. Refunds and store credit do not exist yet; §4 gives the proposed design for approval.

## 1. Money and tax arithmetic: SOUND (tested)

- All amounts are **integer halalas**, quantities are integer milli-units, and rates are basis points. There is no floating point in money; a lint rule bans `Math.round` and `toFixed`.
- Rounding: half away from zero, implemented in integer arithmetic (`roundDiv`).
- VAT, given VAT-inclusive shelf prices:
  - VAT per rate = round(Σ line incl × r / (1 + r));
  - allocated to lines by largest remainder, so **line VAT always sums exactly to header VAT**;
  - checked by a property test over 5,000 random invoices and by DB CHECK constraints (`excl + vat = incl` on sales and lines).
- **Open item:** this rounding rule must be confirmed against the ZATCA XML business rules and SDK before the ZATCA phase. It is labelled provisional in the code.
- Discounts reduce the line before VAT. Revenue is posted net of discount, and the discount amount is kept on the sale (`total_discount`) for reporting.

## 2. Sale ↔ payment ↔ stock ↔ ledger consistency: SOUND (tested)

- One transaction writes the sale, lines (snapshotted names and prices), payments, stock movements, the journal entry and the audit row. Any failure rolls back everything, including the invoice number (tested with a forced negative-stock failure).
- Invariants tested after 300 random sales with injected retries:
  - every journal balances;
  - Σ debits = Σ credits;
  - revenue + VAT output = Σ sale totals;
  - book cash = net cash taken = shift cash sales;
  - stock balance = Σ movements;
  - invoice numbers unique and gapless.
- Payments: card ≤ total; change only from cash; `paid − change = total` is enforced by a CHECK constraint.
- Idempotency: the same bill key returns the same sale. Five presses = one payment (tested).
- A price change while in the basket now refuses the sale (BUG-001 fixed).

## 3. Postings (DRAFT chart of accounts; the accountant must approve)

| Event | Debit | Credit | Status |
|---|---|---|---|
| Sale | 1010 Cash (net of change), 1020 Card clearing, 5000 COGS | 4000 Sales (excl. VAT), 2200 VAT output, 1200 Inventory | Tested |
| Goods receipt | 1200 Inventory | 2100 Goods received not invoiced | Tested |
| Shift over/short | 1010 / 6000 | 6000 / 1010 | Tested |
| Cash in/out | 1010 / 2900 Suspense | 2900 / 1010 | Tested; the accountant reclassifies |
| Refund, credit note, store credit | — | — | **Not built** (§4) |
| Supplier invoice and payment, expenses, period close | — | — | Not built (Phase 3/4) |

Posted entries are immutable (triggers). Double posting is blocked by `UNIQUE(source_type, source_id)`.

## 4. Proposed refund / credit design (needs approval before building)

**Principles (from the audit prompt, adopted):**
- The original sale is never edited.
- A refund is a **new document linked to the original sale and lines**: a ZATCA credit note (simplified) once ZATCA exists.
- Refundable quantity per line = sold − already refunded, enforced inside one transaction with a CHECK and a recomputation on every refund, so a double refund is impossible. The single DB connection serialises two cashiers.
- The refund amount is computed from the **original snapshot price and discount**, never from today's price or anything the cashier types.
- Settlement can be split: cash out, card reversal (manual), or **store credit**.
- Store credit is a **liability** account (e.g. 2300 Customer credit), with its own ledger table: each issue or redemption is a row, and the balance is the sum. Redemption happens inside the sale transaction, so a balance can never go negative or be spent twice.
- **Scenario A** (return 40 → 20 cash + 20 credit → new sale 35 → pay 15) produces:
  1. the credit note for 40 (Dr Sales 34.78, Dr VAT 5.22, Cr Cash 20, Cr Customer credit 20);
  2. a new sale/invoice for 35, paid by credit 20 + cash 15 (Dr Customer credit 20, Dr Cash 15, Cr Sales 30.43, Cr VAT 4.57).

  Two separate linked documents, so every riyal is traceable.
- Stock: returned goods go back to stock or to a "damaged returns" reason, chosen by the cashier and audited.

**Decisions needed from the owner/accountant:**
1. Return period.
2. Receipt required? Exception approver?
3. Refund to the original tender only?
4. Offer store credit at all? Does it expire? Is a customer ID required?
5. Who approves refunds above an amount?
6. Treatment of opened or weighed goods.

## 5. Gaps that block real trading

| Gap | Why it blocks |
|---|---|
| No refunds or credit notes | A real store must be able to return goods and issue ZATCA credit notes |
| No ZATCA | Invoices are not legally valid tax invoices |
| Draft chart of accounts | Postings are mechanically correct but not yet the accountant's |
| No supplier invoices or payments | Payables cannot be reconciled |
