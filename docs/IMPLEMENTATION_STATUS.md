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
| A Themes | pending | | — | | — | |
| B Expenses + accounting | pending | | 6 | | Accountant approval of the chart and VAT treatment (provisional defaults used) | |
| C Owner dashboard | pending | | 6 | | Hosting decision and cost | |
| D Keyboard workflow | pending | | — | | — | |
| E Weighed-label format | pending | | 6 | | **Real label sample** | |
| F Financial report integration | pending | | — | | Accountant approval | |
