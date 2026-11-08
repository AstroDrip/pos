# Supplier Bills, Store Details and Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (owner chose Native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter any supplier paper line by line with exact stock cost, set the store's details once, and print the store's receipt layout.

**Architecture:** Pure maths in `src/core/supplier-bill.ts`. One new service, `src/services/supplier-bills.ts`, saves detail in new immutable tables and calls the existing `receiveGoods` and `createPurchaseInvoice`, so no posting rule is new. Store details use the `settings` table.

**Tech Stack:** Electron 45, React 19, TypeScript, better-sqlite3, zod, Vitest. No new packages.

**Spec:** `docs/superpowers/specs/2026-11-08-supplier-bills-and-receipt-design.md`

## Global Constraints

- No Playwright, Puppeteer or browser automation. Do not run `npm run e2e`, `e2e/*.mjs` or `scripts/ui-shots.mjs`. Do not delete those files.
- Do not change sales VAT calculation, ZATCA processing, invoice numbering, stock movement rules or weighted-average cost.
- No new npm packages. Migrations only add; never edit a shipped migration.
- Money is integer halalas, quantity integer milli-units, rounding with `roundDiv`.
- Real store details are never in code, tests, seed data, screenshots or Help.
- Tests use made-up names with the bills' numbers. Bill photos are never committed.
- Tests and audits never touch the production database.
- New `t()` labels get Arabic strings. No Arabic visual checks. Help is plain English and teaches only what exists.
- Nothing is pushed. Every commit ends with the attribution line given by the session.
- Every new channel goes in `src/shared/ipc.ts`, `src/main/handlers.ts` and `src/preload/preload.ts`.

## Review Focus

1. A pack size typed wrong (24 entered as 2): the cost warning must appear before saving. Pinned in Task 5.
2. Paid bill with till chosen and no open shift: refused, and no stock, invoice or bill row is kept. Pinned in Task 4.
3. Same supplier code mapped to a second product: refused with the name of the first. Pinned in Task 4.
4. Kg item with a fractional quantity: stock value within 1 halala, no typed reason needed. Pinned in Task 3.
5. Logo over 200 KB or a non-image file: refused; receipt still prints. Pinned in Task 2.

---

### Task 1: Count 5010 in profit and loss

**Files:** Modify `src/services/financials.ts` (the `operating` filter in `profitAndLoss`). Test: `src/services/purchasing.test.ts`.

**Interfaces:** Produces no new names.

- [ ] **Step 1: Write the failing test** `'profit and loss includes purchase differences and unclaimed VAT (5010)'`. Post a supplier invoice with non-recoverable VAT 60.00. Assert `profitAndLoss(...).operating` has a row with `code: '5010', amount: 6000`, and `netProfit` equals the balance sheet's current earnings for the same date.
- [ ] **Step 2: Run** `npx vitest run src/services/purchasing.test.ts`. Expected: FAIL, no 5010 row.
- [ ] **Step 3: Add** `a.code === '5010'` to the filter.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(finance): purchase differences and unclaimed VAT reach profit and loss`.

### Task 2: Store details and receipt

**Files:** Create `src/services/store-details.ts`, `src/services/store-details.test.ts`, `src/main/receipt-html.test.ts`. Modify `src/main/receipt-html.ts`, `src/main/main.ts:46-62`, `src/services/sales.ts:215,243`, `src/renderer/Admin.tsx`, `src/renderer/i18n.tsx`, ipc, handlers, preload.

**Interfaces:**
- Produces: `interface StoreDetails { nameAr, nameEn, legalNameAr, legalNameEn, vatNumber, crNumber, mobile, buildingNo, street, district, city, postalCode, additionalNo, addressLine, logo, footerAr, footerEn: string }`; `getStoreDetails(ctx: Ctx): StoreDetails`; `saveStoreDetails(ctx: Ctx, userId: number, d: StoreDetails): void` (needs `settings.manage`, audited as `settings.store_details`, keys per spec §5); `receiptHtml(r: ReceiptData, store: StoreDetails, copy: boolean): string`.
- Channels: `store.get` (null), `store.save` (StoreDetails).

- [ ] **Step 1: Write failing tests.** `store-details.test.ts`: `'saves and reads every field'`; `'refuses a bad VAT number'` (`123`); `'needs settings.manage'` (cashier throws); `'refuses a logo over 200 KB or not PNG/JPEG'` (`data:image/gif;base64,AA` and a 300 KB data URL). `receipt-html.test.ts` with fictional store: `'prints every header field in order'` (name, legal name, address, VAT, CR, mobile appear in that order); `'keeps the TEST BUILD line and the Simplified Tax Invoice title'`; `'shows Rate excl. VAT and line VAT'` (qty 1000, lineExcl 783, lineVat 117, lineIncl 900 prints `7.83`, `1.17`, `9.00`); `'shows real cash paid and change'` (cash 2000 of 1350 prints `20.00` and `6.50`); `'shows discount total, thank-you and VAT Included'`; `'still prints with no logo and blank details'`.
- [ ] **Step 2: Run** `npx vitest run src/services/store-details.test.ts src/main/receipt-html.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement.** Add `lineVat`, `lineExcl` to `ReceiptData.lines` and its query. Rate = `roundDiv(lineExcl * 1000, qty)`. Follow spec §9 order. CSP gains `img-src data:`. Refund and payment slips use the same header. Admin card under `settings.manage` with file picker (`FileReader`, data URL) and a live preview through `receiptHtml`-matching fields.
- [ ] **Step 4: Run** the same command, then `POS_RECEIPT_TO_FILE` check is covered in Task 7. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store): store details screen and full receipt layout`.

### Task 3: Bill maths

**Files:** Create `src/core/supplier-bill.ts`, `src/core/supplier-bill.test.ts`.

**Interfaces:**
- Produces:
  - `interface BillLineInput { unitsPerPack: number; packs: number; looseQty: number; freeQty: number; receivedQty?: number; priceBasis: 'pack' | 'unit'; price: number; discountAmount?: number; discountBp?: number; vatRateBp: number; vatOverride?: number }`
  - `interface BillLineResult { billedQty; gross; discount; net; vat; total; costQty; stockQty; stockValue: number }`
  - `computeBill(lines: BillLineInput[], billDiscount: number, billCharge: number): { lines: BillLineResult[]; gross; discount; net; vat; total: number }`
  - `splitCost(value: number, qty: number): { qty: number; unitCost: number }[]`

- [ ] **Step 1: Write failing tests.** `'snack page: 532.86 / 32.48 / 500.38 / 75.07 / 575.45'` using these 9 lines, as price (halalas) × packs, discount amount: 1455×3, 131; 6020×1, 181; 4380×1, 790; 2346×2, 141; 938×4, 113; 7440×2, 1436; 6192×1, 186; 922×5, 138; 879×5, 132; all at 15%. `'juice bill: 341.01 / 51.15 / 392.16'` (packs 2 at 11136, packs 1 at 11829, unitsPerPack 24000). `'dairy loose pieces: 0 cases + 5 at 82.60 per 20 = 20.65'`. `'VAT rounds half up per line and can be overtyped'`. `'bill discount and charge spread by value, largest remainder, sums exact'`. `'free goods lower the cost'`: 10 paid + 2 free, net 1200, `costQty` 12000. `'short delivery'`: received 9 of 10, `stockValue` = round(net × 9 / 10). `'splitCost: 118.29 over 24 = 21 at 493 + 3 at 492'`. `'splitCost: exact division gives one row'`. `'splitCost: value 0 gives cost 0'`. `'splitCost: kg 1.234 for 7.77 stays within 1 halala'`. `'refuses pack size 0 and discount above gross'`.
- [ ] **Step 2: Run** `npx vitest run src/core/supplier-bill.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** per spec §6. Gross on pack basis = `roundDiv(price * billedQty, unitsPerPack)`.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(bills): line maths and exact cost split`.

### Task 4: Data, supplier card and bill service

**Files:** Create `src/db/migrations/011_supplier_bills.ts`, `src/services/supplier-bills.ts`, `src/services/supplier-bills.test.ts`. Modify `src/db/migrations.ts`, `src/services/parties.ts`, `src/services/import.ts`, `src/renderer/Admin.tsx`, ipc, handlers, preload.

**Interfaces:**
- Consumes: `computeBill`, `splitCost`; `receiveGoods`; `createPurchaseInvoice`.
- Produces:
  - `updateSupplier(ctx, userId, id: number, input: SupplierFields): void` (`supplier.manage`, audited); `SupplierFields` = name, phone, vatNumber, paymentTermsDays, address, crNumber, ourCustomerNo, salesman, active.
  - `interface SupplierBillInput { requestKey: string; supplierId: number; docType: 'tax_invoice'|'delivery_note'|'proforma'|'other'; docNo: string; docDate: string; deliveryDate?: string; salesAgent?: string; payType: 'paid'|'credit'; payMethod?: 'till'|'bank'; paidNow?: number; dueDate?: string; noDueDate?: boolean; claimVat?: boolean; pages: number; billDiscount: number; billCharge: number; paper: { gross?: number; discount?: number; net: number; vat: number; total: number }; differenceReason?: string; supplierVatNo?: string; notes?: string; lines: (BillLineInput & { productId: number; supplierCode?: string; billText?: string; tariffCode?: string; packName: string; pageNo: number })[] }`
  - `createSupplierBill(ctx, userId, input): { billId: number; grnNo: string; pinvNo: string | null; replayed: boolean }`
  - `findSupplierItem(ctx, supplierId: number, code: string)`; `supplierItemsFor(ctx, supplierId: number)`; `getBill(ctx, userId, id: number)`; `listBills(ctx, userId, from: string, to: string)`; `priceHistory(ctx, userId, productId: number)`; `purchasesBySupplier(ctx, userId, from: string, to: string)`.
  - Channels: `supplier.update`, `bill.create`, `bill.item`, `bill.items`, `bill.get`, `bill.list`, `bill.priceHistory`, `bill.bySupplier`.

- [ ] **Step 1: Write failing tests** with made-up suppliers. `'tax invoice on credit: stock, 2100 cleared, owed 392.16, stock value exactly 341.01, 5010 is 0'`. `'paid bill: payment for the full total, nothing owed'`. `'part paid on credit leaves the rest owed'`. `'delivery note: stock in, 2100 up, nothing owed, VAT not posted'`. `'proforma: VAT in 5010, not 2210, unless claimVat'`. `'VAT summary reconciles after each paper type'`. `'totals not matching the paper are refused'`. `'same paper twice is refused and names the first'`. `'double save returns the first bill'`. `'paid from till with no shift keeps nothing'` (no rows in `supplier_bills`, `goods_receipts`, `stock_movements`). `'remembers code, pack and price for next time'`. `'a supplier code on a second product is refused'`. `'short delivery uses reason and posts the gap to 5010'`. `'free goods lower average cost'`. `'updateSupplier saves all fields, needs supplier.manage, is audited'`. `'CSV import takes the new optional columns'`.
- [ ] **Step 2: Run** `npx vitest run src/services/supplier-bills.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** tables per spec §5, posting per spec §7, in one transaction. Register migration 11 as `supplier_bills`. Rounding reason `Rounding` only when the difference is at most 1 halala per bill line.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, including `migrations.test.ts`.
- [ ] **Step 5: Commit** `feat(bills): tables, supplier card and bill service`.

### Task 5: Bill entry screen

**Files:** Create `src/renderer/SupplierBill.tsx`, `src/core/bill-warnings.ts`, `src/core/bill-warnings.test.ts`. Modify `src/renderer/Purchases.tsx` (new section `bill`, first for `purchase.manage`), `src/renderer/keyboard-registry.ts` if a Purchases search marker changes, `src/renderer/i18n.tsx`.

**Interfaces:**
- Consumes: `computeBill`, channels from Task 4.
- Produces: `billWarnings(line: { costPerUnit: number; avgCost: number; shelfExcl: number; hasStock: boolean }): ('above_shelf'|'far_from_average')[]`.

- [ ] **Step 1: Write failing tests.** `'cost above shelf price excl. VAT warns'`; `'24 entered as 2 warns far from average'` (avg 493, cost 5915); `'within 30% does not warn'`; `'no stock yet skips the average warning'`.
- [ ] **Step 2: Run** `npx vitest run src/core/bill-warnings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen per spec §8. Paper date and delivery date default today. Required Paid or Credit choice, hidden for delivery note. Add by code, barcode or name with `data-kb-search="product"`. Draft in `localStorage` key `pos.billDraft`, cleared on save. Save disabled until net, VAT and total match, and warnings are ticked.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(bills): enter supplier bill screen`.

### Task 6: Saved bills, reports, invoice pre-fill

**Files:** Modify `src/renderer/Purchases.tsx`, `src/services/purchasing.ts` (`uninvoicedGrns`), `src/renderer/i18n.tsx`. Test: `src/services/supplier-bills.test.ts`.

**Interfaces:**
- Consumes: Task 4 channels.
- Produces: `UninvoicedGrn` gains `paperNet: number | null; paperVat: number | null`.

- [ ] **Step 1: Write failing tests.** `'a delivery note receipt offers its net and VAT'`; `'a receipt with no bill offers null'`; `'price history is newest first across suppliers'`; `'purchases by supplier adds up for a period'`.
- [ ] **Step 2: Run** `npx vitest run src/services/supplier-bills.test.ts`. Expected: the four FAIL.
- [ ] **Step 3: Implement** the query change; sections Saved bills and Purchase reports; A4 print with `window.print()`; invoice form pre-fills from `paperNet` and `paperVat`.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(bills): saved bills, price history, purchases by supplier`.

### Task 7: Help, manual, full check, review

**Files:** Modify `src/renderer/help/content.ts`, `docs/user-guide/POS_USER_MANUAL.md` (generated), `src/main/ui-audit.ts`, `scripts/ui-seed.mjs`, `src/renderer/keyboard-registry.ts` (`CONTEXT_HELP.purchases`).

- [ ] **Step 1: Add** Help guides `suppliers-enter-bill`, `admin-store-details`, `suppliers-edit`, each with exact screen labels.
- [ ] **Step 2: Add** real-app flows to `ui-audit.ts`: `store-details-on-receipt` (fictional details, print to file), `bill-juice-ends-exact`, `bill-save-off-until-match`.
- [ ] **Step 3: Run** `npm run manual`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run ui-audit -- ui-audit/bills`. Expected: all exit 0, 0 findings, every flow ok.
- [ ] **Step 4: Commit** `docs(help): supplier bills and store details`.
- [ ] **Step 5: Fresh whole-branch review** per executing-plans; each fix test-first.
