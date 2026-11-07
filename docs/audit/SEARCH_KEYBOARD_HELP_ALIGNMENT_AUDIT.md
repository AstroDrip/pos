# Phase 0 Audit: Search, Keyboard, Quantity, Help, Alignment

- **Date:** 2026-11-07.
- **Branch:** `feature/owner-tools` @ `3ffe8a4`.
- **Spec:** `docs/superpowers/specs/2026-11-07-search-keys-help-alignment-design.md`.
- **Plan:** `docs/superpowers/plans/2026-11-07-search-keys-help-alignment.md`.

This audit only reads the code. Nothing was changed while writing it.

## 1. Where search exists

| Place | Front end | Service | Minimum today | Order today |
|---|---|---|---|---|
| POS product box | `SearchBox.tsx` (200 ms debounce, stale guard, IME guard) | `catalog.suggest` → `searchProducts` (`services/search.ts`) | Names: 3 Latin / 2 Arabic letters (`minNameChars`, `core/search-normalize.ts`). Codes: none | Match level 1–7, then shorter name, then A–Z |
| Products tab picker | `Products.tsx:18` | `catalog.search` → `searchProducts` | Same | Same |
| Stock: receive, wastage, count | `Stock.tsx:35`, `Stock.tsx:152` | `catalog.search` | Same | Same |
| Purchases: supplier return | `Purchases.tsx:179` | `catalog.search` | Same | Same |
| Customers tab | `Customers.tsx` | `credit.find` → `findCreditCustomers` (`services/credit.ts:497`) | 1 character | Name A–Z |
| Sell: customer box | `Sell.tsx` | `customer.find` → `findCustomers` (`services/parties.ts`), plus `credit.find` for the credit panel | 1 character, on Enter | Phone/name LIKE |
| Suppliers | Drop-down `<select>` lists | `supplier.list` | — | — (no free-text search; left unchanged) |
| Refund | Receipt number box | `findSaleForRefund` (exact) | Exact | — (exact lookup is correct; left unchanged) |
| Expenses | Payee/description filter | Local filter | 1 character | — |
| Help | Does not exist yet | — | — | — |

**Indexes available:**
- B-tree on `products.name_en_norm` and `name_ar_norm`; this makes "starts with" a range scan;
- unique `sku`;
- `product_barcodes.barcode`;
- `plu_codes.plu`;
- FTS5 `product_fts` with `prefix='2 3'`;
- `sales.created_at`.

**Data for popularity:**
- `sales` rows are always finalised sales. There are no drafts, and immutability triggers protect them.
- `sale_lines` holds one row per product per sale.
- `refunds` / `refund_lines` link back through `original_sale_id` and `sale_line_no`.
- Held bills live in their own table and are not sales.

## 2. Cart quantity paths (`Sell.tsx`)

- **`addLine(product, qty, scanCode)`** (line ~113):
  - unit products merge into the existing line (+qty);
  - it records `lastUnitProduct`;
  - weighed lines from scale labels keep their own line, with `scanCode`.
- **`incLast`** (line ~147): `+` on the empty search box adds 1 to the last unit product.
- **Quantity step:** the `qty` field. `parseStepQty` checks it (whole units for unit items; weight entry is blocked, owner decision Q-8); `incrementQtyText` handles `+`.
- **Qty cell** (line ~389): display only. There is **no way to lower a quantity** except removing the line with ✕ and adding it again.
- **`removeLines(kind, idx)`:** writes an audit record through `bill.removed` (`line_removed` / `bill_cleared`).
- **Totals:** computed with `computeInvoice` (`core/vat.ts`). It must stay the only place totals come from.

## 3. Keys (`renderer/checkout-keys.ts`, `decideKey`)

| Step | Key | Action |
|---|---|---|
| search (empty box) | Enter | open payment (needs items, not busy, 350 ms guard) |
| search (empty box) | `+` | add 1 to the last unit line |
| qty | `+` / Enter / Esc | +1 / confirm / back |
| pay | Enter in cash / card-part / Ctrl+Enter / Esc | pay cash / move to cash / pay card / back |

Auto-repeat Enter and `+` are swallowed. **Missing:** `-`, Shift+Enter, IME awareness in `decideKey` (`SearchBox` itself already guards composition).

## 4. Feature inventory for the Help Centre

Help must teach only what exists.

| Tab (who sees it) | What exists | Not built / not to be taught |
|---|---|---|
| Log in | Username + PIN; first-time owner setup | — |
| Sell (all) | Open shift with float; search/scan; scale labels; `+`, Enter, Ctrl+Enter; line discount (permission); remove line; clear bill; hold/recall bill; customer box; cash, card, split; credit sale with supervisor approval over the limit; receipt print | Typing a weight (Q-8) |
| Refund (all) | Find by receipt number; choose lines and qty; restock; reason; supervisor approval; cash refund within 7 days; a refund on a credit sale reduces the customer's debt first | Refunds without a receipt; card refunds |
| Customers (`customer.payment.record`) | Find/add customer; credit settings (limit); account with statement, invoices, ageing; receive a payment with allocation; advance; dispute; write-off (permission); CSV copy | — |
| Stock (`stock.receive`) | Receive goods (with cost); stock on hand; record wastage; stock count | — |
| Products (`product.manage`) | New product (names, SKU, barcode, PLU, unit or weight, VAT, price); edit; aliases; deactivate | Label/sticker printing |
| Purchases (`purchase.view`) | Supplier invoice from received goods; pay supplier with allocation, partial payment, advance; return goods to a supplier; what we owe; supplier statement | — |
| Expenses (`expense.view`) | New expense (category, VAT class); pay; recurring expenses; drafts | — |
| Accounting (`finance.view`) | Owner overview; profit and loss; VAT summary; balance sheet; trial balance; ledgers | VAT return filing; ZATCA submission |
| Reports (`reports.view`) | Sales, refunds (credit notes), cashiers, stock changes by date | — |
| Shift (all) | Shift summary; cash in/out; close shift with counted cash | — |
| Admin (`backup.run`) | Backup now and status; restore from backup; users and roles; suppliers; CSV import; scale-label layouts; owner dashboard settings | The owner phone dashboard itself (not built) |

**Scenarios A–J (from the master prompt):** all of them map onto existing features.
- A, Sell: normal payment.
- B, Sell: credit sale.
- C, Customers: partial payment.
- D, Refund: a customer returns goods.
- E, Stock + Purchases: a supplier delivers now and is paid later.
- F, Purchases: a supplier is paid part of the bill.
- G, Sell: the wrong quantity was scanned (`+`/`−`/typed).
- H, Sell: the product cannot be found.
- I, Sell: the wrong product was picked (✕).
- J, Accounting + Reports + Shift: checking the day.

"Owner dashboard" in scenario J is explained as the **Accounting → Owner overview** screen, because the phone dashboard is not built.

## 5. Alignment audit scope

**Screens:**
- Login.
- Sell in three states: empty, 3 lines, payment step.
- Refund.
- Customers with an account open.
- Stock, Products, Purchases, Expenses, Accounting, Reports, Shift, Admin.
- Help, once built.

**Variants:**
- light, English, 1366×768;
- dark, English, 1366×768;
- light, Arabic, 1366×768;
- light, English, 1024×700.

**Tooling:** Electron's own `capturePage`, `executeJavaScript` and `sendInputEvent`, behind `POS_UI_AUDIT`, only in unpackaged builds. No Playwright.

## 6. Scripts that must not be run for this task

| Script | Why |
|---|---|
| `npm run e2e` → `e2e/smoke.mjs` | Uses `playwright-core` |
| `e2e/installer.mjs`, `e2e/packaged.mjs` | Use `playwright-core` |
| `scripts/ui-shots.mjs` | Uses `playwright-core` |

**Allowed:** `typecheck`, `lint`, `test` (Vitest), `build`, `start`, `scripts/search-bench.cjs`, and the new `ui-audit` script.

The Playwright files stay in the repo unchanged. The only edit is that `ui-shots.mjs` imports its seed function from the new shared `ui-seed.mjs`.

## 7. Task ledger

| Task | Status | Evidence |
|---|---|---|
| T0 Phase 0 audit | done | this file |
| T1 Geometry checks | pending | |
| T2 Electron audit runner, "before" captures | pending | |
| T3 Demand score | pending | |
| T4 First-character search | pending | |
| T5 Customer ranking | pending | |
| T6 Shared suggestion hook | pending | |
| T7 `[−] qty [+]` with undo | pending | |
| T8 `-` key and Shift+Enter | pending | |
| T9 Help content and manual | pending | |
| T10 Help tab and links | pending | |
| T11 Alignment fixes, "after" captures | pending | |
| T12 Verification, reports, review | pending | |
