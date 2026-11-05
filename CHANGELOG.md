# Changelog

Not for live trading: there is no ZATCA Phase 2 integration yet, and receipts are marked "NOT A ZATCA TAX INVOICE".

## Unreleased — Phase 2, part 1: refunds, wastage, stock counts (2026-11-05)

Built to the owner's refund policy (decision D1, given 2026-11-05): **7-day window, original receipt required, refunds always paid in cash, supervisor approval for every refund.** Store credit (D2) was not requested and is not built.

### Added
- **Refund tab.** The cashier types the invoice number from the receipt. The screen shows what was sold, what was already refunded and how many days have passed. The cashier picks quantities and a reason. A supervisor PIN is needed, or a logged-in supervisor approves it. The app then prints a **credit note** (CN-00000001…) naming the original invoice, reason, cashier and approver.
  - Refunds cannot exceed what was sold on that line, counting earlier refunds. A double-click pays out once (request key).
  - The amount comes from the stored sale: the price paid, discount shared out per unit. Refunding the last units of a line returns the exact remainder, so all refunds of a line can never add up to more than was paid (tested).
  - "Back on shelf" (ticked by default) returns the item to stock at the cost it left at. Untick it for damaged or expired goods: the customer still gets the money, the stock does not come back.
  - Books: Dr Sales and Dr VAT payable, Cr Cash; restocked goods Dr Inventory / Cr Cost of goods sold.
  - Sales made by card are refunded in cash, as decided. The screen warns the cashier when the sale was paid by card.
  - Refunds and refund lines are immutable (database triggers), like sales.
- **Wastage** (Stock tab, supervisor/admin): expired, damaged, spoiled or other. Stock is taken off at the average cost, Dr 5100 Wastage / Cr Inventory, document ADJ-000001…
- **Stock count** (Stock tab, supervisor/admin): enter what is on the shelf (blind count: the system quantity is not shown). Only the differences are recorded; gains and losses are posted to 5100. Count with the shop closed.
- **Shift**: "Refunds paid in cash" line; expected drawer cash is reduced by refunds.
- **Reports**: refunds and net sales / net VAT in the summary, a refunds list (credit note, invoice, cashier, approver, reason), a wastage and count-differences list, and refunds processed / approved per user in the cashier report.
- Migration 5 (new tables only; existing data untouched; the encrypted pre-migration snapshot runs first as usual).

### Not done in this part
- **ZATCA credit note** (XML, signature, QR, reporting): Phase 5. Each refund already stores the original invoice and its own UUID for it. **Debit notes** are also needed for ZATCA onboarding and will come with Phase 5.
- Batches and expiry dates, device diagnostics (rest of Phase 2 in the plan).
- **For the accountant:** an item sold while stock was below zero left at cost 0.00 (no stock had been received yet). If it is refunded and put back on the shelf, it returns at 0.00, which lowers the average cost. This follows "returns come back at the cost they left at". Receiving goods before selling them avoids it.

### Verified (commands run on 2026-11-05)
- `npm run typecheck`, `npm run lint`: clean. `npm test`: **119 passed** (16 new: 15 refund/wastage/count tests, 1 refund-over-IPC test; the cashier permission matrix now also covers refunds without approval, wastage, counts and the two new reports).
- `node e2e/smoke.mjs`: **24/24 steps**. New steps:
  - cashier refund with the owner's PIN: over-refund refused on screen, credit note printed with the original invoice, receipt then shows "already refunded";
  - shift shows the refund and the reduced expected cash;
  - owner records wastage and a stock count, then sees refunds, net sales and differences in Reports.

## Phase 1, checkpoint 3: known-gap fixes (2026-11-05)

### Fixed
- **Saudi business days.** Reports, the voids report and **journal entry dates** now use Riyadh time (UTC+3, no daylight saving). Before this, a sale after 9 pm was dated the previous day in the books.
- **Pre-migration snapshot is encrypted** (as a `.posbak` in the backups folder) once a backup key exists. Without a key, it stays a plain copy, as before.
- **Cash in/out now posts to the ledger**: Cash against account 2900 "Suspense – cash movements to classify", so book cash always equals drawer cash. The accountant reclassifies the suspense balance.
- **Removing lines or clearing a bill before payment is audited**, and a new "Items removed before payment" report lists each removal with user, time and value. Removal is not blocked (see decision Q-10 below).
- **Receipt** shows Riyadh date and time and bilingual tender and change labels.

### Added
- **Arabic/English interface** with a language button. Arabic switches the whole layout to right-to-left, and product names show in the chosen language first. The choice is saved per till. A test fails the build if any on-screen phrase lacks an Arabic translation. The Arabic wording is my translation and should be checked by the owner.
- `e2e/installer.mjs`: silent per-user install, then launch the installed app, then silent uninstall.

### Verified (commands run on 2026-11-05)
- `npm run typecheck`, `npm run lint`: clean. `npm test`: 80 passed.
- `node e2e/smoke.mjs`: 21/21 steps, now including the Arabic RTL toggle and an 80 mm receipt render (Arabic letters correctly joined; checked by eye from the captured image).
- `node e2e/installer.mjs` on this Windows 11 machine:
  - silent install to `%LOCALAPPDATA%\Programs\Store POS` with a desktop shortcut;
  - the installed app starts and creates its database;
  - silent uninstall removes the program and shortcut and keeps the store's data folder.
  - Both the installer and uninstaller finish in a background process after the command returns, and the test waits for them.

### Still open (needs hardware, money or a decision)
- **Real printer and scanner**: need the models. The receipt is only checked as a rendered image.
- **Clean-machine install, upgrade from an older version, SmartScreen/antivirus**: needs a spare PC and a code-signing certificate (yearly cost).
- **Off-site backup**: Phase 6.
- **Accountant's chart of accounts and real accounts for cash in/out**: needs the accountant.
- **Decision Q-8**: manual weight entry, still blocked.
- **Decision Q-10 (new)**: should a cashier need a supervisor to remove lines? Today removals are allowed and audited.
- **Refunds**: Phase 2.

## Unreleased — Phase 1, checkpoint 2 (2026-11-05)

### Added
- **Stock tab:** receive goods from a supplier (weighted-average cost, posts Inventory / Goods received not invoiced), plus stock-on-hand and low-stock lists.
- **Reports tab:** sales summary for a date range (totals, VAT, discounts, cash net of change, card), by-day breakdown, top products.
- **Admin tab:**
  - users with roles (admin, supervisor, cashier);
  - suppliers with Saudi VAT-number check;
  - CSV import of products/suppliers with a dry run that reports every problem per row and imports all rows or none;
  - backup key setup with a one-time recovery code, "Back up now", and restore.
- **Sell screen:**
  - line discounts (a cashier needs a supervisor username and PIN);
  - hold and recall bills;
  - attach a customer by phone (creates one if not found).
- **Local encrypted backup:**
  - consistent snapshot (`VACUUM INTO`) → integrity and foreign-key check → AES-256-GCM with a per-file key wrapped by the master key, with the manifest authenticated → written atomically → read back and decrypted to verify;
  - the master key is protected with Windows DPAPI (`safeStorage`) and can be recovered from a 55-character recovery code with a checksum;
  - runs automatically at shift close and every 4 hours while the app is open, plus on demand;
  - keeps the newest 30 files;
  - a status badge is always visible in the top bar.
- **Restore:** works from the first-run screen on a replacement computer, or from Admin. It decrypts, checks integrity, checks row counts against the backup record and shows the last invoice number for the owner to confirm. It takes a safety backup first, moves the old database aside (never deletes it), records the restore in the audit log, then restarts.
- **Before any schema migration**, the existing database is snapshotted automatically.
- **Windows installer (NSIS, x64, unsigned):** `npm run dist` → `release/Store POS Setup 0.1.0.exe`.

### Fixed
- After logout, the next user landed on the previous user's tab and could see a blank screen.
- The single-instance lock is now taken after the data folder is final, so the lock is per data folder.

### Verified (commands run on 2026-11-05)
- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 70 tests passed.
- `node e2e/smoke.mjs`: 19/19 steps passed. Covers security settings, setup, product, scan, sale, backup key, users, supplier, goods receipt, discount approval (wrong PIN rejected), hold/recall, shift close, manual backup, and restore on a fresh data folder with the recovery code (all 3 sales present).
- `node e2e/packaged.mjs`: the packaged `.exe` loads native SQLite from the bundle and keeps data across restart.

### Known gaps / not verified
- **Off-site (cloud) backup is not built** (Phase 6). Local backups sit on the same disk as the database; the UI tells staff to copy them to USB.
- The pre-migration snapshot is an **unencrypted** copy in the app data folder.
- **Not yet tested:**
  - the installer itself on a clean Windows machine (install, update, uninstall);
  - printing on a real printer;
  - a real scanner;
  - SmartScreen and antivirus behaviour with an unsigned installer.
- Sales report day boundaries use UTC, not Saudi time (UTC+3), so a sale late in the evening can fall on the next day.
- Cash in/out and supplier invoices are not posted to the ledger (they need the accountant's rules). There are no refunds yet (Phase 2).
- Removing a line before payment is not separately audited.
- The UI is English-first with Arabic product names; a full Arabic RTL interface is not done.
- Manual weight entry is still blocked until decision §Q-8 is answered.

## Phase 1, checkpoint 1 (2026-11-05)
- Tooling, integer money/VAT core, scale-label and scanner input, schema v1 with immutability triggers, checksummed migrations, SQLite version gate.
- Users/roles, hash-chained audit log, catalog, stock movements, ledger, shifts, atomic idempotent sale finalization.
- Secure Electron shell (sandbox, context isolation, IPC allowlist with validation, CSP, navigation blocked) and a basic cashier UI.
- Fixed: failed logins were rolled back and never locked the account.
