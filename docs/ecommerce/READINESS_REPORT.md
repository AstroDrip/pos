# Readiness report (Phase G)

Written 2026-11-13. This covers the online store in `store/` and its link to the POS. Everything here was tested on one developer computer with made-up data. Nothing has been deployed, and the store is **not ready to go live** (see section 5).

## 1. Results

| Check | Result |
|---|---|
| POS tests (real SQLite) | 827 of 827 passed |
| POS typecheck, lint, build | Clean |
| POS screen audit (`ui-audit`, 57 screens, 111 click flows) | 0 problems, run after the Phase F report changes. POS code did not change in Phase G |
| Store tests (PGlite) plus race tests on a throwaway PostgreSQL 18 | 289 passed, 1 skipped. The skipped one is the live POS-to-store test, which needs both servers running. It passed separately against the running servers |
| Store typecheck and production build | Clean |
| Browser code scanned for secrets and database names | None found |
| `npm audit` of store packages used in production | 0 known vulnerabilities |
| Dashboard tests | 72 of 72 passed (no dashboard changes in Phase G) |

When the POS and store test suites were run at the same time, 11 POS tests and 1 store test file timed out because the computer was overloaded. Each suite passed in full when run on its own. Run them one at a time.

## 2. Browser review

Every store page was opened in the built-in browser at phone (375 px), tablet (768 px) and desktop (1440 px) widths. That covers 9 shop pages, 5 staff pages and the not-found page. Each was checked for sideways scrolling, content running off screen, buttons that are too small, broken pictures, controls with no name for screen readers, and one main heading. A made-up pickup order was placed, tracked, opened by staff, and accepted.

Keyboard checks: an item was added to the cart with the Enter key. The reject dialog opens with Enter, puts the cursor inside, closes with Escape, and returns the cursor to the button. Focus was visible on every control tabbed through on the home page.

Production mode was checked on the pages that need no data. The new security header is sent, the pages start normally, and nothing is blocked. Pages that need data could not be opened in production mode here, because production refuses the local test database by design.

## 3. Problems found and fixed in Phase G

| Problem | Fix | Proof |
|---|---|---|
| No Content-Security-Policy header, which the security plan requires | Added one for every page. It stops framing, plugins, other script sources and form posts to other sites. `eval` is allowed only in development | `tests/headers.test.ts`, plus a production-mode browser check |
| Order tracking links could be guessed without limit (checkout already had a limit) | After 30 wrong links in 15 minutes, that address must wait. Correct links are never counted, so real shoppers are not locked out | New test in `tests/orders.test.ts`: failed first, then passed |
| Staff saw "Bananas × 1" while the customer saw "× 1 kg" | Staff see the unit for weighed goods | New check in `tests/admin-orders.test.ts`: failed first, then passed. Browser shows "× 1 kg" |
| Home page had no main heading; product page had two | Home has a hidden heading with the store name; on the product page only the product name is the main heading | Browser check |
| Cart picture link had no name for screen readers | Named after the product | Browser check |
| Desktop category link on the product page was 18 px tall | Now 24 px, which meets WCAG 2.2 AA (24 px minimum) | Browser check |

## 4. Test plan coverage

All 16 inventory cases in `SECURITY_AND_TEST_PLAN.md` have automated tests, including real PostgreSQL concurrency for the last-unit and 5-3-2 cases. The free delivery boundary values (49.00, 50.00, 50.01, 60.00) are tested. Order state rules, staff permissions, sign-in lockout, the cross-site request check, private tracking links and the "no cost data leaves the POS" rule are all tested. On the POS side, reports show online sales without counting them twice, integrity checks stay clean, and the sync does nothing while the online store is switched off.

Not covered, because the feature does not exist yet:
- Online card payment, webhooks and refunds to card.
- Delivery orders. These are blocked until card payment exists, and checkout says so.
- Product image upload. Pictures are set by a stored address for now.

## 5. Not tested, and must be before going live

- Real Neon database and Vercel hosting. Race tests ran on local PostgreSQL only.
- Real phones and real shop networks.
- A real POS computer on the shop connection.
- ZATCA Phase 2. Going live is blocked on it.
- Arabic. Deferred by owner rule.
- Load from many real shoppers at once.
- An independent code review by a fresh reviewer. Only the author's own pattern scan was done, because the owner's standing rule is no subagents unless asked.

## 6. Known limits

- The security header allows inline scripts, because Next.js needs them unless a per-request nonce is added. Framing, plugins and other-site scripts are still blocked.
- The staff Stock page refreshes every 20 seconds. Staff do not get a live push.
- `next build` and `next dev` share the `.next` folder. Restart the dev server after a production build.

## 7. Going live checklist (from `IMPLEMENTATION_PHASES.md`)

| Item | State |
|---|---|
| ZATCA Phase 2 complete | Not started |
| Accountant sign-off | Waiting |
| Legal check on data location | Waiting |
| Payment provider live keys | No provider chosen |
| Real device test on a shop connection | Not done |
| Backup before POS update | Process exists in the POS; not rehearsed for this release |
| Store terms and privacy page | Not written |
| Rollback steps rehearsed | Not done |
