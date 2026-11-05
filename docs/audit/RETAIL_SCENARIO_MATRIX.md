# Retail Scenario Matrix

Run date: 2026-11-05.

**Status key**
- **PASS (auto)**: an automated test ran and passed.
- **PASS (E2E)**: the 22-step end-to-end run passed.
- **MANUAL**: needs a manual or hardware test (not done).
- **N/I**: not implemented (feature missing).
- **BLOCKED**: needs an outside dependency or an owner decision.

**Test files**
- `S` = `src/services/retail-scenarios.test.ts`
- `P` = `src/services/phase1b.test.ts`
- `V` = `src/services/services.test.ts`
- `H` = `src/main/handlers.test.ts`
- `E` = `e2e/smoke.mjs`

## Part 2 / 3.2 — search and barcodes

| ID | Scenario | Expected result | Status | Test |
|---|---|---|---|---|
| S-2-01 | Type "ban" | All 4 bananas, shortest name first | PASS (auto) | S |
| S-2-02 | Arabic search with harakat, alef forms, Arabic digits | Found regardless of spelling variant | PASS (auto) | S |
| S-2-03 | Ranking | Barcode > SKU/PLU > exact name > starts-with > word prefix > alias | PASS (auto) | S |
| S-2-04 | Partial SKU; similar names ("rice 1" vs "rice 5"); FTS/SQL-injection text | Correct item only; nothing breaks; no table changes | PASS (auto) | S |
| S-2-05 | Inactive product search and scan | Not offered; scan says "inactive" | PASS (auto) | S |
| S-2-06 | Alias search, cashier cannot edit aliases | Found by alias; refused for cashier | PASS (auto) | S |
| E-SR-1 | Type "wat", ↓, Enter; Arabic "ماء" | Adds Water; Arabic finds it | PASS (E2E) | E |
| E-SC-1 | Scanner burst while cursor is in another box | Item added; box cleared (BUG-011) | PASS (E2E) | E |
| S-SC-2 | Same barcode twice within 400 ms | Confirmation asked | PASS (auto) | `hardware-input.test.ts` |
| S-SC-3 | Unknown barcode | "Not found", nothing added | PASS (auto) | V |
| S-SC-4 | Duplicate barcode on two products | Refused at product creation | PASS (auto) | V |
| M-04 | Scan while the payment is saving | Refused with message (BUG-002) | MANUAL | code guard only |
| M-05 | Damaged barcode the scanner cannot read | Scanner hardware issue; type or search instead | MANUAL / BLOCKED | needs scanner |

## Part 3.3 — weighed-product labels

| ID | Scenario | Expected result | Status | Test |
|---|---|---|---|---|
| S-3.3-01 | Valid weight label | Product + weight; price = weight × current price | PASS (auto) | S |
| S-3.3-02 | Price label; per-kg price changed after printing | Printed price charged exactly; dear items refused when out of date (see F-SCALE-1) | PASS (auto) | S |
| S-3.3-03 | Zero weight, 99.999 kg, 999.99 SAR, bad check digit, unknown code, piece product on a label | All rejected with a specific message | PASS (auto) | S |
| S-3.3-04 | Two packs, same product, different weights | Two lines, priced separately | PASS (auto) | S |
| S-3.3-05 | Repeated scan of the same label | Double-scan confirmation (same as any barcode) | PASS (auto) | `hardware-input.test.ts` |
| S-3.3-06 | Refund of a partly used weighed item | Needs refunds | N/I | — |
| B-3.3-07 | The store's real label format | Must come from the scale's settings or a photo | BLOCKED | — |

## Part 3.1 / 3.4 / 3.5 — checkout, discounts, payments

| ID | Scenario | Expected result | Status | Test |
|---|---|---|---|---|
| S-3.1-01 | 50 different lines | Line sums = header totals; journal balances | PASS (auto) | S |
| S-3.1-02 | Mixed VAT rates | VAT per rate | PASS (auto) | S |
| S-3.1-03 | Price changes while in the basket (Scenario M) | Refused, then refreshed | PASS (auto) | S |
| S-3.1-04 | Recalled held bill paid twice | One sale | PASS (auto) | S |
| V-3.1-05 | 5,000 random invoices | Line VAT sums = header VAT | PASS (auto) | `vat.test.ts` |
| V-3.1-06 | 300 random sales + retries | Gapless invoice numbers; books balance; stock = movements | PASS (auto) | V |
| E-3.1-07 | Remove a line, clear a bill | Audited with cashier + bill | PASS (auto/E2E) | P, E |
| E-3.1-08 | Hold and recall | Restores the cart | PASS (E2E) | E |
| M-3.1-09 | Cashier recalls the **wrong** held bill | Labels show customer/time; the cashier can hold it again | MANUAL | — |
| V-3.4-01 | Cashier discount without approval / with a cashier as "approver" / with a supervisor | Refused / refused / allowed | PASS (auto) | V |
| E-3.4-02 | Wrong supervisor PIN | Refused, sale not saved | PASS (E2E) | E |
| V-3.4-03 | Discount larger than the line | Refused | PASS (auto) | `vat.test.ts` |
| 3.4-04 | Bill-level %, BOGO, combo, coupon, overlapping promotions | — | N/I | — |
| 3.4-05 | Discount removed after payment | Impossible: sale is immutable | PASS (auto) | V immutability |
| 3.4-06 | Cashier changes a price to fake a discount | Impossible: no permission | PASS (auto) | H matrix |
| S-3.5-01 | Split card + cash with change | Change from cash only; shift totals right | PASS (auto) | S |
| S-3.5-02 | Pay pressed 5 times (Scenario K) | One sale, one payment | PASS (auto) | S |
| V-3.5-03 | Underpayment; card more than total; fractional pieces | Refused | PASS (auto) | V |
| 3.5-04 | Card declined / terminal timeout / customer claims they paid | Card is recorded manually; the cashier must see terminal approval before pressing Card | MANUAL (procedure) | — |
| 3.5-05 | Cashier records a card payment as cash | Visible in shift close: cash short vs card settlement | MANUAL (daily reconciliation) | — |
| V-3.5-06 | Crash after payment, before print (Scenario D) | Sale committed or not, never half; reprint is safe | PASS (auto: rollback + durability tests) | V |

## Part 4 — refunds, returns, exchanges, credit

| ID | Scenario | Status |
|---|---|---|
| 4.1 | Partial refund linked to the original | **N/I**: refunds not built (Phase 2) |
| 4.2 / A | Refund SAR 40 → SAR 20 cash + SAR 20 toward a new SAR 35 sale | **N/I**: needs refunds + store credit |
| 4.3 | Store credit issue, use, concurrency | **N/I**: not in the approved plan |
| 4.4 | Refund without a receipt, altered receipt, old purchase | **N/I + BLOCKED**: needs the return policy |
| 4.5 / F / L | Double refund, over-refund, concurrent refund | **N/I**: design in FINANCIAL_INTEGRITY_AUDIT §4 |

## Part 5 — receipt tampering and fraud

| ID | Scenario | Expected result | Status | Test |
|---|---|---|---|---|
| V-5.1-01 | Change or delete a finalised sale, line, payment, journal or audit row via SQL | Blocked by triggers | PASS (auto) | V |
| H-5.1-02 | Forged audit row inserted directly | Detected; red banner | PASS (auto) | H BUG-010 |
| 5.1-03 | Edit the database with a SQLite tool after dropping triggers | **Not prevented**; see residual risk R-1 in the security report | Residual risk | — |
| H-5.2-01 | Reprint | Marked COPY; same invoice; audited; no new sale | PASS (auto) | H |
| B (Scenario) | Change price then reprint "the same" invoice | Reprint reads the stored sale; the price change does not affect it | PASS (auto) | V "snapshots price" |
| H-5.4-01 | Cashier calls 22 manager/admin operations directly over IPC | All refused | PASS (auto) | H |
| S-13-01 | Deactivated user logs in or approves | Refused | PASS (auto) | S |
| V-13-02 | 5 wrong PINs | Locked 5 minutes; audited | PASS (auto) | V |
| E-13-03 | Renderer has no Node access, unknown channels blocked, navigation blocked | As expected | PASS (E2E) | E |
| 5.3-x | Fake refund / credit to self | N/I (no refunds yet), so impossible today | N/I | — |
| 5.3-y | Repeated drawer opening | N/I (no drawer command) | BLOCKED | — |

## Part 6 / 7 — stock and purchasing

| ID | Scenario | Status | Test |
|---|---|---|---|
| S-7-01 | GRN saved twice (double click) | PASS (auto) | S |
| V-6-01 | Negative stock: block policy rolls back the whole sale; allow policy flags it | PASS (auto) | V |
| V-6-02 | Weighted-average cost on receipt; COGS at average cost | PASS (auto) | V |
| 6.1-x | Count, adjustment, wastage, expiry, supplier return | N/I (Phase 2) | — |
| 6.3 | Two tills selling the last item | N/A: single till, single connection; transactions are serialised | — |
| 7-x | PO, partial or excess delivery, supplier invoice/payment/return | N/I (Phase 4) | — |

## Part 8 — shifts and cash

| ID | Scenario | Status | Test |
|---|---|---|---|
| Scenario I | SAR 50 short: expected-cash breakdown, posted to Cash over/short, attributed to the closing cashier | PASS (auto) | S |
| V-8-01 | Second shift while one is open; reopen a closed shift | Refused / blocked by trigger: PASS (auto) | V |
| P-8-02 | Cash in/out posted so book cash = drawer | PASS (auto) | P |
| 8-03 | Mid-shift count, shift handover | N/I (F-SHIFT-1) | — |
| 8-04 | Crash during shift close | Single transaction: PASS by design (rollback tested for sales) | V |

## Part 10 / 11 / 12 — ZATCA, offline, failures

| ID | Scenario | Status | Test |
|---|---|---|---|
| 10.x | All ZATCA generation, sequence and reporting tests | **N/I / BLOCKED** (see ZATCA report) | — |
| 11-01 | Local operation without internet | PASS (everything is local today) | all |
| P-11-02 | Backup → corrupt file → refused; wrong key → refused; restore to a fresh computer | PASS (auto + E2E) | P, E |
| 11-03 | Cloud upload, interrupted upload, expired credentials | N/I (Phase 6) | — |
| V-12-01 | Failure mid-sale leaves nothing (including the invoice counter) | PASS (auto) | V |
| V-12-02 | Close and reopen: integrity_check ok, data intact | PASS (auto) | V |
| S-12-03 | Clock set backwards | Refused (BUG-009): PASS (auto) | S |
| M-12-04 | Power cut, disk full, printer out of paper, scanner unplugged | MANUAL (SQLite FULL sync + transactions cover data; printing errors are shown) | — |
