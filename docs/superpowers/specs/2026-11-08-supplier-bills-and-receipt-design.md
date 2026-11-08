# Supplier Bills, Store Details and Customer Receipt: Design

**Date:** 2026-11-08. **Branch:** `feature/owner-tools`. **Status:** waiting for owner review.

## 1. What the owner wants

- The customer receipt must look like the store's current receipt, with the store's real details.
- Every supplier paper the store gets must be enterable: delivery note, tax invoice, proforma.
- All bill data must feed stock cost, what we owe, VAT, profit and expense numbers correctly.
- Owner answers (2026-11-08): store name is Joori; building number comes from the latest supplier bill; the owner does not know what the pack codes (CU, SU) mean.

**Assumption from that last answer:** the app must never depend on knowing a pack code. A pack is just a name plus "how many pieces inside". Staff count it once and the app remembers it.

**Success means:** three real bills entered with made-up names end on exactly the printed totals; stock, cost, supplier balance, VAT and profit all agree; the receipt prints every field of the sample.

## 2. Global constraints

Carried from the owner's standing rules. They bind every task.

- No Playwright, Puppeteer or browser automation. Do not run `npm run e2e`, `e2e/*.mjs` or `scripts/ui-shots.mjs`. Do not delete those files.
- Do not change VAT calculation on sales, ZATCA processing, invoice numbering, stock movement rules or weighted-average cost.
- No new npm packages. New migrations add only; no existing table is rebuilt.
- Money is integer halalas, quantity is integer milli-units, rounding uses `roundDiv`.
- Real store details (VAT number, CR, phone, address) are never written into code, tests, seed data, screenshots or Help. The owner types them into the new screen.
- Tests use made-up names with the bills' numbers. Bill photos are never committed.
- Tests and audits never touch the production database.
- Help teaches only what exists, in plain English. New `t()` labels get Arabic strings (the i18n test needs them). No Arabic visual checks.
- Nothing is pushed.

## 3. Findings that shape the design

| Finding | Consequence |
|---|---|
| `store_name_*` and `store_vat_number` are read but nothing writes them | Receipt header prints blank. Store details screen is needed first |
| `receipt-html.ts` CSP blocks images | Must allow `img-src data:` for the logo |
| `ReceiptData.lines` has no `lineVat` or `lineExcl`, though `sale_lines` stores them | Add to the read query. No stored data changes |
| Cost is whole halalas per piece, so 118.29 over 24 pieces gives 118.32 | See §6: split the line, stock value becomes exact |
| **Account 5010 is left out of profit and loss.** `profitAndLoss` only takes 5000, 5100 and 6000+, but the balance sheet counts every expense account | **Bug.** VAT not claimed and price differences never reach net profit, so P&L and balance sheet disagree. Fixed in build step 1 |
| `createPurchaseInvoice` already has `newLines` and `payNow`; nothing uses them | Bill entry reuses them. No new posting rules |
| `goods_receipts`, `grn_lines`, `purchase_invoices` are immutable | Detail goes in new tables |
| Suppliers can only be added | Add an edit path |

## 4. Approaches considered

1. **Add columns and more boxes to the current two forms.** Rejected: pack and discount data has no home on immutable tables, and staff still type each bill twice.
2. **New bill screen on top of the existing services, with detail in new tables. Chosen.** One entry, same accounting code, old forms keep working.
3. **Read the bill by photo (OCR).** Rejected for now: needs a new package or online service, and a misread number becomes a money error.

## 5. Data (migration 011, adds only)

**`suppliers`, new columns:** `cr_number`, `our_customer_no`, `salesman`. (`address`, `notes` exist.)

**`supplier_items`** (the app's memory): `id`, `supplier_id`, `product_id`, `supplier_code` (nullable), `pack_name` (free text, default `PCS`), `units_per_pack` (milli, > 0), `last_price` (halalas per pack), `updated_at`. Unique on (`supplier_id`, `supplier_code`) when the code exists; unique on (`supplier_id`, `product_id`, `pack_name`). Normal table, can be edited.

**`supplier_bills`** (immutable): `id`, `request_key` (unique), `supplier_id`, `doc_type` (`tax_invoice`, `delivery_note`, `proforma`, `other`), `doc_no`, `doc_date`, `delivery_date`, `sales_agent`, `pay_type` (`credit`, `cash`), `grn_id`, `bill_discount`, `bill_charge`, `paper_gross` (nullable), `paper_discount` (nullable), `paper_net`, `paper_vat`, `paper_total`, `pages`, `notes`, `user_id`, `created_at`. Unique on (`supplier_id`, `doc_type`, `doc_no`).

**`supplier_bill_lines`** (immutable): `bill_id`, `line_no`, `page_no`, `product_id`, `supplier_code`, `bill_text` (name as printed), `tariff_code`, `pack_name`, `units_per_pack`, `packs`, `loose_qty`, `free_qty`, `received_qty`, `price_basis` (`pack` or `unit`), `price`, `gross`, `discount`, `discount_bp`, `net`, `vat_rate_bp`, `vat`, `total`, `grn_line_from`, `grn_line_count`.

The bill links to its supplier invoice through `grn_id` → `purchase_invoice_grns`, so a delivery note can get its invoice later without changing an immutable row.

**Store details** use the existing `settings` table. Keys: `store_name_ar`, `store_name_en`, `store_vat_number` (existing); `store_legal_name_ar`, `store_legal_name_en`, `store_cr_number`, `store_mobile`, `store_building_no`, `store_street`, `store_district`, `store_city`, `store_postal_code`, `store_additional_no`, `store_address_line` (as printed), `store_logo` (data URL, PNG or JPEG, at most 200 KB), `store_footer_ar`, `store_footer_en`.

## 6. Calculation rules (`src/core/supplier-bill.ts`, pure, tested)

For one line:

```
billedQty = packs × unitsPerPack + looseQty
gross     = basis pack: price × (packs + looseQty / unitsPerPack), rounded
            basis unit: price × billedQty, rounded
discount  = typed amount, or round(gross × discountBp)
net       = gross − discount − share of bill discount + share of bill charge
vat       = round(net × rate), half up; staff may overtype it to match the paper
total     = net + vat
```

- Bill discount and bill charge are spread across lines by net value, largest remainder, so they land in cost.
- Checked by hand: this gives the printed VAT on all 9 lines of bill A, both of bill B, and every visible line of bill C.

**Exact stock value.** A line with value `N` halalas over `Q` milli goes in as up to two goods-receipt lines:

```
c  = floor(N × 1000 / Q)
q2 = N × 1000 − Q × c       (milli at cost c + 1)
q1 = Q − q2                 (milli at cost c)
```

Example: 118.29 over 24 pieces = 21 at 4.93 + 3 at 4.92 = 118.29 exactly. Same `receiveGoods`, same `applyMovement`, same average cost rule. `q1` or `q2` of zero means one line.

- Cost spreads over `billedQty + freeQty`, so free goods lower the cost per piece.
- A free-only line has net 0 and goes in at cost 0.
- Kg items can leave 1 halala from two half-up roundings. Bill service then passes reason `Rounding` if the difference is at most 1 halala per bill line. Any larger difference needs a typed reason.

**Short delivery.** `receivedQty` defaults to billed + free. If lower, stock takes only what arrived, at the same cost per piece, and the line value going into stock is `round(net × received ÷ (billed + free))`. The missing value becomes a difference with reason pre-filled `Short delivery`, which the staff member can edit.

## 7. How each paper posts

All through existing `receiveGoods` and `createPurchaseInvoice`.

| Paper | Stock | We owe | VAT |
|---|---|---|---|
| Tax invoice | In | Yes | Claimed by default; needs supplier VAT number |
| Delivery note | In | Not yet; held in 2100 until the invoice | Kept on bill, not posted |
| Proforma | In | Yes | Not claimed by default, counts as cost (5010). Tick to claim |
| Other paper | In | Yes | Not claimed by default |

- VAT claim is forced off when VAT is 0.
- Cash bill: `payNow` for the full total, from till or bank. Credit bill: due date from supplier terms, or typed, or no due date.
- A delivery note's later invoice uses the existing Purchases form. The form pre-fills net and VAT from the saved bill.
- Permissions are the existing ones: `stock.receive`, plus `purchase.manage` for anything that creates a payable, plus `purchase.pay` for cash bills.

## 8. Screens

**Enter supplier bill** (new, Purchases tab, full-width):

- Header: supplier (shows VAT number), paper type, number, paper date, delivery date, sales agent, cash or credit, pages.
- Add line by supplier code, barcode or name. A known code fills product, pack name, pack size and last price.
- Line row: code, product, pack name, pieces in pack, packs, loose, free, received, price (pack or piece), discount (amount or %), VAT %, VAT, net, total, cost per piece, page.
- Unknown product: small New product form on the same screen, needs `product.manage`.
- Bottom: live sum of lines beside boxes for the paper's gross, discount, net, VAT and total, with the gap shown. **Save stays off until net, VAT and total match exactly.** Gross and discount boxes are optional, because not every paper prints them; when typed they must match too.
- Warnings before save, each needs a tick: cost per piece above shelf price excl. VAT; cost more than 30% away from current average cost (this catches a wrong pack size).
- Draft kept in `localStorage` so a long bill survives a closed tab.

**Saved bills** (new, Purchases tab): list by date and supplier, open one to see every line, print on A4 through the existing print path.

**Purchase reports** (Purchases tab): price history for a product across suppliers; purchases by supplier for a period (gross, discount, net, VAT, total).

**Store details** (new, Admin, `settings.manage`): all keys in §5, logo picker, live receipt preview, audited. VAT must match `^3\d{13}3$`.

**Supplier card** (Admin): edit all fields, `supplier.update`, audited, `supplier.manage`. CSV import gains optional columns.

## 9. Receipt layout

Uses only stored values. In order:

Logo · Arabic name · English name · legal name · address line · VAT No. · CR · Mobile · title **Simplified Tax Invoice / فاتورة ضريبية مبسطة** · the line `TEST BUILD — NOT A ZATCA TAX INVOICE` (stays until ZATCA is done) · invoice no. · date · customer and customer VAT when present · payment type · cashier · lines with `# / Item`, then `Qty / Rate / VAT / Total`, where Rate is excl. VAT · before VAT · discount · VAT 15% · grand total · cash paid · change · on-account block · thank-you line in Arabic and English · "VAT Included".

- Rate shown is `lineExcl ÷ qty`, display only.
- Faults on the old receipt are not copied: wrong paid and change, wrong Arabic label under the VAT number.
- Refund slip and payment receipt use the same header.
- No QR. That comes with the ZATCA job.

## 10. Errors and edge cases

| Case | Result |
|---|---|
| Double click on save | `request_key` returns the first save |
| Same paper entered twice | Refused, names the earlier bill |
| Pack size 0 or blank | Refused |
| Discount above gross | Refused |
| Paper totals do not match | Save stays off, gap shown |
| Till payment with no open shift | Existing refusal; nothing saved |
| Failure anywhere in save | One transaction, nothing is kept |
| Logo over 200 KB or not an image | Refused with a message |
| Same product twice on a bill | Allowed, each line stands alone |

## 11. Tests (made-up names, same numbers)

- **Bill A (snacks), page 1:** 9 lines end 532.86 / 32.48 / 500.38 / 75.07 / 575.45. Delivery note: stock up, 2100 up, nothing owed.
- **Bill B (juice):** 2 lines, packs of 24, end 341.01 / 51.15 / 392.16. Stock value exactly 341.01, 5010 stays 0, supplier owed 392.16.
- **Bill C (dairy):** loose pieces from cases, cash, proforma. VAT lands in 5010 and is not input VAT.
- Free goods lower the average cost. Short delivery creates the difference.
- P&L net profit equals balance-sheet current earnings when 5010 is not zero.
- VAT summary still reconciles after each bill type.
- `npm run typecheck`, `lint`, `test`, `build`, `ui-audit` with new screens added. Real print-to-file check using `POS_RECEIPT_TO_FILE`.

## 12. Not in this round

- ZATCA QR and Phase 2. Separate job, needs go-ahead.
- Reversing a saved wrong receipt. New stock-reversal rule, needs its own design. Until then the fix is a supplier return or a stock count.
- Supplier credit note for a shortage with no stock going back.
- Claiming VAT later on a proforma after it was saved as not claimed.
- Reading bills by photo.

## 13. Build order

1. P&L fix for 5010.
2. Store details and receipt.
3. Supplier card.
4. Migration, pure calculation, bill service.
5. Bill entry screen.
6. Saved bills, reports, invoice pre-fill.
7. Help guides, manual, full verification, whole-branch review.
