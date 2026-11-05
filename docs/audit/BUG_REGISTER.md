# Bug Register

Audit date: 2026-11-05 · Branch `phase1-foundation` · Every "Fixed" entry has a test that was run and passed (103 unit/integration tests, 22-step end-to-end run), unless the entry says otherwise.

Severity: **Critical** = financial loss, unauthorised change, duplicate invoices, corruption. **High** = stock/refund/access/reporting errors. **Medium** = confusing or recoverable. **Low** = minor.

## Found in this retail audit

| ID | Severity | Defect | How it was reproduced | Root cause | Fix | Regression test | Status |
|---|---|---|---|---|---|---|---|
| BUG-001 | **High** | A price changed by a manager while the item was in an open basket was charged at the **new** price, while the screen showed the old one (Scenario M). | Scenario test: change price via `setPrice`, then finalize with the old basket. | `finalizeSale` always re-read the current price and never compared it with the price the cashier saw. | The till sends `expectedUnitPrice` per line. A mismatch refuses the sale with `PRICE_CHANGED`, and the Sell screen reloads current prices so the cashier can confirm with the customer. | `retail-scenarios.test.ts` [S-3.1-03] | Fixed |
| BUG-002 | **High** | Items scanned **while a payment was being saved** disappeared: the cart was cleared when the sale completed, so they were neither sold nor shown. | Code trace: `pay()` captured `lines`, an awaited IPC call let scans add to the cart, then `resetBill()` cleared it. | No "busy" guard for scanner input during finalisation. | `busyRef` blocks scans and picks during payment with a visible message; the search box is disabled meanwhile. | No automated test (timing-dependent UI race). Verified by code review. Manual test listed in the scenario matrix (M-04). | Fixed, not auto-tested |
| BUG-003 | Medium | A scale label with **zero weight** was treated like a typed PLU ("scan the scale label"), which was confusing. | Scenario test with weight `00000`. | Parser returned weight 0; `lookup` passed it on as qty 0. | Zero weight or price on a label is rejected with a clear message. | [S-3.3-03] | Fixed |
| BUG-004 | **High** | No upper limit on label weight or price: a misprinted or forged label (e.g. 99.999 kg, or 999.99 SAR of bananas) was accepted. | Scenario test. | No plausibility check. | Configurable limits (`scale_label_max_grams` default 30 kg, `scale_label_max_halalas` default 1,000 SAR). Price labels are also checked against the implied weight. **Defaults need owner approval.** | [S-3.3-03] | Fixed (defaults pending approval) |
| BUG-005 | Medium | A scale-format barcode with a **wrong check digit** fell through to "Not found", hiding that the label was damaged. | Scenario test. | Invalid EAN-13 returned `null` and the lookup continued. | A 13-digit code with a scale prefix is now either a valid label or a specific error, never a fallback. | [S-3.3-03] | Fixed |
| BUG-006 | Low | Scanning an **inactive** product said "Not found". | Scenario test. | Inactive products were silently filtered. | Explicit "… is inactive and cannot be sold". | [S-2-05] | Fixed |
| BUG-007 | **High** | Double-clicking **Save receipt** on the Stock screen received the goods twice (two GRNs, double stock, double journal). | Scenario test calling `receiveGoods` twice. | No idempotency key; the button stayed enabled while saving. | `request_key` with a unique index (migration 004). The screen sends one key per form and disables the button while saving. | [S-7-01] | Fixed |
| BUG-008 | Medium | Receipt **reprints** were not recorded, so frequent reprinting (a possible fraud signal) was invisible. | Audit-log inspection after reprint. | `sale.print` had no audit call. | Every copy print is audited (user, invoice). Counted in the cashier activity report. | `handlers.test.ts` "reprints are audited…" | Fixed |
| BUG-009 | Medium | With the Windows clock set **backwards**, sales got earlier dates than previous invoices. | Scenario test with the clock moved back 1 h. | No clock check. | A sale is refused if the clock is more than 10 minutes earlier than the last sale (`CLOCK_WRONG`, "fix the Windows date"). | [S-12-01] | Fixed |
| BUG-010 | **High** | The audit log's tamper-evident hash chain was **never checked** by the app, so tampering would go unnoticed. | Code trace: `verifyAuditChain` was only used in tests. | Missing wiring. | `system.health` checks the chain; owners and supervisors see a red warning banner if it is broken. | `handlers.test.ts` BUG-010 | Fixed |
| BUG-011 | Medium | When the scanner fired while the cursor was in another box (e.g. customer phone), the barcode digits **stayed in that box**. | End-to-end run (step "scanner burst…"). | The code set `el.value` directly; React restored its own state on the next render. | Value set through the native setter, plus an `input` event so React's state updates. | `e2e/smoke.mjs` "scanner burst adds item even with focus in the text box" | Fixed |
| BUG-012 | Low | Restore and backup operations checked "is backup available?" **before** "is this user allowed?", which leaks configuration to unauthorised users. | IPC permission-matrix test. | Order of checks. | Permission is checked first. | `handlers.test.ts` permission matrix | Fixed |
| BUG-013 | Medium | Product search used `LIKE '%text%'`, a **full table scan** (unusable at 50k+ products). | `EXPLAIN QUERY PLAN`: `SCAN products`. | No search index. | Normalised-name B-tree indexes, plus an FTS5 word-prefix index, plus exact code indexes. | `SEARCH_PERFORMANCE_REPORT.md`, [S-2-01..06] | Fixed |
| BUG-014 | Low | Rebuilding the search index for 100k products took about 40 s. | Benchmark. | Statements re-compiled per product; FTS sorted every match by bm25. | Cached prepared statements; no bm25 sort. Now 14 s (one-off at upgrade). | Benchmark | Fixed |

## Findings that are business-rule decisions, not code bugs

| ID | Finding | Current safe behaviour | Decision needed |
|---|---|---|---|
| F-SCALE-1 | With **price-only** scale labels, the POS cannot detect a label printed at an old per-kg price when the price per gram is under 1 halala: some exact weight always produces the printed price. | The **printed price is charged exactly** (never recalculated). The weight is derived for stock. For dear items (lamb etc.) an out-of-date label is detected and refused. | Prefer **weight** labels (price = weight × current price), or labels that carry both. Confirm which format the store's scale prints. |
| F-SCALE-2 | With **weight** labels, the POS charges weight × **today's** shelf price. If the price changed after labelling, the charge differs from any price printed on the package. | Charge the current price. | Confirm the rule: current price (now) or the printed price. |
| F-SHIFT-1 | One shift per till. If a cashier logs out without closing, the next user sells into the same shift. Sales stay attributed to the right user, but drawer cash is mixed. | Allowed; per-cashier sales and cash are in the cashier activity report. | Require shift close and recount at every cashier change? |
| F-AUTH-1 | No automatic logout when the till is idle: another person could use a logged-in cashier's session. | Not implemented. | Approve an idle auto-lock (e.g. 5 minutes)? |

## Found earlier in Phase 1 (already fixed and tested)

| ID | Severity | Defect | Fix / test |
|---|---|---|---|
| BUG-P01 | High | Failed PIN attempts were rolled back, so the account never locked. | Failures committed before throwing. `services.test.ts` "failed logins are committed…" |
| BUG-P02 | Medium | After logout, the next user landed on the previous user's tab (blank screen if not permitted). | Every login starts on Sell. E2E. |
| BUG-P03 | Medium | The single-instance lock was taken before the data folder was final. | Lock moved after `setPath`. E2E restore. |
| BUG-P04 | **High** | Journal entry dates used the UTC day: evening sales were booked on the previous day. | Saudi business day. `phase1b.test.ts` "a sale after 9 pm UTC…" |
| BUG-P05 | Medium | The pre-migration snapshot was an unencrypted copy. | Encrypted when a backup key exists. `phase1b.test.ts` |
