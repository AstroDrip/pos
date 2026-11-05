# Final Readiness Report

Date: 2026-11-05 · Branch `phase1-foundation`.

## Verdict: **READY FOR CONTROLLED TESTING** (test data only), **NOT READY for real sales**

The core checkout, stock, cash and audit logic is sound and heavily tested. Real trading is blocked by missing, agreed-later features: there is no legal tax invoice and no way to refund. Passing tests do not make it production-ready.

## Evidence (all run on 2026-11-05)

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Clean |
| `npm test` (unit + integration + scenarios + IPC permission matrix) | **103 passed**, 0 failed |
| `node e2e/smoke.mjs` (real app, 22 steps incl. search, fraud controls, backup and restore on a fresh folder) | **22/22 passed** |
| `node scripts/search-bench.cjs` | p95 under 6 ms at 100,000 products; all queries use indexes |
| `node e2e/installer.mjs` (previous checkpoint) | Install/launch/uninstall passed on the dev PC |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Bugs found in this audit | 14 (5 High, 6 Medium, 3 Low): **all fixed**; 13 with an automated regression test; BUG-002 guarded in code but not auto-tested |

## Blockers before any real sale (Critical)

1. **ZATCA Phase 2** not implemented (Phase 5), so invoices are not legal tax invoices.
2. **Refunds**: built 2026-11-05 to the owner's policy D1, with local credit notes. The **ZATCA credit note** (and debit note) is still missing (Phase 5).
3. **Off-site backup** not implemented (Phase 6), so a stolen or dead laptop loses data unless USB copies are made.
4. **Store hardware** untested: scanner, receipt printer, scale label format, cash drawer.

## Must resolve before a supervised pilot (High)

5. The accountant approves the chart of accounts and posting rules, including what the suspense account 2900 cash movements become.
6. Owner decisions (below).
7. Clean-PC install and update test; code-signing certificate (otherwise SmartScreen warns).
8. Stock count and wastage: built 2026-11-05. Batches and expiry dates are not built yet.
9. Residual risk R-1 (direct DB editing by someone with Windows access): separate Windows account for cashiers, plus device encryption.

## Owner decisions needed

| # | Decision | Safe default in the build today |
|---|---|---|
| D1 | ~~Return policy~~ **Decided 2026-11-05:** 7 days, receipt required, cash only, supervisor approval | Built |
| D2 | Offer store credit? Expiry? Customer ID required? | Not offered |
| D3 | Scale label format (weight, price or both) and which price wins (F-SCALE-1/2) | Weight labels charge today's price; price labels charge the printed price |
| D4 | Scale label limits (30 kg / 1,000 SAR) | Those limits |
| D5 | Shift change on cashier change (F-SHIFT-1) | One shift per till |
| D6 | Idle auto-lock (F-AUTH-1) | None |
| D7 | Separate Manager role | Supervisor = manager |
| D8 | 6-digit PINs for supervisor and admin | 4–8 digits |
| D9 | Arabic normalisation (ة=ه, ى=ي) | Enabled |
| D10 | Extend the tamper-evident hash chain to sales rows (design change) | Audit log only |

## Scope and cost note

Refunds, credit notes, stock adjustments, ZATCA and cloud backup are later phases in the approved plan. Store credit, promotions and a Manager role were not in the plan. They are worth doing, but each changes the scope and cost agreed against the SAR 1,500 starter, so each needs your go-ahead.
