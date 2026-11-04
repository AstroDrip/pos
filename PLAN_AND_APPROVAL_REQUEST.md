# Plan and Approval Request — Saudi Single-Store Offline POS

**Prepared:** 2026-11-04 · **Status:** PLANNING ONLY. No code, dependencies, migrations or config have been created.
**Inputs:** Master prompt (pasted in chat) and `Saudi_POS_Project_Dossier.md`.

Labels used throughout: **[V]** verified fact (with source), **[R]** recommendation, **[A]** assumption that needs confirming, **[?]** unknown / must ask.

---

## A. Repository and environment audit (read-only)

| Item | Finding | Evidence |
|---|---|---|
| Project folder `C:\Users\HP\Desktop\POS system` | **Empty.** No source, no git repo, no prior work to preserve. This is a greenfield build. | `Get-ChildItem -Force -Recurse` returned nothing |
| Git | 2.55.0 installed; folder is **not** a repository | `git --version` |
| Node / npm | Node 24.19.0, npm 11.17.0 | `node --version`, `npm --version` |
| Python | 3.12.10 (dev tooling only; not proposed for the product) | `python --version` |
| Dev OS | Windows 11 Home 10.0.26300, 64-bit, locale en-GB | `Get-CimInstance Win32_OperatingSystem`, `Get-Culture` |
| Store machine | **[?] Unknown.** This dev laptop is *not* confirmed to be the store laptop. The OS version, RAM, disk, user rights and antivirus on the store machine must be checked. | — |
| Hardware attached here | None identified. Scanner, printer, scale and drawer models are **[?] unknown**. | — |

The only file this planning step created is this document. It is not source code.

---

## B. Requirements and scope matrix

Priority: **M** = must have for go-live · **S** = should have · **C** = could have / later.
Status vs. the SAR 1,500 starter: **IN** = included as working feature · **FND** = foundation only (data model and basic flow, not production-complete) · **LATER** = needs its own phase/budget · **EXCL** = excluded · **?** = unknown until discovery.

| # | Requirement | Pri | Module | Depends on | Acceptance test (summary) | Starter |
|---|---|---|---|---|---|---|
| 1 | Barcode scan and manual lookup | M | POS | Scanner model, product data | Scan 50 items rapidly; no lost or duplicated lines; lookup by name/code works | IN |
| 2 | PLU codes for loose produce | M | POS/Catalog | Product data | Enter PLU → correct item and price | IN |
| 3 | Weighed items via scale | M | POS/Hardware | **Scale model + protocol** | Weighed sale on the real scale matches the scale display to the agreed precision | FND (adapter interface + label-barcode parsing); live serial scale = LATER |
| 4 | Cash and card tender recording | M | POS | — | Split tender, change due, totals reconcile | IN |
| 5 | Card-terminal integration | C | Hardware | Vendor SDK, certification | — | EXCL |
| 6 | Item/bill discounts | M | POS | Discount policy | Discount needs permission; audit row written; tax computed after discount | IN (simple %, fixed) |
| 7 | Promotions (BOGO, combos, coupons) | C | POS | Policy | — | LATER |
| 8 | Hold/recall bills | M | POS | — | Hold, restart app, recall: same lines | IN |
| 9 | Returns/refunds linked to original | M | POS/Acct/ZATCA | Credit-note design | Refund references original sale line; stock and ledger reversed | FND (local refund); ZATCA credit note = LATER |
| 10 | VAT calculation, receipt | M | Tax | Accountant + ZATCA rules | Golden-file tests on rounding cases | IN (calc); ZATCA-format invoice = LATER |
| 11 | Cashier shifts, cash in/out, day-end | M | Ops | — | Expected vs counted cash, variance report | IN |
| 12 | Role permissions | M | Security | — | Cashier cannot refund without supervisor PIN | IN |
| 13 | Audit log | M | Security | — | Every high-impact action logged, log is append-only | IN |
| 14 | Basic customers + history | S | CRM | — | Attach customer to sale; view history | FND |
| 15 | Loyalty, messaging, e-receipts, customer display | C | CRM | Providers | — | EXCL |
| 16 | Stock movements (sale/receive/return/waste/adjust) | M | Inventory | — | Balance = sum of movements, always | IN |
| 17 | Batch/lot + expiry | S | Inventory | Policy (which products) | FEFO suggestion; expiry report | FND (schema), LATER (UI) |
| 18 | Reorder thresholds | S | Inventory | — | Low-stock report | IN |
| 19 | Stock counts + variance | M | Inventory | — | Count posts adjustment movements with reason | FND |
| 20 | Wastage/damage | M | Inventory | — | Wastage reduces stock and posts expense | IN (stock); ledger = LATER |
| 21 | Unit conversion (kg/g, case/piece) | M | Catalog | — | Receive 1 case = 24 pcs; sell by piece | IN |
| 22 | Label printing for repacked goods | C | Hardware | Label printer / scale | — | ? |
| 23 | Fast/slow/dead stock reports | C | Reports | — | — | LATER |
| 24 | Suppliers | M | Purchasing | — | CRUD + payment terms | IN |
| 25 | PO, GRN, supplier invoice, returns | S | Purchasing | — | GRN raises stock; invoice raises AP | FND (GRN) / LATER (PO, invoice, returns) |
| 26 | Supplier payments, credit terms, price history | S | Purchasing/AP | Accounting | — | LATER |
| 27 | Three-way match | C | Purchasing | — | — | EXCL |
| 28 | Chart of accounts + double-entry GL | M (stated) | Accounting | Accountant CoA | Every posting balances; trial balance = 0 | FND (schema + posting engine for sales only) |
| 29 | Posting rules for all workflows | M | Accounting | Accountant | Golden examples reconcile | LATER |
| 30 | AP/AR, P&L, balance sheet, trial balance, VAT report | M | Accounting | 28–29 | Reconciles to sample set | LATER |
| 31 | Fiscal periods, close, reversals | M | Accounting | — | Posted entries immutable; corrections by reversal | LATER |
| 32 | ZATCA Phase 2 (XML, signing, QR, CSID, reporting/clearance) | **M — legal** | Compliance | **Client ZATCA status** | Passes ZATCA SDK + sandbox + simulation compliance checks for the client's invoice types | **LATER — not in SAR 1,500** |
| 33 | Off-site encrypted backup + restore | M | Backup | Provider decision | Restore to a clean machine; integrity_check ok; record counts match | FND (local snapshot + encryption); cloud upload = LATER |
| 34 | Partial migration | S | Migration | Old-system export | Dry run, exception report, sign-off | FND (import templates + dry-run for products/suppliers) |
| 35 | Installer, update, rollback | M | Packaging | Code-signing decision | Clean-machine install, update, rollback | FND (unsigned installer) |
| 36 | Device diagnostics | M | Hardware | Device models | Diagnostics screen shows each device state | FND |
| 37 | HSN codes | — | Catalog | Accountant | — | **? Probably not a Saudi requirement.** Not built unless the accountant confirms a need. |
| 38 | Multi-branch, payroll, e-commerce, AI, CCTV, multi-terminal | — | — | — | — | EXCL |

---

## C. Assumptions and conflicts

**Conflicts that must be resolved before work starts**

1. **Budget vs. scope (critical).** The SAR 1,500 starter cannot fund production ZATCA Phase 2, full double-entry accounting, live scale integration, cloud backup with tested restore, or migration. Earlier estimates in the dossier for the broader system were SAR 35,000–95,000. I will not present the starter output as a finished system.
2. **Replacing a Phase 2 system (critical).** The store already issues Phase 2 invoices. The new app **cannot replace the old system in live trading until its own ZATCA flow passes onboarding.** Otherwise the store issues non-compliant invoices. Until then the new system can only run in parallel, in training, or as back-office (stock and accounting).
3. **"Full accounting" vs. "foundation".** Full accounting needs an accountant's chart of accounts, posting rules and opening balances. Without that input I can build the engine, but not correct books.
4. **Weighing scale.** "Scale required" with no model. Many supermarkets use **label-printing scales** that print an EAN-13 barcode with the weight or price embedded (prefix 2x). If the client's scale does this, the POS only needs barcode parsing, which is cheaper and more reliable than a live serial link. **[?] Must confirm.**

**Assumptions [A] (please confirm or correct)**

- One Windows PC, one cashier station, one SQLite file. No concurrent second terminal.
- Prices on the shelf are **VAT-inclusive** (common Saudi retail practice). Standard VAT rate is 15%; zero-rated or exempt items exist only if the accountant says so.
- Arabic and English UI and receipts; Arabic is RTL.
- Most sales are B2C **simplified tax invoices** (report within 24h). Some B2B **standard tax invoices** (need clearance before issue) may exist. **[?]**
- Card payments are recorded manually from a standalone terminal.
- Internet is available at least some of each day.

---

## D. Questions for you / the client

**Commercial**
1. Is SAR 1,500 a **hard cap for a limited foundation**, or does the client expect the full production scope at that price? *(If the latter, we must re-quote before any build.)*
2. Who pays recurring costs: cloud storage, code-signing certificate, any ZATCA middleware, support?

**ZATCA**
3. Name and vendor of the current billing system? Is it onboarded as an EGS unit on the Fatoora portal? How many EGS units/CSIDs?
4. Which invoice types are issued: simplified only, or also standard (B2B), credit notes, debit notes?
5. Who has Fatoora portal access (to generate OTPs and revoke/onboard devices)?
6. Do you want to (a) build ZATCA integration ourselves, or (b) use a ZATCA-integrated middleware/API provider? See §H.

**Hardware — please send photos of the model labels**
7. Scanner: make/model, USB keyboard mode? Suffix (Enter/Tab)?
8. Receipt printer: make/model, 58 or 80 mm, USB/LAN, Windows driver installed? Auto-cutter?
9. Scale: make/model, does it **print barcode labels**? If not, connection (RS-232/USB/LAN) and manual/protocol.
10. Cash drawer: connected to the printer (RJ11) or separate?
11. Store PC: Windows version, RAM, free disk, admin rights, antivirus product.

**Accounting**
12. Accountant name and contact. Is there an existing chart of accounts?
13. Inventory costing method: weighted average (recommended) or FIFO?
14. First-release needs: AP? AR (credit customers)? Expenses? Bank reconciliation? Period close?
15. Opening balances date and source.

**Operations**
16. Catalog size, daily transaction count, peak hour volume, number of staff users.
17. Negative-stock policy: block, warn, or allow with flag?
18. Which products need batch/expiry tracking?
19. Return policy: time window, receipt required, refund to original tender only?

**Migration**
20. Can the old system export to CSV/Excel? Which data: products, barcodes, suppliers, customers, opening stock?

**Backup**
21. Acceptable data loss (RPO), e.g. 1 hour? Acceptable downtime to restore (RTO), e.g. 4 hours?
22. Data residency: must backups stay in Saudi Arabia? (see §J)
23. Who keeps the **backup recovery key**? (owner + sealed envelope recommended)

---

## E. Architecture and data flow [R]

Modular desktop monolith, one process tree, no server.

```
┌─────────────────────────── Electron app ───────────────────────────┐
│ Renderer (React + TypeScript, Vite)  — sandboxed, no Node          │
│   POS screen · Back office · Reports · Diagnostics                 │
│        │  window.api.<allowlisted fn>(payload)                      │
│ Preload (contextBridge) — typed, minimal                            │
│        │  ipcRenderer.invoke(channel, payload)                      │
│ Main process                                                        │
│   IPC router → schema validation (zod) → permission check           │
│   Domain services: Sales, Inventory, Purchasing, Accounting,        │
│                    Customers, Users/Audit, Shifts                   │
│   Repositories (better-sqlite3, single connection, transactions)    │
│   Adapters: Scanner · Printer · Scale · Drawer                      │
│   ZATCA module: XML build · sign · QR · durable queue · API client  │
│   Backup service: snapshot → integrity check → encrypt → queue → upload → verify │
│   Secrets: Electron safeStorage (Windows DPAPI)                     │
└────────────────────────────────────────────────────────────────────┘
          │                                   │
     pos.db (SQLite, WAL)              ZATCA API / cloud storage (HTTPS)
```

Key choices:
- **One SQLite connection, owned by the main process.** All writes go through it. This avoids lock contention, and it avoids the multi-connection race behind the 2026 WAL-reset bug (§L-3).
- **Sale finalization is one SQLite transaction:** sale + lines + payments + stock movements + journal entry + ZATCA queue row + invoice counter. Commit or nothing.
- **ZATCA submission and backup upload run after the commit,** from durable queues. A network failure can never undo a sale.
- **The renderer never sees secrets, file paths or SQL.**
- **Keyboard-wedge scanner** input is captured in the renderer (it is keyboard input), then sent as a single `scan(code)` call.

Stack (pin exact versions at implementation, after a CVE check):
- Electron: latest patch of the newest supported major. Electron supports the latest three majors **[V, secondary source — confirm]** ([endoflife.ai](https://endoflife.ai/article-electron-42-eol), [Electron timelines](https://electronjs.org/docs/latest/tutorial/electron-timelines)).
- better-sqlite3 v12.x, **only a build that bundles SQLite ≥ 3.51.3** ([SQLite WAL page](https://www.sqlite.org/wal.html)).
- React, TypeScript (strict), Vite, zod, Vitest, Playwright for Electron, electron-builder (NSIS).

---

## F. Domain model / schema proposal

Conventions: money is **INTEGER halalas** (1 SAR = 100). Quantities are **INTEGER milli-units** (grams for kg items, 1000 per piece). Rates are basis points (15% = 1500). `STRICT` tables, `PRAGMA foreign_keys=ON`, timestamps in UTC ISO-8601 with store timezone recorded. No `DELETE` on finalized records. Triggers block `UPDATE`/`DELETE` on posted rows.

**Catalog**
- `units(id, code, name_ar, name_en, base_scale)`
- `products(id, sku, name_ar, name_en, category_id, base_unit_id, sell_mode[unit|weight], tax_category, vat_rate_bp, price_incl_halalas, active, track_batches)`
- `product_barcodes(barcode UNIQUE, product_id, unit_id, qty_per_scan)`
- `plu_codes(plu UNIQUE, product_id)`
- `unit_conversions(product_id, from_unit_id, to_unit_id, factor)`
- `categories`, `price_history(product_id, price, effective_from, changed_by)`
- `scale_barcode_formats(prefix, layout, embedded[weight|price], decimals)`

**Inventory**
- `stock_movements(id, product_id, batch_id NULL, qty_milli (+/-), unit_cost, reason[sale|refund|grn|purchase_return|waste|count_adj|opening], source_type, source_id, created_at, user_id, UNIQUE(source_type, source_id, product_id, batch_id))` — the unique key stops duplicate movements on retry
- `stock_balances(product_id, batch_id, qty_milli, avg_cost)` — kept in step inside the same transaction; a nightly check compares it to `SUM(stock_movements)`
- `batches(id, product_id, lot_no, expiry_date, received_at)`
- `stock_counts`, `stock_count_lines`, `wastage_records(reason_code)`

**Sales**
- `register_shifts(id, user_id, opened_at, opening_float, closed_at, counted_cash, expected_cash, status)`
- `cash_movements(shift_id, type[in|out], amount, reason, user_id)`
- `held_bills(id, payload_json, user_id, created_at)`
- `sales(id, invoice_no UNIQUE, uuid UNIQUE, shift_id, customer_id, invoice_type, status[finalized|refunded_partial|refunded], subtotal_excl, vat_total, total_incl, rounding_adj, created_at)` — immutable after insert
- `sale_lines(sale_id, line_no, product_id, name_ar_snapshot, name_en_snapshot, qty_milli, unit_price_snapshot, discount, vat_rate_bp, line_excl, line_vat, line_incl)`
- `payments(sale_id, tender[cash|card|other], amount, reference)`
- `refunds(id, original_sale_id, credit_note_no UNIQUE, reason, approved_by, …)`, `refund_lines(refund_id, sale_line_id, qty_milli, …)` with check: refunded qty ≤ sold qty
- `invoice_counters(series, next_value)` — incremented inside the sale transaction

**Purchasing**
- `suppliers`, `purchase_orders`, `po_lines`, `goods_receipts`, `grn_lines`, `supplier_invoices`, `supplier_payments`, `purchase_returns` (later phases)

**Accounting**
- `accounts(id, code UNIQUE, name_ar, name_en, type[asset|liability|equity|income|expense], parent_id, is_postable)`
- `fiscal_periods(id, start, end, status[open|closed])`
- `journal_entries(id, entry_no UNIQUE, date, period_id, source_type, source_id, memo, reversal_of NULL, UNIQUE(source_type, source_id, kind))` — unique key stops double posting
- `journal_lines(entry_id, account_id, debit, credit, CHECK(debit>=0 AND credit>=0 AND (debit=0 OR credit=0)))`
- Balance enforced in the posting service **and** verified by a deferred check before commit (SUM debit = SUM credit per entry).
- `posting_rules(event, account_role → account_id)` so the accountant's mapping is data, not code.

**Customers:** `customers(id, name, phone, vat_no NULL, cr_no NULL, address…)`

**Security:** `users(id, username, pin_hash (argon2id/scrypt), active)`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_log(id, at, user_id, action, entity, entity_id, before_json, after_json, prev_hash, hash)` — the hash chain makes tampering detectable.

**ZATCA**
- `zatca_egs(id, env[sandbox|simulation|production], csid_ref, cert_serial, onboarded_at, status)` — private key and secret live in DPAPI-protected storage, referenced by id only
- `zatca_documents(id, sale_id|refund_id, icv UNIQUE per egs, uuid, pih, invoice_hash, xml_signed BLOB, qr_tlv, type, status[pending|submitted|reported|cleared|reported_with_warnings|rejected|failed_retryable])`
- `zatca_attempts(document_id, at, http_status, response_json, outcome)`

**App/backup/migration:** `settings`, `schema_migrations(version, applied_at, checksum)`, `backup_jobs(id, created_at, trigger, local_path, size, sha256, enc_key_id, status[created|verified_local|queued|uploading|uploaded|verified_remote|failed], remote_key, error)`, `restore_events`, `import_jobs`, `import_errors`.

**Migrations:** numbered SQL files applied in one transaction each, checksum recorded. An automatic backup runs before any migration. App refuses to start against a DB newer than itself.

---

## G. Security threat model

| Threat | Example | Control |
|---|---|---|
| Renderer compromise → host takeover | XSS in product name renders script | contextIsolation, sandbox, nodeIntegration off, strict CSP (`default-src 'self'`), React escaping, no `dangerouslySetInnerHTML`, block navigation and `window.open` ([Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)) |
| Abusive IPC | Renderer calls `refund` with forged amounts | Allowlisted channels, zod validation, permission check in main, sender-frame check |
| Insider fraud | Cashier voids paid items, issues fake refunds, edits stock | Supervisor PIN for refund/void/discount over limit, hash-chained audit log, no deletes, daily exception report |
| Data theft (stolen laptop) | Customer phone numbers, sales data | Windows account password + BitLocker **[R]** (Windows 11 Home has only "Device encryption" on some hardware — check), backups encrypted |
| Secret leakage | ZATCA private key, cloud credentials | Main-process only, `safeStorage` (DPAPI), never in logs/repo/renderer, scrubbing logger |
| Ransomware / accidental deletion of backups | Malware deletes local and cloud copies | Write-only upload credential (cannot delete/overwrite), provider versioning + object lock/immutability where available |
| Tampered update | Malicious installer | Code-signed installer and update signature check **[?] cert cost** |
| Dependency vulnerability | Electron/Chromium CVE | Stay on supported Electron line; `npm audit` + advisory review at each release; lockfile pinned |
| Clock tampering | Back-dated invoices | Monotonic invoice counter, warn on clock going backwards, ZATCA timestamps |

**Saudi privacy:** The PDPL and its Data Transfer Regulations govern transfers abroad. Commentary says transfers are allowed with conditions (adequacy or SDAIA standard clauses), and there is no blanket localisation rule. This comes from law-firm sources, not the SDAIA text **[V-secondary]** ([King & Spalding](https://www.kslaw.com/news-and-insights/international-personal-data-transfers-under-saudi-arabias-data-protection-law), [Baker McKenzie](https://insightplus.bakermckenzie.com/bm/data-technology/saudi-arabia-updates-data-transfer-regulations-and-introduces-the-first-set-of-standard-contractual-clauses)). ZATCA rules on keeping e-invoice records may also apply. **The client should confirm with their accountant/lawyer.** My recommendation either way: keep minimal personal data, encrypt client-side, and prefer an in-Kingdom region.

---

## H. ZATCA Phase 2 research and plan

**Verified points (official ZATCA sources unless noted)**
- The developer page lists the **XML Implementation Standard** and **Data Dictionary**, both dated 19 May 2023 (page updated 12 Jan 2026). ([ZATCA specs page](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/E-Invoice-specifications.aspx))
- A **Security Features Implementation Standard v1.2** exists. ([ZATCA PDF](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf))
- **Simplified tax invoices must be reported within 24 hours** of issue. **Clearance does not apply to them.** Standard tax invoices must be cleared before they go to the buyer. The QR code for Phase 2 carries the XML hash and an ECDSA signature. ([Detailed Guidelines v2, May 2023](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf))
- ZATCA provides an offline **Compliance and Enablement Toolbox (SDK)** for validating XML. Passing it is a compliance check, not approval. ([Technical guideline](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf))
- Device management is on the **Fatoora portal**: "onboard new solution unit/device" and "revoke". Revocation cannot be undone. Each invoice-issuing POS device needs its own CSID. ([Fatoora Portal User Manual](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Fatoora_Portal_User_Manual_English.pdf))
- **Wave 25:** taxpayers with taxable turnover over SAR 187,500, integration by 1 Feb 2027. ([ZATCA Wave 25](https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx), [EY](https://globaltaxnews.ey.com/news/2026-1705-saudi-arabia-announces-25th-wave-of-phase-2-e-invoicing-integration)) The client's actual wave is **[?]**.

**Secondary / to verify against the official standard before coding**
- **[V] Security Features Standard v1.2, §16:** hashing SHA-256, asymmetric algorithm ECDSA, key length 256. QR Table 3: tags 1–5 seller/VAT no./timestamp/total/VAT total; 6 XML hash; 7 ECDSA signature; 8 public key; 9 certificate signature (simplified invoices). Text pulled from the official PDF on 2026-11-05.
- **Curve conflict — must be settled in the sandbox:** the certificate profile table in that standard says "Key length: P-256". But community CSR examples on ZATCA's own developer forum and vendor guides use **secp256k1** (`openssl ecparam -name secp256k1`) ([ZATCA forum](https://zatca1.discourse.group/t/invalid-csr-bad-request-400-when-get-csid/3567), [vendor guide](https://noqta.tn/en/tutorials/zatca-phase-2-einvoicing-typescript-integration-2026)). Rule: generate the key with the curve ZATCA's official SDK and sandbox accept, keep the curve as configuration, and add a test that onboards in the sandbox. Do not hard-code either curve until then.
- **Compliance samples before the production CSID** depend on the invoice types declared in the CSR. Simplified only → simplified invoice, credit note and debit note (3). Simplified + standard (`1100`) → all 6. Otherwise ZATCA returns "MissingComplianceSteps". ([Microsoft D365 onboarding guide](https://learn.microsoft.com/en-us/dynamics365/finance/localizations/e-invoicing-sa-onboarding), [ZATCA forum](https://zatca1.discourse.group/t/csid-the-compliance-certificate-is-not-done-with-the-following-compliance-steps/6304)) So the build must produce debit notes too, even if the store rarely issues them.
- **Queue ordering [R]:** one submission worker sends documents strictly in ICV order. ICV, PIH, hash, signature and QR are fixed inside the sale transaction, before printing, and never recomputed on retry.
- **PDF/A-3** is an allowed format for the copy given to the buyer. What is *reported/cleared* to ZATCA is the signed UBL 2.1 XML.
- Each document carries an ICV (counter) and PIH (previous invoice hash). A community source says a rejected document still uses its counter slot.
- Onboarding: CSR with OTP → compliance CSID → compliance invoice checks → production CSID. Three environments: developer portal (sandbox), simulation, production. CSIDs renew every 5 years. ([ZATCA community forum](https://zatca1.discourse.group/t/how-to-obtain-production-csid-and-is-it-necessary-after-creating-compliance-csid/4756), [ClearTax](https://cleartax.com/sa/how-to-renew-existing-csid-ksa-e-invoicing))
- **Switching provider:** ZATCA staff on the forum say the new EGS must be onboarded with a new CSID and the old one revoked. Each EGS has its own counter. Whether to carry over the last PIH is unclear. ([forum thread](https://zatca1.discourse.group/t/guidance-on-smooth-transition-of-client-from-another-egs-provider-to-our-system/7680), [Wafeq](https://www.wafeq.com/en-sa/tax-and-reporting/how-to-switch-accounting-software-without-breaking-your-csid-(zatca-phase-2-guide)))
- **Offline:** ZATCA guidance describes sending once the connection returns, and notifying ZATCA through a form if 24 hours pass.

**Note:** I could not extract text from the Detailed Technical Guideline PDF in this environment (no PDF text tool installed, and I did not install one). Before the ZATCA phase I will read the XML standard, Security Features standard and the SDK in full.

**Options [R — decision needed]**
- **Option 1 — Build it in-house.** XML (UBL 2.1 + KSA extensions), XAdES signature, QR, CSR/onboarding, reporting/clearance client. Highest control, highest effort and risk. Needs the official SDK in CI and test cycles on sandbox and simulation.
- **Option 2 — Use a ZATCA-integrated middleware/API provider.** The POS sends invoice data; the provider signs and reports. Less code and risk, but recurring fees, an internet dependency for signing (check whether local signing is supported), and vendor lock-in.
- **My recommendation:** decide after Q3–Q6. For a single store on a small budget, Option 2 is usually more realistic. **Either way, the local sale record, invoice counter and durable queue are built the same.**

**State machine (both options)**
`pending → submitting → reported | cleared | reported_with_warnings` · `→ rejected` (needs human action, never auto-marked OK) · `→ failed_retryable` (back-off, bounded, idempotent by UUID) · warnings and rejections show on a dashboard. Alerts fire before the 24-hour window ends.

**Go-live gate:** the new POS issues live invoices only after the client's flows (simplified, plus credit note, plus standard if used) pass SDK validation, compliance checks and production CSID issuance, **and** the old device is revoked in a planned cut-over.

---

## I. Hardware adapter plan

Interfaces (main process): `ScannerSource`, `ReceiptPrinter { print(doc), openDrawer(), status() }`, `ScaleSource { read(): {grams, stable, at} }`, `CashDrawer`. Business logic depends only on these.

| Device | Baseline approach | Risks handled |
|---|---|---|
| Scanner | USB keyboard-wedge. Global key buffer on the POS screen: characters arriving < ~30 ms apart and ending in the configured suffix = one scan, even if focus is in another field. | Focus loss, rapid scans, partial reads, duplicate scans (same code within N ms → confirm prompt, configurable) |
| Receipt printer | **Render the receipt as an image** in a hidden window (proper Arabic shaping, fonts, QR), then (a) print via the Windows driver silently, or (b) send ESC/POS raster (`GS v 0`) to a raw port. Text-mode ESC/POS is not used for Arabic. | Arabic shaping/code-page problems ([B4X thread](https://www.b4x.com/android/forum/posts/914687), [esc_pos_utils docs](https://pub.dev/documentation/esc_pos_utils/latest/)), paper width, cut, QR size |
| Reprint | Reprint reads the stored sale. It never creates a new sale. Marked "COPY". Audited. | Duplicate sale on print retry |
| Scale | **Path A:** label-printing scale → parse EAN-13 prefix 2x barcodes (weight or price embedded, check digit validated). **Path B:** serial/USB scale → adapter written from the **manufacturer's protocol manual only**, with stable flag, 2 s timeout, stale-reading rejection, zero/negative rejection. **Manual weight entry** only with supervisor permission and audit, if you approve it. | Unstable/stale reads, unit confusion, disconnects |
| Cash drawer | Pulse via printer (ESC p) if wired through it. | Drawer opens only on cash sale or authorised "no sale" (audited) |
| Card terminal | Tender recorded manually with an optional reference number. | Excluded integration |

**Device matrix** (to fill in during discovery): Make/model · Firmware · Driver · Connection · Operations supported · Test evidence (date, result) · Limitations · Fallback. No device counts as supported until a test on the real unit is recorded.

---

## J. Off-site backup and restore

**Pipeline**
1. **Snapshot** with the SQLite online backup API (`db.backup()` in better-sqlite3) into a temp file. Never copy the live `.db` while `-wal` exists ([SQLite WAL](https://www.sqlite.org/wal.html)).
2. **Verify locally:** open the snapshot read-only, run `PRAGMA integrity_check` and `foreign_key_check`, record row counts of key tables and the last invoice number.
3. **Encrypt** with AES-256-GCM (Node `crypto`), new random key per file wrapped by a master **backup key**. The manifest (sha256 of plaintext and ciphertext, schema version, app version, counts, timestamp) is stored with it.
4. **Queue** locally (bounded: keep last N files, stop and alert at a low-disk threshold).
5. **Upload** over HTTPS with a **write-only** credential. Multipart with per-part checksums.
6. **Verify remotely:** read back object metadata/checksum (or re-download a sample) and compare. Only then status = `verified_remote`.
7. **UI:** "Last verified off-site backup: <time>" turns amber after 24 h, red after 72 h; failure reason shown.

**Triggers:** day-end close, every N hours while open, before migration/update, manual (authorised).
**Retention proposal [R]:** hourly for 2 days, daily for 35 days, monthly for 13 months. Plus provider versioning and object lock where available.
**Keys:** backup master key generated at setup, stored with DPAPI on the PC **and** shown once as a recovery code that the owner prints and stores offline (and optionally a second copy with the accountant). **If both are lost, the backups cannot be decrypted. This is by design and must be accepted in writing.** Rotation: new key for new backups; old keys kept for old backups.
**Restore to a replacement PC:** install app → "Restore" wizard (admin) → enter cloud details + recovery code → list recovery points → download → verify sha256 → decrypt → integrity_check → show counts/last invoice for the owner to confirm → install as live DB (the existing DB is moved aside, never deleted) → re-onboard ZATCA device if needed (private keys are **not** in the backup by default). Restore drill is done before go-live and then quarterly.

**Provider comparison (research 2026-11-04; pricing to be quoted at decision time)**

| Provider | In-Kingdom region? | Immutability | Notes |
|---|---|---|---|
| Microsoft Azure Blob | **Saudi Arabia East** announced for **Nov 2026** ([Microsoft](https://news.microsoft.com/source/emea/2026/08/microsoft-announces-saudi-arabia-east-datacenter-region-will-be-available-in-november-2026/)). Blob availability there **not confirmed**. | Immutable blob policies, versioning (general Azure features) | Check service list at decision time |
| AWS S3 | Saudi region scheduled **Dec 2026** ([Amazon](https://www.aboutamazon.com/news/aws/aws-cloud-region-saudi-arabia)); not live today. Nearest live: Bahrain/UAE. | Object Lock, versioning | Object Lock in the new region unconfirmed |
| Google Cloud Storage | Dammam me-central2, but access only via local partner **CNTXT** for KSA customers ([Google](https://docs.cloud.google.com/docs/dammam-region-access)) | Bucket lock, retention | Procurement friction |
| Oracle Cloud Object Storage | Jeddah and Riyadh regions reported live ([third-party tracker](https://getdeploying.com/datacenters-in-saudi-arabia)) | Retention rules | Verify directly |
| Google Drive (consumer) | No region choice | Version history only | Simple but weak: no write-only credentials or real immutability. **Not recommended** for the primary copy |

**Recommendation [R]:** Decide in the backup phase (Saudi regions are opening right now). Lean towards Azure Saudi Arabia East or AWS Saudi region if confirmed live with immutability. Because data is encrypted on the PC first, the provider only ever stores ciphertext. Recurring cost for a few GB is expected to be small, but I will quote real prices before you decide.

---

## K. Migration plan

1. Get an export from the old system (CSV/Excel or DB dump). Keep the original untouched, with a hash recorded.
2. Write a field mapping per entity (products, barcodes, PLUs, prices, VAT category, suppliers, customers, opening stock).
3. **Dry-run import into a staging DB.** Validate: duplicate barcodes, missing names (AR/EN), invalid units, VAT codes, negative prices.
4. Exception report (CSV) for the client to fix at source or approve.
5. Reconcile counts and totals (item count, stock value at cost) with the client. Sign-off.
6. Final import uses movement reason `opening` and a single opening journal entry approved by the accountant.
7. **No historical sales are re-created as new invoices.** Old invoices stay in the old system (which must be kept readable for the legal retention period **[?] — accountant to confirm**).

---

## L. Known-bug research register (searched 2026-11-04)

| # | Area | Source | Applies to | Failure / impact | Mitigation | Test | Residual |
|---|---|---|---|---|---|---|---|
| 1 | Electron config | [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security) | All versions | RCE via renderer if nodeIntegration on, contextIsolation off, open navigation | Secure defaults, CSP, IPC validation, navigation lock | Automated test asserting webPreferences; Playwright test that `require`/`process` are undefined in renderer; navigation to external URL blocked | Low |
| 2 | Electron CVEs 2026 | [GitLab advisory DB](https://advisories.gitlab.com/npm/electron/CVE-2026-70611/), [Kodem CVE-2026-34769](https://www.kodemsecurity.com/cve-archive/cve-2026-34769), [CVE-2026-34765](https://www.kodemsecurity.com/cve-archive/cve-2026-34765), [CVE-2026-34768](https://www.kodemsecurity.com/cve-archive/cve-2026-34768) | Various < fixed patch versions | Command injection (DevTools handler), child windows with nodeIntegration, unquoted Run-key path on Windows | Use latest supported patch; never enable nodeIntegration/sandbox:false on any window; install to standard path; no login-item feature | Release gate: `npm audit` + check GitHub Electron advisories for chosen version | **Some identifiers look odd; verify on GitHub/NVD before relying on them** |
| 3 | SQLite WAL-reset corruption | [sqlite.org/wal.html](https://www.sqlite.org/wal.html) | SQLite 3.7.0–3.51.2; fixed 3.51.3 (2026-03-13) | Rare corruption when ≥2 connections write/checkpoint at once | Bundle SQLite ≥ 3.51.3; single connection in main process | Startup check: `select sqlite_version()` ≥ 3.51.3, else refuse to start | Very low |
| 4 | WAL file separation | same | All | Copying `.db` without `-wal` loses committed data | Backup API only; never file-copy live DB | Test: write during backup → restored snapshot contains all committed rows | Low |
| 5 | Checkpoint starvation | same | All | WAL grows without bound | Periodic `wal_checkpoint(TRUNCATE)` at idle and on day-end | Test: WAL size after 10k sales + checkpoint | Low |
| 6 | SQLite 3.52.0 issue | [Renovate PR note](https://code.popov.link/valentineus/strapi-plugin-checkbox-list/pulls/53) (secondary) | 3.52.0 | SQLite team flagged problems | Avoid 3.52.0; pin a known-good version | Version check | **Verify on sqlite.org** |
| 7 | Native module rebuild | [better-sqlite3 #1111](https://github.com/WiseLibs/better-sqlite3/issues/1111), [electron-builder #5317](https://github.com/electron-userland/electron-builder/issues/5317) | better-sqlite3 + Electron | App crashes at start ("compiled against a different Node.js version") | electron-builder `install-app-deps`; CI builds on Windows; smoke test packaged app | Packaged-app smoke test on clean VM | Low |
| 8 | Arabic ESC/POS | [B4X forum](https://www.b4x.com/android/forum/posts/914687), [EscPosKit](https://www.nuget.org/packages/EscPosKit), [esc_pos_utils](https://pub.dev/documentation/esc_pos_utils/latest/) | Thermal printers | Letters reversed/unjoined; code page wrong | Raster-image receipts | Print test page with Arabic, mixed digits, long names on the real printer; photo as evidence | Depends on model |
| 9 | ZATCA provider switch | [ZATCA forum](https://zatca1.discourse.group/t/guidance-on-smooth-transition-of-client-from-another-egs-provider-to-our-system/7680), [Fatoora manual](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Fatoora_Portal_User_Manual_English.pdf) | Cut-over | Revoking old CSID too early stops invoicing; revocation irreversible | Planned cut-over checklist; new EGS onboarded and tested first | Rehearsal in simulation | **PIH carry-over unclear — ask ZATCA/consultant** |
| 10 | ZATCA CSR errors | [Invalid-CSR thread](https://zatca1.discourse.group/t/assistance-required-csid-request-keeps-failing-with-invalid-csr-sandbox-developer-portal-simulation/8636) | Onboarding | CSID request fails | Follow environment-specific templates (sandbox vs simulation); keep CSR config in tests | Sandbox onboarding test | Medium |
| 11 | ZATCA 24 h reporting | [Detailed Guidelines](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf) | Simplified invoices | Offline > 24 h = late reporting | Queue with age alarm at 12 h and 20 h | Simulated outage test | Medium (depends on store internet) |
| 12 | Money/rounding | General engineering practice (no single source) | All | Float errors; line vs total VAT mismatch | Integer halalas; one documented rounding rule matching the ZATCA XML standard's business rules (to be confirmed from the standard) | Property tests + golden files | Medium until checked against SDK validation |
| 13 | Keyboard-wedge scanners | General practice; to be confirmed with the real scanner manual | USB HID scanners | Lost focus sends digits into wrong field; double scan | Global capture buffer, timing heuristic, duplicate guard | Automated: simulated keystroke bursts; manual: 50 rapid scans | Low |
| 14 | Data residency | [K&S](https://www.kslaw.com/news-and-insights/international-personal-data-transfers-under-saudi-arabias-data-protection-law), [trade.gov](https://www.trade.gov/market-intelligence/saudi-arabia-ict-cross-border-data-transfer-rules-now-under-enforcement) | Backups | Unlawful transfer abroad | Client-side encryption, in-Kingdom region preferred, client confirms | — | **Legal confirmation needed** |

Research not yet done (will be done at the start of the relevant phase, before code): exact CVE review of the pinned versions; NSIS/electron-builder update and rollback issues; Windows Defender false positives for unsigned installers; the specific scanner/printer/scale manuals; full read of the ZATCA XML and Security standards and SDK release notes.

---

## M. Test strategy and release gates

**Automated (Vitest, run in CI and locally)**
- Unit: money/VAT rounding (golden cases incl. 0.005 boundaries, inclusive→exclusive back-calc, discounts before VAT), unit conversion, scale-barcode parsing (check digit), invoice counter, state machines, retention calculator, permission matrix.
- Integration (real SQLite file): sale → payment + stock + journal + queue in one transaction; crash-injection between steps leaves nothing half-written; refund reverses all; double-submit of the same sale request gives one sale (idempotency key); journal balance invariant after 10k random operations (property test); migrations from empty and from every previous version; backup during active writes; interrupted upload; checksum mismatch; missing credentials; restore and compare.
- Security: webPreferences assertions; IPC fuzz (bad payloads rejected); no secrets in logs (log scan).
- ZATCA (later phase): generated XML validated with the official SDK in CI; sandbox round-trip.

**Manual / acceptance on real hardware** — the 14 scenarios in the master prompt §10, each recorded with date, tester, result, photo/log.

**Release gates (all must pass):** zero open critical/high defects (or your written acceptance); restore drill passed on a clean machine; every listed device has a passing test record; ZATCA flows passed for the client; installer/update/rollback tested on a clean Windows VM; accounting reports reconcile to the accountant's sample set; handover docs complete. Every test result I report will be one I actually ran.

---

## N. Phased implementation plan

| Phase | Content | Exit criteria | Fits SAR 1,500? |
|---|---|---|---|
| **0 Discovery** | Answers to §D, device photos/manuals, ZATCA status, accountant input, old-system export sample | Signed scope and device matrix | Yes (SAR 150 item) |
| **1 Foundation** | Repo, CI, Electron secure shell, SQLite + migrations, money/VAT library, users/roles/audit, catalog (barcodes, PLU, units), POS sale (scan, lookup, discounts, cash/card, hold/recall), receipts via Windows driver (raster), shifts and day-end, stock movements + GRN basic, suppliers, customers basic, low-stock + sales reports, local encrypted snapshot + restore, product/supplier CSV import dry-run, unsigned installer | All Phase 1 automated tests green; demo on dev PC; **not for live trading (no ZATCA)** | **Yes: this is what SAR 1,500 can honestly fund, and it is tight** |
| 2 Fresh food and ops | Scale (path A or B), batches/expiry, stock counts, wastage UI, refunds with credit notes, device diagnostics | Real-scale and refund tests | No |
| 3 Accounting | CoA from accountant, posting rules for all flows, AP, periods, TB/P&L/BS/VAT report | Reconciles to sample set | No |
| 4 Purchasing | PO, supplier invoice, returns, payments, price history | Purchase-to-pay test | No |
| 5 ZATCA Phase 2 | Option 1 or 2; onboarding; queue; cut-over plan | SDK + sandbox + simulation + production CSID | No |
| 6 Off-site backup | Provider setup, upload/verify, retention, restore wizard, drill | Restore drill on clean PC | No |
| 7 Migration, packaging, go-live | Final import, code signing, auto-update/rollback, training, hypercare | All release gates | No |

Dependencies: 5 needs the invoice and refund model from 1–2; 3 needs posting events from 1–4; go-live needs 5 **and** 6.

---

## O. Scope exclusions and recurring costs

**Excluded unless separately approved:** card-terminal integration, loyalty, SMS/WhatsApp/email, e-receipts, customer display, multi-terminal/multi-branch, payroll, e-commerce, AI, CCTV, three-way match, label printers, untested hardware.

**Possible recurring / third-party costs (to be quoted, not included):** cloud storage and egress; code-signing certificate (yearly); ZATCA middleware subscription if Option 2; ZATCA consultant if needed; support/maintenance (dossier mentions SAR 400–1,000/month, indicative only); hardware such as a label-printing scale.

---

## P. Definition of done (per phase and overall)

A feature is done when: it meets its acceptance test; automated tests exist and pass (run, not assumed); type check and lint are clean; there are no new critical/high audit findings; docs and changelog are updated; and for hardware or compliance features, there is recorded evidence from the real device or official validator. The **system** is done when every release gate in §M passes.

---

## Q. Decisions needed and approval request

Please answer or approve:

1. **Scope:** Approve **Phase 0 + Phase 1** as the SAR 1,500 deliverable, explicitly **not** usable for live trading until ZATCA (Phase 5) is done? Or re-quote the full scope?
2. **Stack:** Approve Electron + React + TypeScript + Vite + better-sqlite3 (SQLite ≥ 3.51.3) + Vitest/Playwright + electron-builder?
3. **ZATCA approach:** Option 1 (in-house) or Option 2 (middleware), or decide after discovery?
4. **Scale:** Label-printing scale (path A) preferred if the client has or will buy one?
5. **Money and tax rules:** Integer halalas, VAT-inclusive shelf prices, 15% standard rate, rounding rule to be fixed against the ZATCA standard and confirmed by the accountant.
6. **Negative stock:** default **warn and allow with flag** (fresh food often sells before receiving is entered)?
7. **Backup:** provider/region deferred to Phase 6; Phase 1 does local encrypted snapshots only. Approve the key-recovery design (printed recovery code; loss = backups unreadable)?
8. **Manual weight entry fallback:** allowed with supervisor PIN, or not allowed?
9. **Git:** OK to `git init` this folder and work on a feature branch after approval?

**I will not create any code, install any package or run any migration until you reply with explicit approval** (e.g. "Approved: Phase 0+1 with answers …"). If you want changes, tell me which sections to revise.
