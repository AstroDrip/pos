# Architecture Decisions

Each decision states its status. **PROVISIONAL** means it is safe to build on, but it needs the owner's or the accountant's confirmation.

## ADR-1 Themes
- The theme is set with an attribute on the page: `data-theme="light|dark"` on `<html>`. All colours come from semantic CSS variables in `styles.css`:
  - backgrounds: `--bg`, `--surface`, `--surface-2`;
  - text: `--text`, `--text-2`, `--muted`;
  - borders and focus: `--border`, `--focus`;
  - actions: `--primary` with `--on-primary`, `--danger`;
  - status colours, each with a matching background: `--success` / `--success-bg`, `--warning` / `--warning-bg`, `--error` / `--error-bg`;
  - `--disabled-opacity`.
- Components use these variables only; the theme work removes the hardcoded colours.
- The choice is `light | dark | system`. It is stored per till in `localStorage` (like the language). It is not tied to a user, so logging out keeps it.
  - `system` follows the Windows setting through `prefers-color-scheme`, and updates live when Windows changes.
- Changing theme only changes the attribute on the page. No React state changes, so an open bill is never touched.

## ADR-2 Keyboard checkout state machine
States:
- `search`: the search box has focus.
- `suggest`: the suggestion list is open.
- `qty`: the quantity box for a picked product has focus.
- `pay`: the payment panel has focus.

The checkout is always in exactly one state. The key map is in `renderer/checkout-keys.ts` as plain functions and is unit-tested.

- **Scanner fast path.** A scanner burst (unchanged `ScanBuffer`) adds the item straight away: qty per scan, or the weight from a scale label. There is no quantity step, which keeps scanning fast.
- **Typed code + Enter** (barcode, SKU, PLU) for a unit product goes to `qty` with 1 already filled in. A **suggestion picked with Enter** also goes to `qty`.
- **In `qty`:**
  - digits edit the number;
  - `+` adds 1;
  - Enter adds the line and returns to `search`;
  - Esc cancels.
  - Unit products need whole numbers.
  - Typing a weight for a weighed product stays blocked (owner decision Q-8 is undecided), so weighed goods still need a scale label.
- **In `search` with an empty box:**
  - `+` adds 1 to the last line added, if it is a unit product;
  - Enter with items on the bill opens `pay`.
- **In `pay`:**
  - Enter = cash: the amount typed, or exact if blank, plus any card part for a split;
  - Ctrl+Enter = card, for the full amount. It is refused while a split card amount is typed, because a split must go through the cash path;
  - Esc returns to `search`.
- **Guards against accidental sales:**
  - auto-repeat keys (`event.repeat`) are ignored;
  - Enter is ignored for 350 ms after the state changes;
  - the existing busy lock and the bill's idempotency key stay in place, so one bill can never be saved twice.
- **Card payments** are recorded by hand: the cashier confirms the bank terminal approved before pressing Ctrl+Enter. The screen says "card recorded"; the POS never claims it verified the terminal.
- There is a single global listener (the existing scanner one). The other keys are handled by the focused input's own handler, so normal typing is never taken over.

## ADR-3 Scale-label layout (PROVISIONAL, real label needed)
- The current fixed EAN-13 layout stays supported, so existing configurations keep working.
- New: a **field layout** for each label format, as an ordered list of fields with lengths:
  - `prefix` (literal digits);
  - `item`, `plu`, `weight` (with a unit: grams, or kilograms with N decimals), `price` (halalas), `pieces`;
  - `check` (EAN-13 check digit);
  - `ignore`.
- The total length must match the scanned code exactly.
- The product is matched by PLU when the layout has a `plu` field, otherwise by item code against PLUs (today's behaviour). If both are present they must point to the same product, otherwise the label is refused.
- **The owner's described order "item code + quantity + PLU" can be entered as a layout. The production layout is BLOCKED until a real label is decoded.**

## ADR-4 Expense accounting (PROVISIONAL, accountant approval needed)
- **The existing journal engine is reused.** Every posting goes through `postEntry` (balanced, one posting per source).
- New draft accounts are added; existing accounts are not changed:
  - 1030 Bank;
  - 1300 Prepaid expenses;
  - 1500 Equipment (capital purchases, no depreciation yet);
  - 2010 Accrued expenses payable (expenses owed to payees);
  - 61xx–69xx operating expense accounts.
- **Lifecycle:** `draft` → `posted` (approved) → payments → `paid`.
  - `cancelled` applies to drafts only.
  - `reversed` applies to posted expenses with nothing paid (after payments are reversed).
- **Posting (recognition), on the expense date:**
  - Dr the category's account for the net amount, plus any VAT that can't be recovered;
  - Dr 2210 for VAT that can be recovered;
  - Cr 2010 for the gross amount.
  - Prepaid (a service period longer than one month): Dr 1300 at posting, then each month Dr expense / Cr 1300 (at most once per month).
  - Capital category: Dr 1500 instead of an expense account.
- **Payment, on the payment date:** Dr 2010 / Cr 1030 Bank, or Cr 1010 Cash when paid from the till.
  - Till payments need an open shift and reduce that shift's expected cash.
  - Partial payments are allowed, up to the amount still owed.
- **"Paid immediately"** = post and pay in one transaction: two journal entries, and the 2010 account nets to zero.
- **Corrections** are reversal entries. Nothing posted is ever edited or deleted.
- **VAT class** for each expense: `standard`, `zero`, `exempt` or `out_of_scope`, plus a "recoverable" flag.
  - The VAT amount is **typed from the supplier invoice**, never assumed. A "15%" helper only suggests a figure.
  - Zero, exempt and out-of-scope expenses must have 0 VAT.
- **Recurring definitions** are not expenses. Generating them creates **draft** instances: at most one per definition per period (enforced by the database), never posted or paid automatically. Variable amounts (electricity) must have their actual amount entered before posting.
- **Overdue** is computed, not stored: posted, money still owed, and due date before today (Saudi day).

## ADR-5 Financial statements
- P&L, balance sheet and trial balance are read from **journal lines** (accrual basis, by journal date = Saudi business day).
  - Sales returns come from 4000 debits with source `refund`.
  - Discounts are shown for information only: they are already deducted inside the sales lines and are not deducted twice.
- "Net profit" is labelled **provisional** while the chart is a draft, and while expenses may not all be entered.
- Cash collected comes from payment records (cash basis) and is labelled as such.
- **One KPI service** (`services/financials.ts`) feeds both the desktop Accounting tab and the dashboard snapshots, so the two can't disagree.

## ADR-7 Tabs stay open; screen memory; audit detail; books check
- **Tabs stay mounted**, hidden, keyed by user. Hidden tabs take no keys or scans (`useTabActive`).
- **What survives a restart:** filters and places in `localStorage` per user; unfinished bills in SQLite (`bill_drafts`). PINs and approvers are never kept.
- **Audit records** carry their extra facts in `details_json` under `_m`, which is already hashed, so the chain and old rows are unaffected.
- **Books check** (`services/integrity.ts`) is read-only SQL over source documents. It does not call the functions that produce the figures. It reports and never corrects.

## ADR-6 Owner dashboard (local part built; remote part needs an owner decision)
- The POS stays the only system that writes data.
- **Snapshot instead of raw database access.** A reporting snapshot (daily KPIs, low stock, recent activity, sync health) is written to a **transactional outbox** table (`sync_outbox`) in the same SQLite file.
- **Sending.** A sender uploads pending rows through a transport interface (HTTPS + device token). A row is marked sent only when the server confirms its id.
  - Retries back off, and the outbox survives restarts.
  - Each snapshot is identified by `(kind, store_day, version)`, so a resend overwrites rather than duplicates.
- **The phone talks to the remote service only**, read-only, with login. It never reaches the POS PC, SQLite or IPC. The dashboard always shows "last synced at" and marks figures as stale after 30 minutes without a sync.
- **The remote service (hosting, domain, accounts, cost) is not built.** It needs the owner's choice. Until then the transport is a stub, and the tests use a fake transport, labelled simulated.
