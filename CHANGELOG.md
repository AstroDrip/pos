# Changelog

## Unreleased — Phase 1, checkpoint 1 (2026-11-05)

Not for live trading: there is no ZATCA Phase 2 integration yet, and receipts are marked "NOT A ZATCA TAX INVOICE".

### Added
- Tooling: TypeScript 6.0.3 (strict), Vite 8.3.5, Vitest 5.0.5, ESLint 10 (bans `Math.round`/`toFixed` for money), Electron 45.2.2, better-sqlite3 13.0.3 (bundles SQLite 3.53.4, N-API prebuilds, so no C++ compiler is needed).
- Core: integer-halala money, VAT-inclusive pricing with largest-remainder VAT allocation, EAN-13 scale-label parsing, keyboard-wedge scan detection with a double-scan guard.
- Database: schema v1 (STRICT tables, foreign keys, immutability triggers on sales, payments, stock movements, journals, audit log, closed shifts), checksummed migrations, a refusal to open a database newer than the app, and a startup check that blocks SQLite versions with known corruption bugs.
- Services: users and roles with scrypt-hashed PINs and lockout, hash-chained audit log, catalog (barcodes, PLUs, scale labels), goods receipt with weighted-average cost, shifts with cash in/out and over/short posting, and atomic sale finalization (invoice number, lines, payments, stock, journal and audit in one transaction, idempotent on retry).
- Electron: sandboxed renderer, context isolation, no Node in the renderer, a validated IPC allowlist, sender-frame checks, blocked navigation and new windows, denied permissions, single-instance lock, strict CSP.
- UI: first-run owner setup, login, product creation, open shift, sell (scan, SKU, cash/card, change), reprint marked "COPY", shift summary and close.

### Known gaps (still to do in Phase 1)
- No goods-receiving, supplier or customer screens yet (the services exist for GRN and suppliers), so sales made from the UI drive stock negative.
- Hold/recall bills, refunds, discounts in the UI, low-stock and sales reports, local encrypted backup and restore, CSV import dry-run, and the installer are not built.
- Cash in/out is not posted to the ledger; this needs the accountant's posting rule.
- The UI is English-first with Arabic product names; a full Arabic RTL UI is not done.
- Receipt printing has only been tested by writing HTML to a file. It has not been tried on a real printer.
- Manual weight entry is blocked until decision §Q-8 is answered.
