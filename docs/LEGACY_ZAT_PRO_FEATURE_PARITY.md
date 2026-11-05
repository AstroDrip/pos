# Legacy ZAT Pro: Feature Parity

Date: 2026-11-05. New POS state: branch `feature/owner-tools` @ `f5172e2`.

## 1. What was examined, and how far it can be trusted

**Source:** `Downloads/zat.zip` (269 MB, 472 entries). It is a copy of the old program folder `ZATPro/`.

| Content | Count | Used as evidence of |
|---|---|---|
| Program versions `ZAT Pro*.exe` (2020-08 → 2022-03, plus an undated `ZAT Pro.exe`) | 24 | Screens (form names) and database features, read as text strings only, **never run** |
| FastReport templates `ZATREPORT/*.frx` | 70 | Report layouts and the fields they use |
| Daily error logs `Log/*.log` (2024-12-02 → 2025-10-06) | 307 | Which screens actually ran in 2025. They log **errors only**, so "not in the logs" ≠ "not used" |
| Scale export `ZATWmachine.csv` | 13 rows | Scale keys with 5-digit item codes, price 0 on the scale |
| `PriceCode.ini`, `PriceCodeSticker.ini` | 2 | A digit-to-letter code (1=A … 9=I, 0=X) printed on stickers to hide the cost price |
| `Printlog.dat` | 1 | Print-settings errors from 2023–2024 (Sales Report, a purchase list) |
| Libraries: FastReport, QRCoder, ZXing, BarcodeLib, iTextSharp, SQL Server SMO, MySQL, RestSharp, APIManager, APIManagerGST | 38 | Technology only |

**Deliberately not opened:** `ServerCredentials.ini`, `ServerName.ini`, the `REG/` licence files and a `find_decrypt_password.py` script. They are, or may hold, credentials. Nothing from them is in this repository.

**No database:** there is no SQL Server database or backup in the archive, so actual business data (products, balances, invoices) could not be examined.

**Client decision (2026-11-05): no data migration from ZAT Pro.** The new POS starts fresh; see §5.

### Cautions
- **The templates are the vendor's generic set.** Many carry other businesses' names and VAT numbers, and some are Indian GST layouts (TIN/CST, a Kerala bakery, a service centre). These businesses' names, VAT numbers and phone numbers are **not** copied here.
  - A template existing proves only that the vendor shipped it.
  - Only templates bearing this store's own name or area were treated as in use.
- **The "e-invoice" code in ZAT Pro is India's GST e-invoice**, not ZATCA:
  - table `tbleinvoicetransactions` with fields `Irn`, `AckNo`, `EwbNo` (E-Way Bill) and `SignedQRCode`;
  - endpoints `einvoice-json/…` at a `gstzen.in` address;
  - functions `GenerateEInvoice` in the sales invoice and purchase screens.
- **For Saudi Arabia, the only evidence is a `KSATLV` QR routine:** a Base64 TLV QR, the Phase 1 (generation phase) style.
  - The archived program shows **no ZATCA Phase 2 strings**: no Fatoora/ZATCA endpoints, CSID, invoice hash, previous-invoice hash or XML signing.
  - **So this archive does not show how the store meets Phase 2 today.** It may use another tool, the Fatoora portal or a newer ZAT Pro build. This must be confirmed with the owner (§6, question Q-Z1).

## 2. Evidence of real use (2025 logs)

These screens appear in the error logs. Each one is listed with the number of different days it appeared:

| Old screen / class | Days in 2025 logs | Meaning |
|---|---|---|
| `FrmNewPurchase` (purchase invoice entry) | **31** | Purchasing is actively used |
| `ClsInGrid` (item grid used by purchase/sales entry) | 30 | Same |
| `FrmSalesPOS` (POS sales) | 5 | POS sales used |
| `MDIParent2` (main window) | 3 | — |
| `frmsalesinvoice` (A4 sales invoice) | 1 | Credit / B2B invoices possibly used |
| `FrmReportPLU` (PLU report) | 1 | Scale PLUs used |
| `ClsItemMaster`, `Clsbatch` | 1 | Item master with batches |
| `FrmbarcodePrinting` | 1 | Barcode stickers printed |
| `ZAT.DBTask` (database layer) | 307 | Every day (most errors are SQL syntax errors) |

**Also in use, by other evidence:**
- **Scale:** the PLU export file holds this store's departments (vegetables, fruit, spices, dates…). Codes are like `11008`.
- **Barcode stickers:** the 2-column sticker template carries this store's Arabic name.
- **Daily sales summary:** the admin version is laid out for a shop on the same street, and the print log mentions "Sales Report".

## 3. Feature-parity matrix

Status values:
- **REQ-OK**: required and implemented.
- **REQ-PART**: required but incomplete.
- **REQ-MISSING**: required and missing.
- **NOT-USED**: present in the legacy install but not used by this store.
- **UNKNOWN**: owner must confirm.

### A. Sales and billing

| Legacy capability | Evidence in old installation | Current POS implementation | Missing functionality | Status | Required action | Verification |
|---|---|---|---|---|---|---|
| POS sales (scan, cash/card) | `FrmSalesPOS`, `FrmCashDesk`; logs 5 days | `services/sales.ts`, Sell tab; keyboard flow, split tender | — | REQ-OK | — | services.test, e2e |
| Simplified tax invoice print (AR/EN, QR) | `Sales_InvoiceNQ.frx` ("Simplified Tax Invoice / فاتورة ضريبية مبسطة"), `KSATLV` QR | Bilingual 80 mm receipt, labelled "NOT A ZATCA TAX INVOICE" | **ZATCA QR and Phase 2 XML/signature** | REQ-MISSING | Phase 5 (ZATCA), §6 | receipt e2e (layout only) |
| A4 sales invoice to a customer (credit, B2B) | `frmsalesinvoice`, `SalesInvoice.frx`, `Sales_Invoice*.frx`; logs 1 day | None. Customers can be attached to a POS sale, but there is no A4 invoice, no credit sale and no buyer VAT details | Credit sales, A4 layout, **standard tax invoice (B2B) needs ZATCA clearance** | UNKNOWN (Q-1) | If B2B or credit sales are needed: scope change, because ZATCA scope was set to simplified-only (EGS 0100) | — |
| Sales returns | `SalesReturn.frx`, `Sales_InvoiceSR*.frx` ("SALES RETURN") | Refunds with local credit notes, policy D1 | ZATCA credit note | REQ-PART | Phase 5 | phase2.test, e2e |
| Sales orders / quotations | `SalesOrder.frx`, `SO.frx` | None | — | UNKNOWN (Q-2), likely NOT-USED in a supermarket | Confirm | — |
| Debit notes | No template found | None | Needed for ZATCA onboarding even if rarely used | REQ-MISSING | Phase 5 | — |
| Daily sales summary (admin, per user, category-wise, cash/card/credit) | `Daily_Sales_Admin.frx`, `Daily_Sales_User.frx`, `FrmReportDailyUser`, `FrmClosingReport`, `FrmUserClosing` | Reports: sales summary (incl. refunds and net), by day, cashier activity, shift close | **Category-wise sales** and a **printable** day summary | REQ-PART | Add category-wise sales and a print button (small) | reports tests |
| Sales report, sales details, item-wise sales/returns | `Sales_Report.frx`, `SalesDetails.frx`, `FrmItemwiseSaleReport`, `FrmItemwiseSaleReturnReport` | Top products (20), refunds list | Full item-wise sales and returns for a range | REQ-PART | Item-wise sales report (small) | — |
| Sales by cashier | `Daily_Sales_User.frx` | Cashier activity report | — | REQ-OK | — | phase1b/phase2 tests |
| Invoice reprint and history | `FrmPrintInvoices`, `frmzatsearch` | Reprint of last receipt (audited); refund lookup by invoice number | **Search and reprint any past invoice** | REQ-PART | Invoice search and reprint screen (small) | — |
| Customer loyalty points | `FrmCustomerCardPoint*` | None | — | UNKNOWN (Q-3) | Confirm | — |
| Customer credit limits and outstanding | `FrmCreditLimit*`, `OutstandingAging.frx`, "By Credit" in the day summary | None | Customer accounts (AR) | UNKNOWN (Q-1) | Confirm; would be a scope change | — |
| Kitchen tokens / KOT | `FrmToken`, `FrmShowToken` | None | — | NOT-USED (supermarket) | None | — |

### B. Purchasing and suppliers

| Legacy capability | Evidence in old installation | Current POS implementation | Missing functionality | Status | Required action | Verification |
|---|---|---|---|---|---|---|
| Purchase invoice entry | `FrmNewPurchase` (**31 days in 2025 logs**), `PurchaseInvoice.frx` | Goods receipt (GRN): stock in at cost, Dr Inventory / Cr 2100 | **Supplier invoice** matched to the GRN (or entered directly): supplier invoice number, input VAT, payable to the supplier; clearing 2100 | **REQ-PART** | Build the purchase invoice on top of the existing GRN and journal (plan Phase 4) | — |
| Purchase returns | Return voucher types in the program | None | Return to supplier: stock out at cost, debit note from the supplier | REQ-MISSING | Phase 4 | — |
| Supplier accounts and balances | `FrmSupplier`, `OutStandingSummery.frx`, `OutstandingDetail.frx` | Supplier list only | Supplier ledger and balance | REQ-MISSING | Phase 4 | — |
| Supplier payments | `FrmReceiptandpayment`, `CashReceipt_Payment.frx` | Expense payments exist, but not for suppliers | Pay supplier invoices (bank/till, partial) | REQ-MISSING | Phase 4, reusing the expense payment pattern | — |
| Supplier ageing | `OutstandingAging.frx` | None | Ageing buckets by due date | REQ-MISSING | Phase 4 | — |
| Purchase history and cost tracking | `ProductHistory.frx`, item history | Stock movements keep cost per movement; price history for selling prices | Last purchase cost per supplier, history screen | REQ-PART | Phase 4 | — |
| Reorder voucher / low stock | `FrmReOrderVoucher`, `FrmReorderStockReport` | Low-stock report, dashboard count | Purchase order from low stock | REQ-PART | Phase 4 (optional PO) | stock report tests |

### C. Inventory and stock

| Legacy capability | Evidence in old installation | Current POS implementation | Missing functionality | Status | Required action | Verification |
|---|---|---|---|---|---|---|
| Item master, categories, units | `FrmItemCreateNew`, `Frmitemgroup`, `Frmunitcreation`; `ClsItemMaster` in logs | Products, categories, units PCS/KG, aliases | Category management screen (categories exist in data) | REQ-PART | Small | services tests |
| Barcodes and PLU | `FrmReportPLU` (logs), `FrmBarcodeMUnitTool` | Barcodes, qty per scan, PLU | — | REQ-OK | — | tests |
| Weighed products / scale export | `ZATWmachine.csv` (13 departments, 5-digit codes, price 0) | Configurable label parser (any field order) | **Real label layout unverified**; no export file to load the scale | REQ-PART | Real label sample; optional scale export | scale-labels.test (synthetic) |
| Barcode / price sticker printing | `FrmbarcodePrinting` (logs), `FrmStickerPrint`, `Barcode2Col.frx` with this store's name | None | Shelf/product barcode sticker printing (label printer) | **REQ-MISSING** | Build sticker printing (needs the label printer model) | — |
| Cost price code on stickers | `PriceCode.ini` (digit→letter) | None | Optional part of stickers | UNKNOWN (Q-4) | Confirm | — |
| Batches and expiry | `Clsbatch` (logs), `FrmExpireDateReport`, batch fields everywhere | None | Batches/expiry (plan Phase 2 remainder) | UNKNOWN (Q-5) | Confirm whether expiry tracking is wanted | — |
| Stock movements, product history | `ProductHistory.frx`, `StockVouchers.frx` | Immutable stock movements | **Product history screen** (movements per product with running balance) | REQ-PART | Small | stockDrift tests |
| Stock valuation | `StockValueReport.frx`, `StockReportSummary/Detail/Monthlywise` | Inventory account (1200) on the balance sheet; stock on hand with average cost | Stock valuation report per product and category, monthly in/out | REQ-PART | Small–medium | — |
| Stock adjustment, physical count | `Frmstockadjustment`, `Frmphysical` | Stock counts (blind), adjustment documents | — | REQ-OK | — | phase2.test, e2e |
| Damage / wastage | `FrmDamage` | Wastage with reasons | — | REQ-OK | — | phase2.test, e2e |
| Returns and damaged goods | Sales return templates | Refund with "back on shelf" or not | — | REQ-OK | — | phase2.test |
| Repacking (bulk → packs) | `FrmRepacking`, `FrmItemRepacking` | None | Convert bulk stock into packs (e.g. rice 25 kg → 1 kg bags) | UNKNOWN (Q-6) | Confirm | — |
| Stock areas / branch transfer | `FrmStockAreaTranfer`, `FrmBrachMaster` | Single store, single stock location | — | UNKNOWN (Q-7); probably NOT-USED | Confirm | — |
| Production / assembling (recipes) | `FrmProduction*`, `Production*.frx` | None | — | NOT-USED unless the store makes products (bakery?) (Q-8b) | Confirm | — |
| Multi-rate / price lists / discount tools | `FrmMultiRate`, `FrmPriceList`, `FrmBarcodeDiscountTool` | Single shelf price, line discount with approval | Price lists, promotions | UNKNOWN (Q-9) | Confirm; a scope change | — |
| Price updater / Excel import | `Frmpriceupdater`, `FrmImportExcel` | CSV import with dry run, price edit | — | REQ-OK | — | import tests |
| Serial numbers | `FrmSerialNumberTracking` | None | — | NOT-USED (supermarket) | None | — |

### D. Accounting

| Legacy capability | Evidence in old installation | Current POS implementation | Missing functionality | Status | Required action | Verification |
|---|---|---|---|---|---|---|
| Chart of accounts / ledgers / groups | `FrmLedgerForm`, `frmaccountGroup` | Draft chart (provisional), postable accounts | Account maintenance screen; accountant approval | REQ-PART | Accountant review | — |
| Journal entries / vouchers | `FrmTransaction`, voucher types | Automatic journals from every source; immutable | **Manual journal entry** (for accountant corrections) | REQ-MISSING | Small, needs a strict permission | ledger tests |
| General ledger | `NewBSFourth`/`TBVouchers` style | General ledger per account with running balance | Print/export | REQ-OK | — | expenses.test reconciliation |
| Trial balance (summary, monthly, detail) | `NewTrialB*.frx`, `TBSummary`, `TBMonthlySummary` | Dated trial balance | Monthly columns | REQ-PART | Small | expenses.test |
| Balance sheet (summary, group, monthly) | `BalanceSheet.frx`, `NewBS*.frx`, `BSGroupSummary` | Balance sheet as of a date | Group/monthly views | REQ-PART | Small | expenses.test |
| Profit and loss (summary, ledger, monthly) | `ProfitandLoss.frx`, `NewPandL*.frx` | P&L with returns, COGS, gross profit, operating expenses (provisional) | Monthly columns | REQ-PART | Small | expenses.test |
| Daybook | `Daybook.frx`, `FrmZatDayBookReport` | General ledger per account; journal by date not shown as one list | **Daybook** (all entries of a day) | REQ-PART | Small | — |
| Receipts and payments | `Receiptandpayment.frx`, `CashReceipt_Payment.frx` | Expense payments; cash in/out | Supplier/customer receipts and payments | REQ-PART | Phase 4 | — |
| Cash in/out register | `CashInOutRegister.frx`, `FrmCashInOut` | Cash in/out per shift (to suspense 2900), shift close over/short | — | REQ-OK | Accountant to map 2900 | services tests, e2e |
| Income and expenditure | `IncomeExpenditure*.frx` | P&L by account | — | REQ-OK (as P&L) | — | — |
| Cheque register | `Cheque_Report.frx`, `FrmChequeRegister` | None | — | UNKNOWN (Q-10) | Confirm | — |
| Supplier ageing | `OutstandingAging.frx` | None | See B | REQ-MISSING | Phase 4 | — |
| Customer ageing | Same | None | See A (credit) | UNKNOWN (Q-1) | — | — |
| Bank and cash accounts | Ledgers | 1010 cash, 1020 card clearing, 1030 bank | Card settlement to bank (1020 → 1030) and bank reconciliation | REQ-PART | Small (card settlement entry) | — |
| VAT report | `TaxReport.frx`, `TaxReportNO2.frx` (Indian multi-rate layout), `FrmReportTaxDetails` | Output VAT and input VAT on the P&L screen | **VAT return report** (sales/purchases, standard/zero/exempt, adjustments, by period) | **REQ-MISSING** | Build after the purchase invoice (needs input VAT from purchases) | — |
| Salaries / salary slips | `FrmSalaryPayment`, `FrmSalarySlip` | Salaries as an expense category | Payroll | UNKNOWN (Q-11); recommend NOT in POS | Confirm | — |
| Year ending | `Frmyearending` | None (no period close) | Period close, year-end close | REQ-MISSING | Plan Phase 3 | — |

### E. Other legacy areas

| Legacy capability | Evidence | Status | Note |
|---|---|---|---|
| Users, groups, privileges, user monitor | `Frmusers`, `FrmUserGroups`, `FrmUserPrivilege`, `Frmusermonitore` | REQ-OK | Roles and backend permissions, audit log |
| Backup and restore | `FrmBackupandrestore` | REQ-OK | Encrypted, verified backups; cloud copy missing (Phase 6) |
| Dashboard | `FrmDashboard` | REQ-PART | Desktop Accounting overview built; phone dashboard needs hosting |
| SMS tool, CRM, enquiries | `FrmSMSTool`, `FrmCRMVehicle`, `frmAddenquiry` | NOT-USED (assumed) | Confirm in Q-12 |
| Service / job cards / ambulance / asset register | `frmJobCard`, `Servicebill.frx`, `FrmAmbulanceRegister`, `FrmAssetRegister` | NOT-USED | Other industries |
| Print designer | `FrmPrintDesigner*` | Not reproduced | Fixed layouts in code are safer; layout changes are made by a developer |
| India GST e-invoice / E-Way Bill | `APIManagerGST.dll`, `tbleinvoicetransactions` | NOT-USED | Not applicable in Saudi Arabia |

## 4. Report-by-report validation (70 templates)

**Legend:**
- **Used?** Y = evidence of use; ? = unknown; N = other business or industry.
- **New POS:** ✓ = equivalent exists; ◐ = partial; ✗ = missing; — = not needed.
- **Reconciles:** whether the new report is computed from the same journal or source records as the P&L, balance sheet and trial balance.

| Original report | Purpose | Source data | Used? | New POS | Reconciles | AR/EN | Print/export |
|---|---|---|---|---|---|---|---|
| Sales_InvoiceNQ.frx | Simplified tax invoice (POS) | Sale, lines, VAT, QR | Y | ◐ receipt (no ZATCA QR) | sales table = journal (tested) | AR/EN | Print |
| Sales_Invoice.frx, Sales_Invoice3.frx, Sales_Invoice (2).frx, Sales_Invoice_old.frx, SalesInvoice.frx | A4 tax invoice | Sale, customer | ? | ✗ | — | AR/EN | Print |
| Sales_InvoiceSR.frx, Sales_InvoiceSR1.frx, Sales_InvoiceSR..frx, SalesReturn.frx | Return / credit note print | Refund | Y (layout with store area) | ◐ credit-note receipt | refunds = journal (tested) | AR/EN | Print |
| SalesOrder.frx, SO.frx | Sales order | Order | ? | ✗ | — | EN | Print |
| Daily_Sales_Admin.frx | Day summary, all users, category-wise, cash/card/credit | Sales, returns, payments | Y | ◐ (no category split, no print) | ✓ same tables | AR/EN | Print |
| Daily_Sales_User.frx | Day summary per user | Same, per user | Y | ◐ cashier activity | ✓ | AR/EN | Print |
| Sales_Report.frx | Sales voucher list | Sales | ? | ◐ | ✓ | EN | Print |
| SalesSummary.frx, SalesDetails.frx | Sales list and item detail | Sales lines | ? | ◐ top products | ✓ | EN | Print |
| PurchaseInvoice.frx | Purchase invoice print | Purchase | Y (screen in logs) | ✗ (GRN only) | — | EN | Print |
| ProductHistory.frx | Product in/out history | Stock movements | ? | ✗ | movements = balances (stockDrift test) | EN | Print |
| StockReportSummary.frx, StockReportDetail.frx, StockReportProductSummary.frx, StockReportMonthlywise.frx, StockVouchers.frx | Stock in/out, balance, value | Stock movements | ? | ◐ stock on hand | ✓ | EN | Print |
| StockValueReport.frx | Stock valuation | Balances × cost | ? | ◐ (inventory account total only) | ✓ 1200 balance | EN | Print/export |
| StockIssueReport.frx, Production*.frx (6) | Production / raw materials | Production | N (unless bakery) | — | — | EN | — |
| MoreLessItem.frx, MoreLessProfit.frx | Fast/slow movers, profitable items | Sales lines, cost | ? | ◐ top products | ✓ | EN | Print |
| Barcode2Col.frx | Barcode stickers | Items, prices, price code | Y | ✗ | — | AR/EN | Label print |
| BalanceSheet.frx, NewBSFirst…Fourth.frx, BSGroupSummary.frx, BSVouchers.frx | Balance sheet views | Ledger | ? | ◐ (as-of view) | ✓ (balanced, tested) | EN | Print |
| ProfitandLoss.frx, NewPandLFirst…Fourth.frx | P&L views | Ledger | ? | ◐ (period view) | ✓ (tested) | EN | Print |
| NewTrialBFirst…Fourth.frx, TBSummary.frx, TBMonthlySummary.frx, TBDetail.frx, TBVouchers.frx, Test.frx | Trial balance views | Ledger | ? | ◐ (period view) | ✓ (tested) | EN | Print |
| Daybook.frx | All vouchers by day | Journal | ? | ✗ (GL per account only) | — | EN | Print |
| Receiptandpayment.frx, CashReceipt_Payment.frx | Receipts/payments | Cash/bank vouchers | ? | ◐ expense payments | ✓ | EN | Print |
| CashInOutRegister.frx | Cash register reconciliation per user | Shift, cash, cheque | Y (cash desk) | ✓ shift summary and close | ✓ | EN | Print ◐ |
| IncomeExpenditureSummary.frx, IncomeExpenditureDetail.frx | Income vs expenditure | Ledger | ? | ✓ (P&L, ledger) | ✓ | EN | Print |
| OutStandingSummery.frx, OutstandingDetail.frx, OutstandingAging.frx | Party balances and ageing | Party ledgers | ? (suppliers likely) | ✗ | — | EN | Print |
| Cheque_Report.frx | Cheque register | Cheques | ? | ✗ | — | EN | Print |
| TaxReport.frx, TaxReportNO2.frx | VAT report (second one is an Indian multi-rate layout) | Sales/purchases VAT | Y for VAT (legally required) | ✗ VAT return report | — | EN | Print/export |
| Servicebill.frx, ServiceReceipt.frx, UserReport.frx | Service centre jobs | Service jobs | N | — | — | — | — |

**Printing today:** the new POS prints receipts and credit notes. Other reports can be copied as CSV (expenses) or viewed on screen. A general "print / export report" function is **missing** (◐ above). It is a small, shared piece of work.

## 5. Starting fresh (client decision: no migration)

No data is imported from ZAT Pro, so no field mapping or migration reconciliation is needed. To start trading correctly, the new POS still needs:

| Item | How | Check before go-live |
|---|---|---|
| Products, barcodes, PLUs, categories | CSV import (exists, dry run first), or entry | Count of products, barcodes and PLUs equals the owner's list; scan a sample of 50 shelf items |
| Scale items | PLUs set up to match the scale's item codes (`ZATWmachine.csv` shows codes like 11008); label layout configured from a real label | A real label from every scale department scans to the right product and weight |
| Opening stock | A stock count on day 0 with costs: **missing as a function** (a GRN from an "Opening stock" supplier is a workaround that wrongly credits 2100) | Count sheet signed by the owner; stock value equals the 1200 balance |
| Opening balances (cash, bank, supplier balances owed, VAT payable/receivable, owner equity) | **Missing:** needs an opening-balance journal (Dr/Cr against 3000 Opening balance equity), with a strict permission | Trial balance after opening entries equals the accountant's opening trial balance |
| Supplier balances owed on day 0 | Needs supplier accounts (Phase 4) | Each supplier balance equals its statement |
| Invoice numbering | New series starts at INV-00000001 (or a prefix chosen by the owner) | Owner approves the numbering |
| ZATCA | New EGS onboarding (§6) | ZATCA sandbox/simulation pass; old EGS stays until cut-over |

**Keep the old data even without migrating:**
- **Keep a full backup of the old ZAT Pro database for VAT and record retention.** The owner and accountant should confirm the legal retention period.
- Keep it read-only and do not delete it at cut-over. Without migration, that backup is the only record of past invoices.

## 6. ZATCA Phase 2 continuity

See `docs/ZATCA_CONTINUITY_PLAN.md`.

## 7. Questions for the owner

| # | Question | Why it matters |
|---|---|---|
| Q-Z1 | **Which system issues your Phase 2 e-invoices today**, and is the device onboarded on the Fatoora portal? Please send a photo of a recent receipt QR, and a screenshot of the Fatoora portal device list showing device names only, no codes or OTPs. | The archived ZAT Pro shows only a Phase 1-style QR. The replacement plan depends on this |
| Q-1 | Do you sell **on credit** or issue **A4 tax invoices to businesses** (with the buyer's VAT number)? | Credit = customer accounts; B2B = standard invoices with ZATCA clearance (a different EGS function, more cost) |
| Q-2 | Do you use sales orders or quotations? | Not built |
| Q-3 | Do you run a loyalty points card? | Not built |
| Q-4 | Do your stickers show a hidden cost code (letters)? | Sticker design |
| Q-5 | Do you need batch and expiry-date tracking? | Not built; changes receiving and selling |
| Q-6 | Do you repack bulk goods into smaller packs? | Not built |
| Q-7 | One shop with one stock location only? | Single location assumed |
| Q-8b | Do you produce anything in-store (bakery, mixed vegetables)? | Production was in ZAT Pro |
| Q-9 | Do you need price lists, promotions or multi-price? | Not built |
| Q-10 | Do you receive or issue cheques? | Cheque register not built |
| Q-11 | Payroll in the POS, or only salaries as an expense? | Recommend expense only |
| Q-12 | Did you use SMS or CRM features? | Assumed not |
| — | Purchasing (supplier invoices, returns, payments, balances, ageing) and the VAT return report are **required** (31 days of purchase activity in 2025). **May I build them next (plan Phase 4)?** | Scope and cost |
