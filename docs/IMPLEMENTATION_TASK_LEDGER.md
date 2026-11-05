# Implementation Task Ledger

This is the single authoritative plan. Tasks run **one at a time, in order**, by one coordinating agent. No parallel edits to shared files.

Shared files are edited only inside the task that owns them for that step:
- `src/shared/ipc.ts`
- `src/preload/preload.ts`
- `src/main/handlers.ts`
- `src/db/migrations.ts`
- `src/renderer/i18n.tsx`
- `src/renderer/App.tsx`
- `src/renderer/styles.css`

Migrations are added only in sequence: 6, then 7, then 8. A migration file is never edited after it is committed.

Start point: `main` @ `20d68df`. Branch: `feature/owner-tools`. Rollback = `git checkout main`.

| ID | Requirement | Depends on | Files owned | Status | Tests | Checkpoint | Outstanding |
|---|---|---|---|---|---|---|---|
| T0 | Phase 0 read-only audit | — | docs/IMPLEMENTATION_STATUS.md, this file, docs/ARCHITECTURE_DECISIONS.md, docs/TEST_RESULTS.md | done | baseline 119/119 | — | — |
| T1 | Theme tokens + light/dark/system, persisted, no bill loss | T0 | styles.css, renderer/theme.tsx (new), App.tsx, main.tsx, i18n.tsx | done | theme.test.ts, e2e | b01f38b | — |
| T2 | Keyboard checkout state machine (search → qty → cart → payment; Enter = cash, Ctrl+Enter = card) | T1 | renderer/Sell.tsx, renderer/SearchBox.tsx, renderer/checkout-keys.ts (new), i18n.tsx | done | checkout-keys.test.ts, e2e | af636d1 | Manual weight entry blocked (Q-8) |
| T3 | Configurable scale-label layout (field order incl. item + qty + PLU), legacy formats kept | T0 | core/scale-layout.ts, services/catalog.ts, migration 6, ipc/handlers, Admin.tsx | done (structure) | scale-layout.test.ts, scale-labels.test.ts | d4cdfb7 | **Real label sample (BLOCKED)** |
| T4 | Expenses: chart additions, categories, drafts, approval/posting, payments (partial), recurring, prepaid, capital, reversals, VAT classes, reports | T3 (migration order) | services/expenses.ts (new), migration 7, ipc/handlers, renderer/Expenses.tsx (new), shifts.ts (till payouts) | done | expenses.test.ts, permission matrix, e2e | d26426c | Accountant approval (provisional) |
| T5 | Financial statements: P&L, balance sheet, trial balance (dated), general ledger; one KPI service for desktop + dashboard | T4 | services/financials.ts (new), renderer/Accounting.tsx (new) | done (with T4) | reconciliation test, e2e | d26426c | Accountant approval; no period close |
| T6 | Owner dashboard: KPI snapshot, transactional outbox, sync state, transport interface; remote service | T5 | services/dashboard-sync.ts (new), migration 8 | POS side done; remote MISSING | dashboard-sync.test.ts (simulated) | 85d9b06 | **Hosting decision + cost** for the remote service, HTTPS transport, device token, phone UI |
| T8 | Purchasing: supplier invoices on GRNs, returns, payments, opening balances, statement, ageing; VAT summary reconciled to the ledger | T7 | services/purchasing.ts, services/vat-report.ts, migration 9, renderer/Purchases.tsx, Accounting.tsx, shifts.ts | done | purchasing.test.ts, e2e | see git log | Accountant approval; reverse-payment button; invoice print |
| T7 | Full regression, e2e, docs, commit | T1–T6 | docs/*, CHANGELOG.md, e2e/smoke.mjs | done | 171/171, e2e 27/27 ×3 | this commit | Installer test not re-run |
