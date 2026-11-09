# Phone Dashboard: Design

**Date:** 2026-11-09. **Status:** replaced. The owner's later brief changed the design: the till now sends its own figures, so the dashboard does no accounting of its own, and the till sends data through a device API. See `docs/CLOUD_BACKUP_AND_SYNC.md` and `dashboard/METRICS.md`. Kept for history.
**Decisions already made:** [assessment](2026-11-09-master-prompts-assessment.md), sections 7 and 10.

## 1. What this is

A demonstration the owner can open on a phone, to see a shop's sales, stock and finances for any period. It runs on Vercel, reading a separate Neon database of made-up data. It is not connected to any real shop.

**The owner's rule:** the phone only shows. It cannot add a bill, change stock, take a payment or edit anything.

**Success means:**

- It is usable on a phone, not a shrunken desktop page.
- Every figure comes from the demo records, and tests prove it equals what the POS itself works out from the same records.
- Nothing about the database is exposed to the browser.
- A write attempt fails even if the app has a bug.

## 2. Constraints

- The POS and its installer do not change. The dashboard lives in its own `dashboard/` folder with its own `package.json`.
- No real store data, no real credentials, no secrets in the repository. A permanent **DEMO** badge on every screen.
- No Playwright, no browser automation. Phone layouts are checked by hand in the built-in browser pane at set sizes.
- Money stays integer halalas through the whole path. Arithmetic never goes through floating point.
- Nothing is pushed or deployed without the owner's say-so.
- Missing data shows as "Not available". It is never shown as zero.
- English first, because Arabic is deferred.

## 3. How it fits together

```
POS demo shop (real POS services, temporary SQLite)
   → export script → demo.json
   → seed script → Neon PostgreSQL (schema + records)
   → Next.js server components, read-only database role
   → phone browser (HTML only; no database access)
```

**Packages:** `next` 16, `react` 19, `@neondatabase/serverless`, `zod`. Dev only: `typescript`, `vitest`, `eslint`, `@electric-sql/pglite`. Charts are hand-written SVG, so there is no chart package.

**The POS repository:** the root ESLint config ignores `dashboard/**`. `.gitignore` gains `dashboard/.next`, `dashboard/seed/demo.json` and `.vercel`.

### Data

An export script runs the real `seedDemoShop` for **62 days** and writes the records to `dashboard/seed/demo.json` (not committed, about 3 MB). It runs under Electron's Node, like the audit tools, because the POS's SQLite library is built for Electron.

A much smaller **3-day fixture is committed** for tests, with the figures the POS's own services produced for it (`ownerKpis`, `profitAndLoss`, `balanceSheet`, `vatSummary`, `cashFlowData`, `shiftSummary`).

**Tables copied, unchanged in meaning:** `sales`, `sale_lines`, `payments`, `refunds`, `refund_lines`, `refund_account_offsets`, `products`, `categories`, `stock_balances`, `stock_movements`, `customers`, `receivables`, `receipt_allocations`, `customer_receipts`, `customer_writeoffs`, `suppliers`, `purchase_invoices`, `supplier_opening_balances`, `supplier_payments`, `supplier_payment_allocations`, `purchase_returns`, `supplier_bills`, `expenses`, `expense_payments`, `expense_categories`, `register_shifts`, `cash_movements`, `users` (id and display name only), `accounts`, `journal_entries`, `journal_lines`.

**Added for the dashboard:** `dashboard_users`, `sessions`, `login_attempts`, `demo_meta` (the demo's "today").

**"Today" in the demo** is the last day of the demo data, stored in `demo_meta`, and shown on screen as "Demo day: 9 Nov". This means the demo never goes stale and empty. Re-running the seed moves it.

Migrations are numbered `.sql` files, applied by a small runner that records them, like the POS.

## 4. Read-only, enforced four ways

| Layer | How |
|---|---|
| Screens | No add, edit, delete, approve or pay control. The only inputs are login, logout, period, search and filters |
| Server | Pages are server components that only read. The only server actions are `login` and `logout`. There are no JSON API routes |
| Database | The app connects as role `dashboard_app`, with `SELECT` on business tables and write access only to `sessions` and `login_attempts`. Migrations and seeding use the owner connection, which the running app never has |
| POS | Nothing flows back. There is no route from the phone to any POS |

**Tests prove it:** a scan of `src/app` finds no `route.ts` files and only those two server actions, and a test connected as `dashboard_app` has `INSERT`, `UPDATE` and `DELETE` on business tables refused.

**Environment variables** (server only, never `NEXT_PUBLIC_`):

| Name | Used by | Value |
|---|---|---|
| `DASHBOARD_DATABASE_URL` | The running app | Pooled connection as `dashboard_app` |
| `DATABASE_URL_UNPOOLED` | Migrate and seed only. Not set on Vercel | Direct connection as the owner |
| `DEMO_ADMIN_PASSWORD` | Seed only. Not set on Vercel | Chosen when seeding |
| `DASHBOARD_APP_PASSWORD` | Migrate only. Not set on Vercel | Password for `dashboard_app`, at least 60 bits of entropy |

A test scans the built client files and fails if a database host, connection string or these variable names appear.

## 5. Login

One account with role `admin`, created by the seed from `DEMO_ADMIN_PASSWORD`. Nothing is hardcoded.

- Passwords are hashed with Node's `scrypt`.
- A session is a random 32-byte id. Only its SHA-256 is stored. Cookie: `httpOnly`, `secure`, `sameSite=lax`, 12 hours.
- Five failures for a username lock it for 15 minutes, recorded in `login_attempts`.
- `requireAdmin()` runs in every page's data loader, not just the layout, because layouts do not re-run on navigation. No session or wrong role redirects to `/login`.
- Logout deletes the session row.

Neon's managed auth was considered and left out: it adds a dependency and setup for a single demo account.

## 6. Screens

Phone first. Bottom bar with **Overview, Sales, Money, Stock, More**. More opens a plain list: Customers, Suppliers, Shifts, Accounts. Nothing depends on hover. Tap targets are at least 44 px. Wide tables become stacked cards. Colours and type follow the POS tokens (green primary, dark top bar, status colours), in light and dark.

**Period chooser** at the top of period screens: Today, Yesterday, This week, This month, Last month, Custom. It lives in the URL (`?p=month`, `?p=custom&from=&to=`), validated with zod, so back and refresh work. "Right now" figures carry a small **Right now** label and do not follow the period.

| Screen | Shows |
|---|---|
| Overview | Sales and change from the previous period, gross profit, net profit (marked provisional), expenses, transactions, average sale, cash, card, customers owe the store, store owes suppliers |
| Sales | Trend by day, week or month; by payment method; count; refunds; discounts; sales history with paging |
| Money (profit and expenses) | Revenue, cost of goods, gross profit, operating expenses, net profit, expenses by category, monthly trend. A plain note that cash received is not revenue or profit |
| Stock | Product count, stock value, low stock, out of stock, fast movers, slow movers, recent movements |
| Customers | Owed to the store, collected, overdue, recent activity. Labelled as money owed **to** the store |
| Suppliers | Owed by the store, recent purchases, payments, overdue. Labelled as money the store owes |
| Shifts | Open shift, cashier, opening cash, expected cash, recent closed shifts with counted cash and difference |
| Accounts | Balance sheet summary, profit and loss, cash flow, trial balance status, receivables, payables, VAT |

**VAT:** output VAT; input VAT eligible for deduction; VAT not claimed (non-recoverable); and VAT pending verification, which is VAT printed on saved delivery notes and proformas (`supplier_bills.paper_vat`, `doc_type` of `delivery_note` or `proforma`). Pending is labelled as an estimate.

Each screen has loading, empty and error states. Sparse results stay sparse: no invented points to fill a chart.

## 7. Figures

One folder, `src/metrics/`, holds SQL written for Postgres. POS services cannot be reused directly because they are synchronous and tied to SQLite, so the rules are re-stated and proved equal.

`dashboard/METRICS.md` lists, for each figure: source tables and fields, formula, date range, what is included and excluded, VAT, refunds, and actual or estimate.

**Rules copied from the POS, with store time (UTC+3) for day boundaries:**

- Net sales, cost of goods, gross profit, operating and net profit come from the journal, as in `profitAndLoss`.
- Cash collected = cash tendered − change − refunds. Card as recorded.
- Stock value is the balance of account 1200. Cash and bank = 1010 + 1020 + 1030.
- Customers owe = sum of open invoices. Suppliers owed = open items − unused return credits.
- Expected shift cash uses the same formula as `shiftSummary`.

**Data problems are shown, not hidden.** On each load the server runs: journal balanced; balance sheet equation; account 1100 against open invoices; account 2000 against open items; sale totals against lines. If one fails, a warning shows on the figures it affects.

## 8. Testing

Vitest, against an in-process PostgreSQL (PGlite), so tests need no account or network. If PGlite cannot run a needed feature, the plan falls back to a Neon test branch for that test only.

- Migrations apply from empty. Seed loads the fixture.
- **Equivalence:** every figure, for every period type, equals what the POS's services produced for the same fixture.
- Independent checks on the fixture: sales against transactions, refunds, net sales, gross profit, net profit, customer and supplier balances, stock value, shift cash, balance sheet, trial balance.
- Login: right, wrong, locked, expired, logged out. Protected pages redirect.
- Read-only: refused writes, route scan, client bundle scan.
- Date filters, including Saudi day boundaries. Bad period values fall back safely.
- Empty database and failed query show the right states. A planted fault shows the warning.
- Production build passes.
- By hand in the built-in browser: 360, 390, 430, 768 and 1280 pixels wide, no sideways scrolling, nothing clipped or overlapping.

## 9. Deployment

Everything is prepared, with exact steps in `dashboard/DEPLOY.md`. The owner needs a Neon account and a Vercel account, and must say go.

1. Create the Neon project. Run migrate and seed from this PC with the owner connection.
2. `vercel deploy` from `dashboard/`, after logging in. This uploads the folder and needs no Git push.
3. Set `DASHBOARD_DATABASE_URL` on Vercel.

No URL is claimed until a real deployment returns one.

## 10. Later, real shops (written up only, not built)

`dashboard/PRODUCTION.md` will describe: POS → existing outbox → authenticated API with a device token → cloud database → dashboard. It covers offline operation, retry, duplicate events through event ids, highest version per snapshot, and the POS as the only writer.

The demo schema is built for full records. The real path sends snapshots, so moving to it changes where figures come from. That document says so plainly.

## 11. Out of scope

Real store connection. Any write from the phone. Arabic screens. Push notifications. More than one shop.
