# Replacement Acceptance Gate

The new POS replaces ZAT Pro for live trading **only when every row below is checked**. Status as of 2026-11-06.

| # | Gate item | Document | Status |
|---|---|---|---|
| 1 | Legacy feature-parity matrix | `docs/LEGACY_ZAT_PRO_FEATURE_PARITY.md` | **Done** (from the install archive; no database available) |
| 2 | Owner-confirmed list of required workflows | Parity doc §7 (Q-Z1, Q-1 … Q-12) | **Waiting for the owner** |
| 3 | Database migration plan | Not needed: **client decided no migration** (2026-11-05). Start-fresh plan in parity doc §5 | Plan done; opening stock and opening balances functions **missing** |
| 4 | Accounting reconciliation plan | Day-0 opening trial balance from the accountant = POS trial balance after opening entries; ongoing: P&L, balance sheet and trial balance tests | Engine and tests done; accountant approval of the chart **pending** |
| 5 | Invoice and ZATCA continuity plan | `docs/ZATCA_CONTINUITY_PLAN.md` | Plan done; **ZATCA not built**; current Phase 2 mechanism **unknown** (Q-Z1) |
| 6 | Hardware compatibility plan | Below | **Not tested**: models unknown |
| 7 | Report-by-report validation | Parity doc §4 | Matrix done; missing reports listed |
| 8 | Known limitations | Below | Listed |
| 9 | Final owner acceptance checklist | Below | Not started |

## Hardware compatibility plan

| Device | Needed from owner | Test |
|---|---|---|
| Receipt printer | Make, model, connection (USB / network) | Print sale, credit note and reprint; Arabic shaping; 80 mm width; cash drawer kick (if wired through the printer) |
| Barcode scanner | Make, model; suffix setting (Enter / Tab) | 100 scans incl. fast bursts, double scans, scanning while another box has focus |
| Weighing scale (label printing) | Make, model; a **photo of a real label** with the item, weight and price printed on it; the scale's barcode setting screen | Every scale department scans to the right product, weight and price |
| Barcode sticker printer (ZAT Pro printed stickers) | Make, model, label size | Sticker printing, **not built yet** |
| Cash drawer | Model, connection | Opens on cash sales only; audited |
| POS PC | Windows version, disk, RAM | Install, update, restore drill on this PC |

## Known limitations (today)

**Not built:**
- ZATCA Phase 2 (no legal invoices).
- Purchasing:
  - supplier invoices, returns, payments, balances and ageing;
  - VAT return report.
- Opening stock and opening balances.
- Sticker printing.
- Category-wise day summary, item-wise sales, product history, daybook.
- Manual journal, period close.
- Phone dashboard service.
- Cloud backup.

**Built, but provisional or unverified:**
- Expense accounts and posting rules are provisional until the accountant approves them.
- The scale label layout is not verified against a real label.

**Untested:**
- Store hardware.
- Clean-PC install.

## Final owner acceptance checklist (sign at go-live)

- [ ] Required workflows confirmed (Q-1 … Q-12) and each one demonstrated on the store PC.
- [ ] Products, barcodes, PLUs imported; 50 random shelf items scan correctly.
- [ ] Real scale labels from every department scan to the right product, weight and price.
- [ ] Opening stock counted, costed and approved; stock value equals Inventory in the books.
- [ ] Opening balances entered; trial balance matches the accountant's opening trial balance.
- [ ] Accountant approved the chart of accounts, posting rules and VAT treatment.
- [ ] ZATCA:
  - SDK validation passed;
  - sandbox / simulation passed;
  - new EGS onboarded with a production CSID;
  - old EGS still active until cut-over.
- [ ] Hardware tested: printer, scanner, scale labels, sticker printer, cash drawer.
- [ ] Backup and restore drill on the store PC passed; off-site copy arranged.
- [ ] Old ZAT Pro database backed up and archived for the retention period.
- [ ] Staff trained: cashier, supervisor, owner.
- [ ] Supervised parallel trial period completed with no unexplained differences.
