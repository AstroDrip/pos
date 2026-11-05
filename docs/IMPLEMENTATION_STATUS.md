# Implementation Status

Verified against the source code, not against earlier plans or changelogs.
Baseline for this audit: branch `main`, commit `20d68df`, clean working tree.
`npx vitest run` gave **119 passed / 0 failed** on 2026-11-05. Work continues on branch `feature/owner-tools`.

Status values:
- **VERIFIED**: implemented, with automated tests.
- **WEAK TESTS**: implemented, but the tests are insufficient.
- **PARTIAL**: partly implemented.
- **MISSING**: not implemented.
- **BLOCKED**: waiting on hardware, an external service or an owner decision.
- **UNSAFE**: implemented incorrectly.

## A. Phase 0 audit: what exists today

### Architecture map

```
Renderer (React, sandboxed, no Node)
  │  window.pos.invoke(channel, payload)
  ▼
Preload (allowlist = src/preload/preload.ts, checked against src/shared/ipc.ts by a test)
  ▼
Main process: src/main/main.ts
  1. sender-frame check
  2. dispatch (src/main/handlers.ts): zod validation, login check, handler, DomainError → safe message
  ▼
Services (src/services/*): business rules, permission checks (requirePermission), one transaction per operation
  ▼
SQLite: one connection, WAL, synchronous=FULL (src/db/connection.ts)
  - migrations 1–5 with checksums (src/db/migrations.ts)
  - immutability triggers on finalised records
```

Session identity lives in the main process (`Session.user`). The renderer never asserts who it is.

### Feature inventory

| Feature | Status | Source | Tests |
|---|---|---|---|
| Product catalogue, barcodes, PLU, aliases, price history | VERIFIED | `services/catalog.ts`, migration 1, 4 | services.test, retail-scenarios |
| Scanner wedge input (burst detection, double-scan warning) | VERIFIED | `core/scan-buffer.ts`, `renderer/Sell.tsx` (global capture listener, removed on unmount) | hardware-input.test, e2e smoke "scanner burst" |
| Indexed search (FTS5 + B-tree, EN/AR, 3 Latin / 2 Arabic letters, ranking) | VERIFIED | `services/search.ts`, `core/search-normalize.ts` | retail-scenarios, search benchmark (docs/audit) |
| Search box (debounce, stale guard, ↑/↓, Enter, Esc) | VERIFIED | `renderer/SearchBox.tsx` | e2e smoke |
| Weighed-item scale labels | **PARTIAL / BLOCKED** | `core/scale-barcode.ts`: fixed layout `prefix + item + value + check`, EAN-13 only; item code matched to PLU | hardware-input.test, retail-scenarios. **Does not support the owner's stated order "item code + quantity + PLU". No real label sample.** |
| Cart: unit lines merge; each weighed label is its own line | VERIFIED | `Sell.tsx` addLine | e2e |
| Quantity entry for a picked product | **MISSING** | Picking adds qty 1; there is no quantity step and no "+" key | — |
| Payment keyboard shortcuts | **MISSING** | Mouse buttons only | — |
| Cash / card / split payment, change, card ≤ total | VERIFIED | `services/sales.ts` | services.test, e2e |
| VAT (inclusive prices, largest-remainder allocation) | VERIFIED | `core/vat.ts` | vat.test |
| Finalised sales immutable, gapless invoice numbers, idempotent | VERIFIED | `sales.ts`, migration 1 triggers | services.test |
| Refunds + local credit notes (policy D1) | VERIFIED | `services/refunds.ts`, `renderer/Refund.tsx` | phase2.test, handlers.test, e2e |
| Stock movements, weighted-average cost, GRN | VERIFIED | `services/inventory.ts` | services.test |
| Wastage, stock counts | VERIFIED | `services/adjustments.ts` | phase2.test, e2e |
| Shifts, cash in/out, over/short | VERIFIED | `services/shifts.ts` | services.test, phase1b, e2e |
| Users, PIN scrypt, lockout, roles admin/supervisor/cashier | VERIFIED | `services/users.ts`, migration 1 | services.test, handlers permission matrix |
| Hash-chained audit log + tamper banner | VERIFIED | `services/audit.ts` | BUG-010 test |
| Journal engine (balanced, one posting per source) | VERIFIED | `services/ledger.ts` | services.test |
| Chart of accounts | PARTIAL | Draft only (1010, 1020, 1200, 2000, 2100, 2200, 2210, 2900, 3000, 4000, 5000, 5100, 6000). **No expense, bank or prepaid accounts.** Marked "draft-pending-accountant" in settings. | — |
| Reports: sales, voids, cashier activity, stock, refunds, adjustments | VERIFIED | `services/reports.ts` | phase1b, phase2 |
| P&L, balance sheet, general ledger | **MISSING** | Only `trialBalance()` exists (no UI, no date filter) | — |
| Expenses | **MISSING** | — | — |
| Themes (light/dark/system) | **MISSING** | `styles.css` has light-only variables; a few hardcoded colours (`.msg` backgrounds, `.top`, `App.tsx` backup badge) | — |
| Owner mobile dashboard / sync | **MISSING** | No server, no outbox, no network code at all | — |
| Local encrypted backup / restore | VERIFIED | `services/backup.ts`, `backup-crypto.ts` | phase1b, e2e |
| Off-site backup | MISSING (plan Phase 6) | — | — |
| ZATCA Phase 2 | MISSING (plan Phase 5) | Receipts say "NOT A ZATCA TAX INVOICE" | — |
| Accounting periods / period close | MISSING (plan Phase 3) | — | — |

### Outdated or contradictory documents

- `PLAN_AND_APPROVAL_REQUEST.md`:
  - It marks accounting reports and the P&L as LATER, and they are indeed missing.
  - Its Phase 2 row lists "batches/expiry, device diagnostics", which are still missing, although refunds, counts and wastage now exist.
  - It assumed the scale label layout `prefix + item + weight/price + check`. The owner now says the order is item code + quantity + PLU. **This contradicts the current parser.**
- `docs/audit/RETAIL_CAPABILITY_AUDIT.md` row 19 (scale labels) says TESTED. It was tested only against an assumed layout, and that should be read as "unverified against the real label".
- `CHANGELOG.md` and `docs/audit/*` were updated on 2026-11-05 for refunds. I found no claims of completion beyond what the code does.

### Risks identified

1. **The scale label format is unknown.** The owner's description ("item code, quantity, PLU") names two identifiers, which may be the same number or different ones. A wrong guess charges the wrong amount, so this must be verified with a real label.
2. **Expense postings change the meaning of the draft chart.** New accounts are added only; no existing account's meaning changes. Every new account and VAT treatment is provisional until the accountant approves it.
3. **Cash paid out of the till for an expense must reduce the shift's expected cash.** Otherwise every expense paid from the drawer shows as a shortage.
4. **A remote dashboard needs a server.** That means a hosting choice, a running cost and internet exposure, which need an owner decision. Pointing a phone at the POS PC's database is ruled out.
5. **Payment keyboard shortcuts could create accidental sales** (for example, Enter pressed several times). This needs guards: ignore key-repeat, wait briefly after a state change, and keep a single busy lock.

## B. Requirements status (updated as work lands)

See the task ledger (`docs/IMPLEMENTATION_TASK_LEDGER.md`) for the per-task state. This table is the summary.

| Req | Status | Files | Migration | Tests | Blockers | Verified |
|---|---|---|---|---|---|---|
| A Themes | **VERIFIED** | `renderer/theme.tsx`, `styles.css` (tokens), `App.tsx` | — | `theme.test.ts` (tokens complete in both themes, no hardcoded colours), e2e (dark during open bill, kept after reload) | — | 2026-11-05 |
| B Expenses + accounting | **VERIFIED, PROVISIONAL accounting** | `services/expenses.ts`, `renderer/Expenses.tsx` | 7 | `expenses.test.ts` (19), permission matrix, e2e | Accountant approval of chart, posting rules and VAT treatment | 2026-11-05 |
| C Owner dashboard | **PARTIAL** (POS side built; remote service + phone UI MISSING) | `services/dashboard-sync.ts`, Admin sync card | 8 | `dashboard-sync.test.ts` (8, simulated server) | **Owner decision: hosting provider, domain, monthly cost** | 2026-11-05 |
| D Keyboard workflow | **VERIFIED** | `renderer/checkout-keys.ts`, `Sell.tsx`, `SearchBox.tsx` | — | `checkout-keys.test.ts` (7), e2e keyboard-only sale, Ctrl+Enter, split refusal, repeated Enter | Typing a weight for weighed goods still blocked (decision Q-8) | 2026-11-05 |
| E Weighed-label format | **PARTIAL / BLOCKED** (configurable parser built; real layout unverified) | `core/scale-layout.ts`, `services/catalog.ts`, Admin "Scale labels" | 6 | `scale-layout.test.ts` (8), `scale-labels.test.ts` (6) — synthetic layouts only | **Real label from the store's scale** | 2026-11-05 |
| F Financial report integration | **VERIFIED, PROVISIONAL** | `services/financials.ts`, `renderer/Accounting.tsx` | — | reconciliation test (P&L = sales − refunds, COGS, BS balanced, TB balanced, GL, KPIs = P&L) | Accountant approval; no period close | 2026-11-05 |

| G Purchasing + VAT summary | **VERIFIED, PROVISIONAL accounting** | `services/purchasing.ts`, `services/vat-report.ts`, `renderer/Purchases.tsx`, Accounting VAT section | 9 | `purchasing.test.ts` (12), permission matrix, e2e | Accountant approval; supplier-payment reverse button not on screen; purchase invoice printing | 2026-11-06 |
| H Customer & supplier credit (AR/AP) | **VERIFIED, PROVISIONAL accounting** | `services/credit.ts`, `core/status.ts`, `services/purchasing.ts` (allocations), `renderer/Customers.tsx`, `StatusBadge.tsx`, Sell credit panel | 10 | `credit.test.ts` (17), permission matrix, e2e | Accountant approval; decisions C-1…C-7 | 2026-11-06 |

Found and fixed during this work: BUG-015 (cost of units sold below zero stock), BUG-016 (default capital category), BUG-017/018 (keyboard focus). See `docs/audit/BUG_REGISTER.md`.
