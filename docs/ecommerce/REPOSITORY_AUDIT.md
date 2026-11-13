# Repository audit for the e-commerce extension

Status: proposal, waiting for approval. Written 2026-11-10. Read-only audit. No code was changed.

## 1. What was audited

| Item | Value |
|---|---|
| Branch | `feature/owner-tools` |
| Local commit audited | `e2f37cb` |
| `origin/main` | `64ef787`, the commit named in the master prompt |
| Gap | Local code is 18 commits ahead of `origin/main` |
| Uncommitted work | 9 files, all the no-password demo change in `dashboard/` and its report |

The plan is based on the local code, because that is the newest. The 18 commits include VAT review, prepaid expenses, cloud backup, the owner dashboard and the UI redesign. None of them is on GitHub `main` yet.

How far this audit went: the schema, stock, sales, refund, catalogue, sync, report and permission code was read where it affects this project. It was not a line-by-line review of every file. Section 12 lists what is still unconfirmed.

## 2. Main findings

1. **The POS cannot issue a legal invoice yet.** `src/main/receipt-html.ts` prints "TEST BUILD — NOT A ZATCA TAX INVOICE". `docs/ZATCA_CONTINUITY_PLAN.md` says no ZATCA code exists. An online sale cannot go live until ZATCA Phase 2 is finished, because every online sale becomes a POS invoice.
2. **Product categories exist in the schema but are not used.** `products.category_id` and the `categories` table exist. `catalog.ts` and `Products.tsx` never set them. All categories in the UI today are expense categories, which are separate.
3. **Products have no photo, description or publication fields.** These are new, and belong to the web side.
4. **Tenders are `cash`, `card` and `account`, enforced by a CHECK constraint.** A new tender needs a table rebuild, as migration 010 did.
5. **Refunds are cash only.** `refunds.tender` is CHECK `('cash')`. Owner decision D1 pays refunds from the open shift's drawer, even for card sales. Online refunds need a separate path.
6. **Every product is a stock item.** `sell_mode` is `unit` or `weight`. `finalizeSale` calls `applyMovement` for every line. A delivery fee line has no valid product kind.
7. **A sale needs an open shift and a user.** `sales.shift_id` and `sales.user_id` are NOT NULL, and `finalizeSale` throws `NO_OPEN_SHIFT`. A background job cannot create a sale, so a person must do it at the POS.
8. **The POS can sell below zero.** The default for `negative_stock_policy` is `allow`. The online system cannot assume the POS stops at zero.
9. **The cloud job runs every 5 minutes.** That is too slow for orders. Commerce needs its own loop.

## 3. Directories that matter

| Path | Purpose | Relation to this project |
|---|---|---|
| `src/core/` | Pure money, VAT, date and scale code | Reused, not copied |
| `src/services/` | POS domain services | Extended in a few named places |
| `src/db/migrations/` | SQLite migrations, up to 017 | New migrations from 018 |
| `src/main/`, `src/preload/` | Electron main, IPC allowlist | New handlers for the Online orders tab |
| `src/renderer/` | Desktop UI | New Online orders tab, category picker |
| `dashboard/` | Read-only owner phone dashboard, Next.js | Stays separate, pattern reused |
| `e2e/` | Old Playwright tests | Left alone, not run |
| `docs/` | Plans and reports | New `docs/ecommerce/` |

## 4. Dependency versions found

| Package | Version | Where |
|---|---|---|
| electron | 45.2.2 | POS |
| vitest | 5.0.5 | POS |
| next | 16.4.5 | `dashboard/` |
| react, react-dom | 19.3.1 | `dashboard/` |
| zod | 4.6.7 | `dashboard/` |
| @neondatabase/serverless | 1.2.0 | `dashboard/` |
| @electric-sql/pglite | 0.5.15 | `dashboard/` tests |

`dashboard/` uses plain CSS in `globals.css`. Nothing in the repo uses Tailwind yet.

## 5. Products and categories

| Table | Important fields |
|---|---|
| `products` | `id`, `sku` (unique), `name_ar`, `name_en`, `category_id`, `unit_id`, `sell_mode` (`unit`, `weight`), `vat_rate_bp`, `price_incl`, `reorder_level`, `active`, `updated_at` |
| `product_barcodes` | `barcode` (primary key), `product_id`, `qty_per_scan` |
| `plu_codes` | Scale codes |
| `categories` | `id`, `name_ar`, `name_en`. No parent, so no subcategories |

In `catalog.ts`, `createProduct`, `setPrice`, `setProductActive` and `setAliases` are the write paths. Only price and active update `updated_at`. Adding a barcode does not. So `updated_at` is not a safe change signal, and this plan uses database triggers instead (see `DATA_OWNERSHIP_AND_SYNC.md`).

Weighed goods use pre-weighed scale labels (`core/scale-barcode.ts`, `core/scale-layout.ts`, ADR-3). There is no live weighing.

## 6. Stock

- `stock_movements` is the ledger. Reasons are `sale`, `refund`, `grn`, `purchase_return`, `waste`, `count_adj`, `opening`. It has `UNIQUE (source_type, source_id, source_line)`.
- `stock_balances` holds `qty` and `avg_cost` for each product.
- `applyMovement` in `services/inventory.ts` is the single write path. It returns `wentNegative`, and blocks only if the policy is `block`.
- Quantities are milli-units. Money is integer halalas.

## 7. Sales, refunds and purchasing

- `finalizeSale` in `services/sales.ts`: prices come from the server, totals from `computeInvoice`, one `idempotency_key` per sale, invoice number from `invoice_counters` series `SALE`, a journal entry through `postEntry`, and an audit record.
- Journal accounts used: `1010` cash, `1020` card clearing, `1100` receivables, `4000` sales, `2200` VAT, `5000` cost of sales, `1200` inventory. Account `2300` customer advances also exists.
- `services/refunds.ts`: refund against an original invoice, within `refund_max_days` (7), with supervisor approval.
- `services/purchasing.ts`: goods receipts go through `applyMovement`, so they produce movements the sync can read.

## 8. Permissions, login and audit

- `permissions` and `role_permissions`, with roles `admin`, `supervisor`, `cashier`. Services call `requirePermission`.
- 17 base permission codes, such as `sale.create`, `product.manage`, `stock.adjust`, `reports.view`.
- `appendAudit` writes a hash-chained audit log.
- IPC is allowlisted in three places: `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`.
- `dashboard/` has its own login. Its no-password path is a demo convenience and must not be carried to staff admin.

## 9. Existing sync

| Piece | What it does | Decision |
|---|---|---|
| `sync_outbox`, `sync_state` (migration 008) | Queue of read-only snapshots, newest wins per key | Not reused |
| `dashboard-sync.ts` | `buildSnapshots`, `enqueueSnapshots`, `syncOnce`, `compactOutbox` | Not reused. Compaction drops history, which commerce must never do |
| `cloud-client.ts` | `makeCloudApi`, typed errors, injectable fetch | Reused as a pattern |
| `cloud-jobs.ts` | `cloudTick` on a 5-minute timer in `main.ts` | Left alone |
| `dashboard/src/server/device-core.ts` | Enrolment, device bearer credential, rate limits | Reused as a pattern, with a separate credential |

## 10. Tests

| Suite | Size | Last known result |
|---|---|---|
| POS vitest | 65 test files | 774 of 774 passed, 2026-11-10 |
| Dashboard vitest | 5 test files | 72 of 72 passed |
| `npm run ui-audit` | Real Electron run | 54 screens, 0 findings, 111 of 111 flows |
| `e2e/` | 3 files | Not run. Playwright is banned for this work and the files stay |

`phase1b.test.ts` `rollBackToV1` must be extended for each new migration.

## 11. Existing code: reuse, extend, leave alone

| Reuse as is | Extend in named places | Leave untouched |
|---|---|---|
| `src/core/vat.ts`, `src/core/money.ts` | `sales.ts` (new tender, service lines) | `core/vat.ts` logic |
| `applyMovement` | `refunds.ts` (separate online path) | Invoice counters |
| `postEntry`, `appendAudit` | `catalog.ts` (set category) | `applyMovement` rules |
| `requirePermission` | `reports.ts`, `series.ts` (channel) | `dashboard-sync.ts`, `dashboard/` |
| Scale barcode reading | `integrity.ts` (online tender) | Cloud backup |
| Device enrolment pattern | `main.ts` (new timer, restore marker) | Hardware and printing |

## 12. Still unconfirmed

- How far `import.ts` writes to `products` outside `catalog.ts`. Triggers cover this either way.
- Whether Next.js can import `../src/core` when deployed from `store/`. This is a Phase A check, and a fallback is written in `ARCHITECTURE_PROPOSAL.md`.
- Payment provider details, listed in `OPEN_DECISIONS.md`.

Arabic wording, RTL and Arabic receipts were not checked. This is explicitly deferred under the standing rule.
