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
| T1 | Theme tokens + light/dark/system, persisted, no bill loss | T0 | styles.css, renderer/theme.tsx (new), App.tsx, main.tsx, i18n.tsx | pending | theme unit test, e2e step | | |
| T2 | Keyboard checkout state machine (search → qty → cart → payment; Enter = cash, Ctrl+Enter = card) | T1 | renderer/Sell.tsx, renderer/SearchBox.tsx, renderer/checkout-keys.ts (new), i18n.tsx | pending | state-machine unit tests, e2e keyboard-only sale | | |
| T3 | Configurable scale-label layout (field order incl. item + qty + PLU), legacy formats kept | T0 | core/scale-barcode.ts, services/catalog.ts, migration 6, ipc/handlers (settings), Admin.tsx | pending | parser matrix tests, lookup tests | | Real label sample (BLOCKED) |
| T4 | Expenses: chart additions, categories, drafts, approval/posting, payments (partial), recurring, prepaid, capital, reversals, VAT classes, reports | T3 (migration order) | services/expenses.ts (new), migration 7, ipc/handlers, renderer/Expenses.tsx (new), shifts.ts (till payouts) | pending | expenses.test.ts, permission matrix, e2e | | Accountant approval (provisional) |
| T5 | Financial statements: P&L, balance sheet, trial balance (dated), general ledger; one KPI service for desktop + dashboard | T4 | services/financials.ts (new), renderer/Accounting.tsx (new) | pending | reconciliation tests | | Accountant approval |
| T6 | Owner dashboard: KPI snapshot, transactional outbox, sync state, transport interface; remote service | T5 | services/dashboard-sync.ts (new), migration 8 | pending | outbox/retry/idempotency tests with a fake transport (simulated, labelled) | | **Hosting decision + cost** for the remote service and phone UI |
| T7 | Full regression, e2e, docs, commit | T1–T6 | docs/*, CHANGELOG.md, e2e/smoke.mjs | pending | full suite + e2e | | |
