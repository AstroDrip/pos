# Retail Capability Audit

Audit date: 2026-11-05 · Commit `e31c346`+ · All testing used isolated temporary databases with fictional data. No production data exists or was touched.

**Status key**
- **TESTED**: fully implemented and tested.
- **UNTESTED**: implemented but not fully tested.
- **PARTIAL**: partially implemented.
- **UNSAFE**: implemented but unsafe.
- **MISSING**: not built.
- **BLOCKED**: needs an outside dependency (hardware, the accountant, ZATCA, a provider, or an owner decision).

## How a sale is executed (traced, not assumed)

1. **Till (renderer).**
   - Each bill has a random `billKey` (idempotency key).
   - Lines hold product, quantity, discount and the price the cashier saw.
   - Pressing **Cash** or **Card** sets a busy guard (no new scans) and calls `window.pos.invoke('sale.finalize', …)`. The preload only allows listed channels.
2. **Main process.**
   - `src/main/main.ts` checks the sender frame.
   - `src/main/handlers.ts` (`dispatch`) validates the payload with zod (`src/shared/ipc.ts`), requires login, and authenticates any discount approver by PIN.
3. **`finalizeSale`** (`src/services/sales.ts`) runs as **one SQLite transaction** on the single connection:
   1. Idempotency: a repeated `billKey` returns the existing sale.
   2. Open-shift check, clock check, discount permission check.
   3. Product snapshot and price-changed check.
   4. `computeInvoice` (`src/core/vat.ts`): integer halalas, VAT per rate, allocated to lines.
   5. Payment rules: card ≤ total, change only from cash.
   6. `invoice_counters` +1.
   7. INSERT into `sales`, `sale_lines` and `payments`.
   8. `applyMovement` per line (`stock_movements` + `stock_balances`, weighted-average cost).
   9. `postEntry`: balanced journal (Cash/Card, Sales, VAT output, COGS, Inventory).
   10. `appendAudit` (hash-chained).
4. Any error rolls back **everything**, including the invoice number.
5. Triggers forbid UPDATE or DELETE on sales, lines, payments, stock movements, journals and audit rows.
6. After commit, printing is a separate call. A print failure never affects the sale.

## Capability register

| # | Capability | Status | Implementation (files) | Expected / actual | Tests | Severity if wrong | Recommendation |
|---|---|---|---|---|---|---|---|
| 1 | Barcode scan (keyboard wedge) | TESTED (simulated) | `core/scan-buffer.ts`, `renderer/Sell.tsx` | Fast burst + Enter = one scan, whatever box has focus; double scan within 400 ms asks to confirm. As expected. | `hardware-input.test.ts`, E2E | High | Test on the store's scanner (BLOCKED: model unknown). |
| 2 | Indexed product search (EN/AR/SKU/PLU/barcode/alias/category) | TESTED | `services/search.ts`, `core/search-normalize.ts`, migration 004, `renderer/SearchBox.tsx` | Suggestions after 3 Latin / 2 Arabic letters; ranked; keyboard navigation; stale results discarded; p95 < 6 ms at 100k products. | [S-2-01..06], E2E, benchmark | High | Owner to review Arabic normalisation choices. |
| 3 | Weighed products via scale labels | TESTED (parser) / BLOCKED (real labels) | `core/scale-barcode.ts`, `catalog.lookup` | Weight and price labels; zero, impossible, damaged and inactive labels rejected. Label format is configurable, not invented. | [S-3.3-01..04] | High | Need a photo of a real label and the scale's barcode setting. Decide F-SCALE-1/2. |
| 4 | Manual weight entry | MISSING (by decision) | n/a | Blocked until decision Q-8. | n/a | n/a | Keep blocked unless approved. |
| 5 | Cash, card and split tender | TESTED | `sales.ts`, `Sell.tsx` | Card ≤ total; change from cash only; split cash+card. | [S-3.5-01], services tests | High | n/a |
| 6 | Card terminal integration | MISSING (excluded) | n/a | "Card" is a **manually recorded** tender, not verified by a terminal. | n/a | Medium | Reconcile daily against the terminal's settlement report. |
| 7 | Idempotent payment (double click, retry) | TESTED | `sales.ts` idempotency key | Five presses = one sale and one payment. | [S-3.5-02], services | Critical | n/a |
| 8 | Line discounts with supervisor approval | TESTED | `sales.ts`, `Sell.tsx` | Cashier needs supervisor username+PIN; approver recorded. | services, E2E | High | Reason field for discounts: not captured (add if wanted). |
| 9 | Bill-level / % discounts, promotions, BOGO, coupons | MISSING | n/a | Not built. | n/a | Medium | Needs a promotion policy first. |
| 10 | Price override by cashier | Not possible (by design) | n/a | Cashiers cannot change prices; only `product.manage` can, and it is audited with history. | permission matrix | Critical | n/a |
| 11 | Price change while in basket | TESTED | `sales.ts` | Refused with `PRICE_CHANGED`; screen refreshes. | [S-3.1-03] | High | n/a |
| 12 | Hold / recall | TESTED | `services/held-bills.ts` | Hold has no fiscal effect; recall deletes the hold; the bill key travels with it, so paying twice is one sale. | [S-3.1-04], E2E | Medium | n/a |
| 13 | Removing lines / clearing bill before payment | TESTED | `held-bills.recordRemoval`, `reports.voidsReport` | No approval (owner decision Q-10); audited with cashier and bill (invoice no. once paid). | phase1b, E2E | High | n/a |
| 14 | Removing items **after** payment / voiding a finalised sale | Not possible (by design) | triggers | Finalised sales are immutable. Corrections must go through refunds and credit notes (MISSING, row 15). | services immutability tests | Critical | n/a |
| 15 | Refunds, returns, exchanges, credit notes | **TESTED** (2026-11-05) | `services/refunds.ts`, Refund tab | Policy D1: 7 days, receipt required, cash, supervisor approval. Linked to the original lines, over-refund impossible, idempotent, immutable, local credit note. Exchanges = refund + new sale. ZATCA credit note: Phase 5. Store credit: not requested. | phase2.test.ts, handlers.test.ts, e2e | Critical for go-live | ZATCA credit note in Phase 5. |
| 16 | Store credit / customer credit ledger | **MISSING** | n/a | Not in the approved plan. Needed for Scenario A. | n/a | High | Owner decision: offer store credit at all? |
| 17 | Receipt printing (Arabic, 80 mm) | UNTESTED on hardware | `main/receipt-html.ts`, `main.ts` | Raster HTML via the Windows driver; Arabic shaping checked as a rendered image. | handlers test, E2E image | High | BLOCKED: printer model. |
| 18 | Reprint marked COPY, no new sale, audited | TESTED | `handlers.ts` `sale.print` | As expected. | handlers tests | High | n/a |
| 19 | Cash drawer kick / "no sale" | MISSING | n/a | Permission exists, but no drawer command yet. | n/a | Medium | BLOCKED: drawer/printer model. |
| 20 | Users, roles, PIN login, lockout, deactivation | TESTED | `services/users.ts` | scrypt PIN hashes; 5 failures → 5-minute lock; deactivated users cannot log in or approve; the last admin is protected. | services, [S-13-01], permission matrix | Critical | Decide idle auto-lock (F-AUTH-1). |
| 21 | Backend permission enforcement | TESTED | `handlers.ts` + `requirePermission` in services | A cashier is refused all 22 manager/admin IPC operations. | permission matrix | Critical | n/a |
| 22 | Audit log (hash chain, immutable, checked by the app) | TESTED | `services/audit.ts`, `system.health` | UPDATE/DELETE blocked; a forged INSERT is detected and shown. | services, BUG-010 test | Critical | See residual risk in the security report. |
| 23 | Shifts, cash in/out, close with over/short | TESTED | `services/shifts.ts` | Expected = float + cash sales − change + in − out; difference posted; closed shift immutable. | services, [Scenario I] | High | Mid-shift count, cashier handover: MISSING (F-SHIFT-1). |
| 24 | Stock movements, balances, negative-stock policy | TESTED | `services/inventory.ts` | Movements are the source of truth; balance drift check; unique source key. | services, invariants | High | n/a |
| 25 | Goods receipt (GRN), double-submit safe | TESTED | `inventory.receiveGoods` | One request key = one GRN. | [S-7-01], E2E | High | n/a |
| 26 | Stock count, adjustment, wastage, expiry/batch | **TESTED** except expiry/batch (2026-11-05) | `services/adjustments.ts`, Stock tab | Wastage and blind stock counts, immutable ADJ documents, posted to 5100. Expiry/batch not built. | phase2.test.ts, e2e | High | Batches/expiry later in Phase 2. |
| 27 | Purchase orders, supplier invoices, payments, returns | MISSING (Phase 4) | n/a | n/a | n/a | Medium | Phase 4. |
| 28 | Product deactivation instead of deletion | TESTED | `catalog.setProductActive` | Never deleted; inactive not sellable; audited with reason. | [S-2-05] | High | n/a |
| 29 | Accounting engine (balanced journals, no double posting) | TESTED (engine) / BLOCKED (chart) | `services/ledger.ts` | Every entry balances; unique per source; immutable. Chart of accounts is a draft. | services invariants (300 random sales) | Critical | Accountant must approve the chart and posting rules. |
| 30 | Reports: sales, VAT, by day, top products, voids, cashier activity, stock | TESTED | `services/reports.ts` | Reconcile to source tables in tests. Saudi business day. | phase1b, [Scenario I] | High | Refund/discount-reason reports wait for refunds. |
| 31 | ZATCA Phase 2 (XML, signing, QR, ICV/PIH, reporting) | **MISSING / BLOCKED** | n/a | Receipts say "NOT A ZATCA TAX INVOICE". | n/a | **Critical for go-live** | See the ZATCA report. |
| 32 | Local encrypted backup + verified restore | TESTED | `services/backup.ts`, `backup-crypto.ts` | Snapshot, check, encrypt, read back; restore to a fresh folder demonstrated. | phase1b, E2E restore | Critical | n/a |
| 33 | Off-site (cloud) backup | MISSING (Phase 6) | n/a | n/a | n/a | **Critical for go-live** | Choose provider and region. |
| 34 | Migrations with pre-migration snapshot | TESTED | `db/migrations.ts`, `connection.ts` | Checksummed; refuses a newer database; snapshot encrypted when a key exists. | migrations, phase1b | Critical | n/a |
| 35 | Offline operation | TESTED (by design) | all local | Nothing needs the internet today. (ZATCA reporting will.) | all tests run offline | n/a | n/a |
| 36 | Arabic/English UI, RTL | TESTED | `renderer/i18n.tsx` | Dictionary test fails on any untranslated phrase. | i18n test, E2E | Medium | Owner to review the Arabic wording. |
| 37 | Installer / uninstall | TESTED on dev PC | `package.json` build, `e2e/installer.mjs` | Silent install/uninstall works; data kept. | installer script | Medium | Clean PC and code signing: BLOCKED. |
| 38 | Electron security (sandbox, isolation, CSP, nav block) | TESTED | `main/main.ts` | As expected. | E2E security steps | Critical | Keep Electron on a supported line. |
| 39 | Terminal/device ID in audit events | MISSING | n/a | Single till today, so the user is the discriminator. | n/a | Low | Add when a second till is approved. |
| 40 | Customer records | TESTED (basic) | `services/parties.ts` | Phone unique; history. | phase1b | Low | n/a |
