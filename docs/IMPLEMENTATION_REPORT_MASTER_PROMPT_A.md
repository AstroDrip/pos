# Master Prompt A: Implementation Report

**Date:** 2026-11-09. **Branch:** `feature/owner-tools`. **Range:** `6a58645` onward. Local commits only. Nothing was pushed.

Spec: [design](superpowers/specs/2026-11-09-pos-master-prompt-a-design.md). Plan: [plan](superpowers/plans/2026-11-09-pos-master-prompt-a.md).

## What changed

| Area | What the shop gets |
|---|---|
| Sell keys | Z holds the bill on the payment step. F2 goes to the customer box. Shift+Enter from the empty customer box goes to payment |
| Held bills | Keep discounts, customer, typed amounts and scale labels. Warn if a price changed or an item stopped. Can be cancelled with a reason |
| Customer search | Suggestions from the first letter, by name, phone or VAT number, with Arabic spelling variants. Nobody is chosen until you choose |
| Tab memory | Tabs stay as you left them. Filters, last tab and Help position survive a restart. A bill or supplier bill left open comes back |
| Search ranking | Exact codes always first. Inside a match level: past sales, time of day, day of week, stock. Plain tags |
| Audit log | Every record now holds who, role, screen, till, shift, before, after, reason, link and result. Refused and failed money actions are recorded. New Audit tab with filters, details, links and CSV export |
| Shift handover | One step: count, next cashier's PIN, their shift opens with that cash |
| Cash flow | New report in Accounting |
| Books check | 19 read-only checks over the source records. Results are kept. Admin can add notes |
| Help | 151 field explanations and 64 figure explanations behind a small "i". New guides for statements, VAT, ZATCA status, roles, audit, books check, handover |

## Database migrations

| No. | Change |
|---|---|
| 012 | `bill_drafts` |
| 013 | Audit log indexes; permissions `audit.view`, `audit.export`, `integrity.view` for admin only; `device_id` setting |
| 014 | `integrity_runs`, `integrity_findings`, `integrity_reviews` |

No existing table changed shape. Audit hashing is unchanged, so old rows still verify.

Not changed: `sales.ts`, `core/vat.ts`, VAT calculation, ZATCA processing, invoice numbering, stock movement rules.

## Part 8 acceptance tests

| # | Test | Where | Result |
|---|---|---|---|
| 1 | Z in payment holds a bill | `checkout-keys.test.ts`; flow `z-holds-on-payment` | Pass |
| 2 | Z in a text field types Z | key tests; flow `z-types-in-other-box` | Pass |
| 3 | Held bill restores correctly | `held-bills.test.ts`; flow `held-bill-restores-discount-and-customer` | Pass |
| 4 | Holding creates no sale | `held-bills.test.ts`; flow `z-no-sale-created` | Pass |
| 5 | Customer suggestions appear | flow `customer-list-appears-first-letter` | Pass |
| 6 | Arabic and English search | `customer-search.test.ts` | Pass |
| 7 | Keyboard picks the right customer | `suggest-keys.test.ts`; flows `customer-one-match-not-picked`, `customer-arrow-enter-picks` | Pass |
| 8 | Moving through Sell stages | key tests; flow `f2-keeps-bill` | Pass |
| 9 | Tabs keep their state | flows `bill-survives-tab-switch`, `filters-survive-tab-switch`, `hidden-sell-ignores-scan` | Pass |
| 10 | Help reopens in the same place | flow `help-reopens-same-article-and-scroll` | Pass |
| 11 | Field explanations | `registry.test.ts`; flow `info-icon-opens-right-text` | Pass |
| 12 | Metric explanations match formulas | `metrics-proof.test.ts` | Pass |
| 13 | Price change audited | `audit.test.ts`; flow `audit-tab-lists-price-change` | Pass |
| 14 | Handover audited | `shifts-handover.test.ts`; flow `shift-handover-switches-cashier` | Pass |
| 15 | Refund linked to its sale | `audit-view.test.ts` | Pass |
| 16 | Unauthorised access refused | `audit-view.test.ts`, `integrity-runs.test.ts`; flow `audit-hidden-from-cashier` | Pass |
| 17 | Audit rows cannot be changed quietly | `audit.test.ts` | Pass |
| 18 | Reconciliation finds planted faults | `integrity.test.ts` | Pass |
| 19 | Missing relationships found | `integrity.test.ts` | Pass |
| 20 | Backup and restore keep the audit log | `audit-view.test.ts` | Pass |

Final run results are recorded in `docs/TEST_RESULTS.md`.

## Known limits

- A real scanner, a real Arabic keyboard session and a true process restart were not tried. The real-app checks use fast key bursts and a full screen reload.
- A supervisor approves a restored discount again at payment. That is by design.
- The Arabic text for new labels has not been checked.
- The books check only reports. It has no correction buttons in this version.
- `ZATCA`: no submission exists. The Help guide says so.
- These names from the brief do not exist in the app and were not built: price override, sale cancel, opening cash change, financial periods, manual journals, role editing, barcode or PLU editing.

## Unresolved discrepancies

None on the demo shop or on the test shop. Real store data has not been checked. On older real data, the books check may warn about shifts closed under an earlier expected-cash rule. If it does, ask before changing anything.

## How to check it yourself

Run `npm run demo -- --fresh`. Log in as `owner` with PIN `4321`.

1. **Z:** scan an item, press Shift+Enter, press Z. The bill goes to Held bills.
2. **Customer:** press F2, type part of a name, press the down arrow and Enter.
3. **Tabs:** start a bill, go to Stock and scan something, come back. The bill has not changed.
4. **Restart:** start a bill, close the app, open it again. It offers to restore the bill.
5. **Help:** press the small "i" beside any figure in Accounting.
6. **Audit tab:** look at the newest rows. Open one to see old and new values.
7. **Books check:** Audit tab, Books check, Run check.
8. **Handover:** Shift tab, count, type `cashier` and `1111`, press Hand over.
