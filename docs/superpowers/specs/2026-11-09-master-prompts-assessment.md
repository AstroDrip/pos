# Master Prompts A and B: Assessment and Proposed Plan

**Date:** 2026-11-09. **Branch:** `feature/owner-tools` at `8521c1d`, clean. **Status:** the owner accepted all ten decisions in section 10 on 2026-11-09. Project A goes first.

This document covers the "before implementation" deliverables of both prompts. Everything here comes from reading the repository, unless it is marked as a proposal.

## 1. Summary

- Much of what Prompt A asks for already exists: the shortcut registry, hold bill, demand ranking, the append-only audit log and several accounting checks. The plan extends these and does not build rivals.
- Some things in the prompts do not exist in the app: shift handover, cash flow report, price override, sale cancel, financial periods, manual journals, role editing, ZATCA submission. Each one needs a decision: build it, or leave it out. See section 2.3.
- The two prompts are separate projects, so each gets its own spec and plan.
  - **Project A** adds to the desktop POS, in six stages.
  - **Project B** is a new web app in a `dashboard/` folder, kept apart from the POS.
- Nothing can be deployed yet. This machine has no Vercel CLI, no Vercel or Neon token, and no accounts linked. See section 9.

## 2. Repository assessment

### 2.1 Architecture

Electron 45, React 19, TypeScript, SQLite through better-sqlite3. 11 migrations. Money is integer halalas, quantity is integer milli-units. Every call goes through a zod allowlist in `src/shared/ipc.ts`, then `src/main/handlers.ts`, with `requirePermission` in the services. Tests are Vitest in a Node environment, with no DOM library. Real-screen checks use `npm run ui-audit`, which drives Electron itself and does not use Playwright.

### 2.2 Feature inventory against the prompts

| Requested | What exists today | Gap |
|---|---|---|
| Hold bill | `held-bills.ts`, H in Quick Actions, Hold button. Audited `bill.hold` and `bill.recall`. No sale, stock or ledger effect | **Line discounts are lost** (the app says so in a message). Typed cash and card amounts are not kept. No way to cancel a hold. No Z key |
| Shortcut registry | `keyboard-registry.ts`: combo, action, contexts, permission, priority, allowed states, conflict, help text. One listener in `key-hub.ts`. Scanner guard. Arabic layout handling | No `enabled` field. No Z. No customer-step keys |
| F1, F4, Shift+Enter, Enter, Ctrl+Enter, +, −, Esc | All exist and are tested | Keep unchanged |
| P C S H R I M | All exist, on every screen | Keep unchanged |
| Customer suggestions on Sell | **Never built.** `Sell.tsx:638` is a plain form that searches only when Enter is pressed. `useSuggest` is used on 8 other screens but not here | See 2.4 |
| Product search and demand | FTS index, barcode, SKU, PLU, aliases, categories, Arabic normalising. `demand.ts` uses 7, 30 and 90-day sale counts, and only orders items inside the same match level | No time-of-day, day-of-week or stock signal. Nothing on screen says why an item ranks high |
| Tab memory | **None.** `App.tsx:123-134` unmounts a tab when you leave it. Leaving Sell loses the bill. M and S are grey for that reason | All of Part 3 |
| Help Centre | 71 articles in `help/content.ts`, search, F1 per screen, "?" links, generated manual | No field registry, no metric registry, no info icons. Audit, roles, integrity, statements and VAT need articles |
| Audit log | `audit_log`: hash chain, update and delete blocked by triggers, about 55 action types, red banner if the chain breaks, included in backup counts | **No screen to read it.** No `audit.view` permission. No role, screen, device, status or standard before/after fields |
| Accounting checks | `unbalancedEntries`, `trialBalance`, `stockDrift`, `creditControls`, `supplierControls`, `verifyAuditChain`, `balanced` on the balance sheet | No single report. No recalculation of documents against the ledger. No orphan checks. No screen |
| Statements | P&L, balance sheet, trial balance, general ledger, VAT report, owner KPIs | **No cash flow report** |
| Dashboard | Local half only: `dashboard-sync.ts` writes KPI snapshots to an outbox, off by default. `ownerKpis` is the one KPI source. ADR-6 sets the rules | No web app, no server, no hosting |

### 2.3 Things the prompts name that the app does not have

The rule is "do not invent screens or features", so each needs a decision.

| Item | Proposal |
|---|---|
| Shift handover (acceptance test 14) | **Build a small one.** One "Hand over" action closes the shift with a cash count and opens the next cashier's shift in one transaction, and records both people, the cash and the difference. Uses existing close and open rules |
| Cash flow report (Parts A4, A6, B5.8) | **Build it read-only**, from movements on cash and bank accounts 1010, 1020, 1030, grouped by source. Posts nothing |
| Held bill cancel | **Build it**, with a reason, audited |
| Price override, sale cancel, opening cash change, financial periods, manual journals, role or permission editing, editing barcode, PLU or cost on a product | **Do not build.** The audit catalogue marks them "no such action in the app". Help will not describe them. Sales always use the catalog price, and that stays |
| Customer code | **Do not add.** Search name, phone and VAT number, which are the identifiers that exist |
| Reserved stock, loans | Not in the app. Help says nothing about them |
| ZATCA | No submission code exists, and it still needs your go-ahead. Help will explain what the receipt shows today and say plainly that the link to ZATCA is not set up |

### 2.4 Root cause: customer suggestions

This is a missing feature, not a broken query. Four separate faults in `Sell.tsx` and `parties.ts`:

1. The Sell box has no suggestion list at all.
2. With exactly one match, Enter picks that customer with no choice shown (`Sell.tsx:449`). The prompt forbids this.
3. With no match, it offers to create a customer through a browser `confirm` popup, using the typed text as both name and phone.
4. `findCustomers` uses plain `LIKE` on the raw text, so Arabic spelling variants (أ / ا, ة / ه) do not match. Product search already normalises these.

### 2.5 Conflicts inside the requirements

| Conflict | Proposed ruling |
|---|---|
| "Z must not fire when an input is focused", but the payment step always has focus in Cash received | Z works in the **Cash received and card-part boxes only**, because they hold numbers and a Z is never valid there. It does not work in a PIN box, the customer box or anywhere else. Blocked during IME composition, on key repeat, while busy, and when a popup is open. On an Arabic keyboard it uses the physical Z key, as the Quick Actions letters do |
| "Reopen with the original information intact", but `finalizeSale` always charges the catalog price and has a `PRICE_CHANGED` guard | Save the price seen, the discount and the customer. On recall, discounts come back. If a price changed, the bill shows the **new** price with a warning. VAT and price rules do not change |
| A discount was approved by a supervisor before the hold | The discount comes back, but approval is asked for again at payment. Approval and PIN are never stored |
| "Every login starts on Sell" (an existing safety rule) against "remember every tab" | Remember per user. Restore the last tab only if that user may still open it. A cashier's default stays Sell |
| "Offer controlled corrections" against "never rewrite financial records" | The first version **reports only**. Financial tables are blocked from updates by triggers, and any fix would be a new reversing entry that a person chooses. No auto-repair |
| "Component tests" against "no unnecessary packages" | No DOM test library is added. Key and state decisions stay in pure functions under Vitest. Real-screen behaviour is checked by `ui-audit` |
| Standing rule: Arabic deferred | New labels get Arabic strings because a test needs them. Help content stays English |

## 3. Dependency map

```
Stage 1 Sell keys, hold, customer search   (no dependency)
Stage 2 Tab memory                         uses the extended hold payload from stage 1
Stage 3 Demand ranking                     (independent)
Stage 4 Audit log upgrade and screen       hold cancel and handover events feed it
Stage 5 Integrity and cash flow            reads the audit chain; adds the report screen
Stage 6 Help registry and info icons       LAST: documents the final screens and formulas

Project B dashboard                        needs the demo seed (done) and cash flow rules (stage 5)
```

## 4. Risk assessment

| Risk | Control |
|---|---|
| Keeping tabs alive makes hidden screens react to keys, or take focus | Only the visible tab registers keys. A check ignores hidden search boxes. Real-app flows for each tab |
| A kept-alive Sell shows an old price | `PRICE_CHANGED` already blocks the sale at payment. Refresh when the tab returns |
| One user sees another's screen after logout | Tabs are keyed by user id, so logout destroys them. A test proves it |
| Old audit rows stop verifying if the hash input changes | New fields go inside `details_json`, which is already hashed. **No change to the hash formula** |
| A failed action leaves no record, because its transaction rolled back | Failures are written in their own transaction after the rollback |
| Secrets end up in audit details | One redaction function removes pin, password, key and token fields. Test on every event |
| The Help text drifts from the real formulas | Metric examples are computed by the real services in tests, and a test fails if an icon has no entry |
| Field help is a very large writing job (about 240 inputs and labels, about 60 values) | Cover important fields and every money value. "Important" is defined in the spec. Trivial boxes are skipped and listed |
| The dashboard disagrees with the POS | Seed from real POS services, then a test compares every figure with `ownerKpis` |
| Secrets in browser code | Database access in server code only. A test scans the client bundle for the connection string |

## 5. Project A: stages

Every stage: test first, full `npm test`, typecheck, lint, one real-app `ui-audit` run, Help updated, then a local commit. Nothing is pushed.

### Stage 1: Sell keys, hold, customer search (Parts 1, 2.1, 7)

- Z key as ruled above, through the existing `hold()`.
- Hold payload gains: seen unit price, discount, typed cash and card. Old held bills still load. Migration not needed, because the payload is JSON.
- Registry gains `enabled` and structured focus rules.
- Customer box moves to `useSuggest`, with arrows, Enter, Esc and no silent pick. Stale answers cannot be chosen. "Add new customer" is an explicit row, shown only with `customer.manage`.
- `findCustomers` uses Arabic normalising and also searches VAT number.

**Proposed shortcut map (additions only)**

| Key | Where | Action |
|---|---|---|
| Z | Payment step, cash or card-part box | Hold the bill |
| F2 | Sell, search or payment step (not quantity) | Go to the customer box. Bill stays. From payment it steps back first |
| Shift+Enter | Customer box, empty, bill has items | Go to payment (same key as from search) |
| Ctrl+F or Esc | Customer box | Back to product search (existing keys) |

F2 is free: the app only uses F1 and F4, and F2 can be rebound by the admin like the other direct keys. All existing keys are unchanged.

### Stage 2: Tab memory (Part 3)

**Recommended approach:** keep each visited tab mounted and hidden, keyed by user. It is the only option that keeps half-typed forms everywhere without rewriting each screen. The alternatives were moving each screen's state into a central store (touches about 12 large files, high regression risk) and saving state on every unmount (loses anything not listed by hand).

| State kind | Where it lives |
|---|---|
| Temporary UI (open row, popup) | React state in the kept-alive tab |
| Filters, article, dates, scroll, last tab | `localStorage`, per user, restored after restart. Record ids are checked for existence and permission before use |
| Unsaved Sell bill | New `bill_drafts` SQLite table, one row per user. On next login: "A bill was left open: Restore or Discard". It is not a sale |
| Unsaved supplier bill | The same draft mechanism, separate kind |
| PINs, approver names, passwords | Never stored |

M and S stop being grey for "bill has items", because leaving Sell no longer loses the bill.

### Stage 3: Demand ranking (Part 2.2)

Add time-of-day and day-of-week signals and an in-stock nudge, each used only when there is enough history (threshold in the spec). Order stays: **match level first**, so an exact barcode or SKU can never be hidden. Suggestions get small labels: "Often bought" (history) and "Usually sold around now" (estimate). No wording implies a confirmed order. Offline, from local sales only.

### Stage 4: Audit log (Part 5)

`appendAudit` adds a standard block inside `details_json`: actor name and role at the time, screen, device id, shift id, before, after, reason, related transaction, success or failure. New permissions `audit.view` and `audit.export`, for admin only (the supervisor role would otherwise get them by default, so they are excluded in the migration).

New Audit tab: search, filter by user, date, action, entity; before and after view; open related record; CSV export where allowed. No edit or delete exists, and the triggers already block them.

**Audit event catalogue**

| Status | Events |
|---|---|
| Already recorded | `product.create/price/aliases/activate/deactivate`, `sale.finalize/refund/reprint/line_removed/bill_cleared`, `bill.hold/recall`, `shift.open/close`, `cash.in/out`, `customer.create/credit_settings/payment/payment_reversed/advance_applied/writeoff`, `supplier.create/update/notes`, `purchase.invoice/bill/return/pay/advance_applied/payment_reversed/opening_balance`, `expense.create/edit/post/pay/reverse/cancel/amortize/recurring_saved`, `stock.receive/count`, `user.create/activate/deactivate`, `auth.login/fail`, `backup.create/restore/key_created`, `settings.shortcuts/store_details`, `import.*`, `scale.layout_saved` |
| To add or improve | `bill.cancel`, `shift.handover`, cash difference as its own event at close, standard before/after on every edit, `audit.export`, `integrity.run`, permission denied |
| No such action in the app | price override, sale cancel, opening cash change, financial period change, manual journal, role or permission edit, barcode or PLU or cost edit. Recorded only if built later |

Refunds already link to the original sale through `refunds.original_sale_id`.

### Stage 5: Integrity and cash flow (Part 6)

New read-only `services/integrity.ts`, plus a screen with severity, record, explanation and suggested fix. Results saved so an admin can review what is still open. The recalculation uses its own SQL over source documents, not the functions that made the figures.

**Accounting invariant catalogue**

| # | Check | Compared against |
|---|---|---|
| 1 | Each entry: debits = credits | journal lines (existing) |
| 2 | Trial balance debits = credits, all time and per period | journal lines |
| 3 | Assets = liabilities + equity + current earnings | accounts by type |
| 4 | Sale total = sum of its lines; VAT and net likewise | `sales` vs `sale_lines` |
| 5 | Payments − change = sale total | `payments` vs `sales` |
| 6 | Sales credited to 4000 and VAT to 2200 match the sale documents | ledger vs documents |
| 7 | COGS debit = sum of line qty × unit cost | ledger vs `sale_lines` |
| 8 | Refund never exceeds its sale; no duplicate refund | `refund_lines` vs `sale_lines` |
| 9 | Stock on hand = sum of movements | existing `stockDrift` |
| 10 | Account 1200 vs quantity × average cost, within a stated rounding limit | stock vs ledger |
| 11 | Account 1100 = open customer invoices | existing `creditControls` |
| 12 | Account 2000 = open supplier items − unused return credits | existing `supplierControls` |
| 13 | Expected shift cash = float + cash sales − change + in − out − cash refunds | recomputed vs `shiftSummary` and stored close |
| 14 | Account 1010 movements agree with recorded cash events | ledger vs documents |
| 15 | Cash flow closing − opening = change in 1010+1020+1030 | new report vs ledger |
| 16 | Orphans: payment, movement, journal entry, allocation or tax document whose source is missing | foreign keys and `source_type/source_id` |
| 17 | Duplicate invoice, refund or document numbers; invalid shift or product references | document tables |
| 18 | Audit chain intact; backup record complete | existing checks |

The exact rules are to be confirmed against the ledger source while writing tests, because some rows have edge cases (rounding, prepaid expenses, mixed tenders). A check that turns out to be wrong will be corrected and recorded, and the numbers it compares will not be altered.

New permission `integrity.view`. Every run is audited. VAT calculation, invoice numbering, ZATCA processing and stock rules are not touched.

### Stage 6: Help registry and info icons (Part 4)

Two new typed lists, `help/fields.ts` and `help/metrics.ts`, keyed by ids such as `field.product.priceIncl` and `metric.grossProfit`.

- **Field entry:** meaning, why, what to enter, required or optional, format, what saving does, where it is used, mistakes, example.
- **Metric entry:** meaning, formula, included, excluded, actual or estimate, VAT, balance or period, why it changes, example.
- `<InfoIcon id="…" />` opens a short popover with a link to the full article. It appears only on hover or focus of the row, or in a muted style, to avoid clutter.
- New statement articles for balance sheet, P&L, trial balance, cash flow and VAT, using your examples and Saudi VAT.
- Tests: every icon id exists, every registry entry is used, the manual stays generated, and metric examples are computed by the real services.

### Proposed database changes (Project A)

| Migration | Change |
|---|---|
| 012 | Indexes on `audit_log` (at, action, entity, user). Permissions `audit.view`, `audit.export`, `integrity.view`, admin only |
| 013 | `bill_drafts` (user, kind, payload, updated_at) |
| 014 | `integrity_runs`, `integrity_findings` |

No existing table changes shape. No destructive statements.

### Part 8 tests: where each one lands

| Tests | Stage | Kind |
|---|---|---|
| 1–4 hold and Z | 1 | Pure key rules, service tests, real-app flow |
| 5–8 customer search and steps | 1 | Service and pure tests, real-app flow |
| 9–10 tab memory and Help position | 2 | Pure store tests, real-app flow, restart flow |
| 11–12 field and metric help | 6 | Registry tests with real services |
| 13–17 audit | 4 | Service and handler tests, trigger test |
| 18–19 reconciliation | 5 | Tests that deliberately break data in a temp database |
| 20 backup keeps audit | 4 | Backup and restore round trip |

## 6. Project B: inspection

- Data available: everything in the demo seed (`src/demo/seed.ts`): 631 sales over 13 days, 61 products, 26 customers, 6 suppliers, shifts, expenses, refunds, purchases, ledger.
- Calculations: `financials.ts` (`ownerKpis`, P&L, balance sheet), `credit.ts`, `purchasing.ts`, `shifts.ts`, `vat-report.ts`. These are synchronous and written for SQLite, so they cannot run against Postgres as they are.
- Authentication: POS logins are local PINs on a desktop session. They cannot be reused and must not be.
- Reusable: design tokens in `styles.css` (green `#0b6e4f` primary, dark top bar, status colours), the money helpers in `core/money.ts`.
- Vercel cannot reach the SQLite file, as ADR-6 already says. The phone only ever talks to the web service.

## 7. Project B: proposed design

**Read-only rule (owner decision, 2026-11-09).** The phone dashboard only shows the store's data. It cannot change anything: no adding bills, no managing stock, no payments, no edits of any kind. The admin can look at different time periods and the store's finances.

| Control | How it is enforced |
|---|---|
| Screens | No add, edit, delete, approve or pay control anywhere. The only inputs are login, logout, date and period choosers, search and filters |
| Periods | One period chooser (today, yesterday, this week, this month, last month, custom dates). Period figures follow it. "Right now" figures (stock value, money owed, cash and bank) are labelled as current and do not change with the period |
| Server | Business data routes are `GET` only. The only write routes are login and logout |
| Database | The app connects with a Neon role that has `SELECT` only on business tables. It may write only to `sessions` and login-attempt records. Migrations and seeding use a separate role that the running app never holds |
| POS link | Data only ever flows from the POS outward, now and in the future production path. The phone can send no command to the POS |
| Tests | A list of all routes proves there are no other write routes. A test logged in as the app's role proves that `INSERT`, `UPDATE` and `DELETE` on business tables are refused |

**"NeoDB".** Neon PostgreSQL is assumed. This needs your confirmation, because the prompt says to stop and ask otherwise.

**Stack.** Next.js in `dashboard/` with its own `package.json`, so no web package reaches the POS or its installer. Neon's current docs recommend `@neondatabase/serverless` by default, using `neon()` over HTTP. `sql.transaction()` covers non-interactive transactions. The Vercel integration sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct).

**How the demo gets its numbers: three options.**

| Option | Result |
|---|---|
| **1. Recommended: run the real POS seed, copy the records into Neon** | Records are real POS output. The dashboard runs SQL over them. A test checks every figure against `ownerKpis` for the same data |
| 2. Send only the existing outbox snapshots | Closest to the future production path, but holds fixed periods only, so no date filters or sales history |
| 3. Write a separate fake data generator | Numbers would be disconnected from POS rules. Rejected |

```
seedDemoShop (real services, temp SQLite) → export script → Neon → server-side API → phone
```

**Schema:** mirrors of the source tables the screens need (`sales`, `sale_lines`, `payments`, `refunds`, `products`, `stock`, `stock_movements`, `customers`, `receivables`, `suppliers`, `supplier_items`, `supplier_payments`, `expenses`, `shifts`, `accounts`, `journal_entries`, `journal_lines`), plus `dashboard_users` and `sessions`. The export copies records only: no invented figures.

**Login.** Own small login: passwords hashed with Node's scrypt, random session ids stored as hashes, `httpOnly`, `secure`, `sameSite` cookie, logout deletes the session, login attempts limited, one `admin` role checked on the server for every page and data route. The demo password is generated at seed time and comes from an environment variable. Nothing hardcoded. Neon's managed auth was the alternative, but it adds a dependency and setup for a demo with two accounts.

**Screens:** the eight sections from the prompt, phone first, bottom tab bar, cards in place of wide tables, a permanent DEMO badge, loading, empty and error states. English first, as Arabic is deferred. Layout checks at 360, 390, 430, 768 and desktop widths, by hand in the built-in browser.

**Inconsistent data.** The server runs the invariant checks. If one fails, a warning shows on the affected card. Missing data shows as "not available", never as zero.

**Calculation doc.** One `METRICS.md`: source tables, fields, formula, range, included, excluded, VAT, refunds, actual or estimate, for each figure.

**Production path (written up only, not built).** Offline POS → existing outbox → authenticated API with device token → cloud database → dashboard. Event ids make resends safe. The server keeps the highest version per snapshot. The POS stays the only writer.

**Tests:** connection, migrations, seed, login, protected routes, each calculation against `ownerKpis`, date filters, balance sheet, trial balance, empty and error states, production build. No Playwright. Tests needing a real database run against a Neon test branch or local Postgres.

## 8. Effort, honestly

This is a very large body of work. Project A is six stages, each likely comparable to the supplier-bills work. Stage 6 is the largest, because it is mostly careful writing. Project B is a new application. It will be done stage by stage, with results reported after each, and will not arrive in one go.

## 9. What is needed from you

| Need | When |
|---|---|
| Decisions in section 10 | Now |
| Neon account, Vercel account, and login on this machine (or connect them yourself) | Before Project B deploy |
| Your explicit OK to deploy, and how, because the rule is no pushing until you say so. `vercel deploy` from this PC needs no Git push | Before Project B deploy |

## 10. Decisions

| # | Decision | Default if you accept |
|---|---|---|
| 1 | Which project first | **Project A stage 1 onward, then B.** If the client demo is urgent, say so and B goes first |
| 2 | "NeoDB" means Neon PostgreSQL | Yes |
| 3 | Build shift handover, cash flow report, held-bill cancel | Yes, all three |
| 4 | Features in 2.3 marked "do not build" | Left out |
| 5 | Z allowed inside cash and card boxes | Yes |
| 6 | Recalled bill shows the new price with a warning if the price changed | Yes |
| 7 | Keep tabs alive, with restart recovery of Sell and supplier-bill drafts | Yes |
| 8 | Audit and integrity screens for admin only | Yes |
| 9 | Integrity reports only, with no corrections in the first version | Yes |
| 10 | Dashboard data copied from the real POS seed into Neon (option 1) | Yes |

After approval: a design spec for the first project, then a step-by-step plan, then code.

## Sources

- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)
- [Neon and Vercel overview](https://neon.com/docs/guides/vercel-overview)
- [Vercel-managed integration](https://neon.com/docs/guides/vercel-managed-integration)
- [Neon-managed integration](https://neon.com/docs/guides/neon-managed-vercel-integration)
- [Connect Next.js to Neon](https://neon.com/docs/guides/nextjs)
