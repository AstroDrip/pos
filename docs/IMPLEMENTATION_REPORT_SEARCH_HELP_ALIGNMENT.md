# Implementation Report: Search, Keyboard, Quantity, Help Centre, Alignment

**Date:** 2026-11-08. **Branch:** `feature/owner-tools`, local commits only (not pushed).

**Related documents:**
- Spec: `docs/superpowers/specs/2026-11-07-search-keys-help-alignment-design.md`.
- Plan: `docs/superpowers/plans/2026-11-07-search-keys-help-alignment.md`.
- Phase 0 audit and ledger: `docs/audit/SEARCH_KEYBOARD_HELP_ALIGNMENT_AUDIT.md`.

## 1. What was built

| Area | Result | Details |
|---|---|---|
| First-character search | Every product and customer box suggests from the first letter; ranking by match level, then demand | `docs/SEARCH_INTELLIGENCE_IMPLEMENTATION.md` |
| Demand ranking | Completed sales, net of refunds, 7/30/90-day weights, at least 3 sales; incremental cache | same |
| Customer ranking | Exact phone/number → starts with → contains; recent activity first | same |
| `[−] qty [+]` | On every unit line, plus typing a quantity. Zero removes the line (audited like ✕) with Undo for 6 s. Weighed lines keep the label weight (Q-8) | `core/cart.ts`, `Sell.tsx` |
| `-` key | Empty search box: one fewer of the last unit item. Quantity step: one fewer (never below 1) | `checkout-keys.ts` |
| Shift+Enter | Empty search box → payment step. Refused while a search or quantity is unfinished. **Does nothing on the payment step** | `checkout-keys.ts`, `SearchBox.tsx` |
| Help Centre | Help tab for every role; 49 English guides including scenarios A–J; first-letter search; A−/A+ text size; print; "?" links on Sell, Customers, Purchases, Stock, Refund, Expenses; notice in the Arabic UI | `renderer/help/content.ts`, `Help.tsx` |
| User manual | `docs/user-guide/POS_USER_MANUAL.md` is generated from the same content (`npm run manual`); a test fails if it is out of date | `renderer/help/manual.ts` |
| Alignment audit | Electron-native, environment-gated, dev only; 58 screens × geometry checks + 8 real key flows | `docs/audit/UI_ALIGNMENT_REPORT.md` |

## 2. Bugs found and fixed

1. **Shift+Enter on the payment step created a sale.** The state machine ignored Shift, so Shift+Enter acted as Enter and paid cash. Proved in the real app before the fix (sales 4 → 5) and after it (4 → 4).
2. **Hidden tabs.** At 1366 px the Help tab and part of Admin were hidden on every screen by a sideways-scrolling tab row with no visible scrollbar. The tabs now wrap.
3. **Demand ranking would have frozen the till.** The first version recomputed after every sale: 0.5–1.1 s at 27k sales. It was redesigned before commit.
4. **Admin grid cards** in one row had different heights (two separate CSS causes).
5. **Customers list** was narrower than the account card below it.
6. **Arabic "A−/A+"** label direction.

Bugs in my own audit tool (fixed):
- a wrong "payment step open" check;
- stale `capturePage` frames.

Both are explained in the alignment report.

## 2b. Independent code review (fresh reviewer, whole branch) and fixes

The reviewer confirmed the hard constraints: no money, VAT, ZATCA, numbering, stock or permission changes; no migration; no new packages; the audit only runs in development. Seven findings were fixed. Each fix started with a test that failed first (unit test, or a real-app flow in `npm run ui-audit`).

| # | Finding | Fix | Proof |
|---|---|---|---|
| C1 | Enter could pick the old first-letter suggestion instead of a code typed or scanned just after (for example `a` then `A12`) | Enter picks a suggestion only when the list answers exactly the text in the box and no answer is pending; codes use the exact lookup | `enterAction` tests |
| I2 | Demand only re-sorted the first 8 names alphabetically, so a best seller later in the alphabet never appeared | Products with a demand score that match are added by id | `search.test.ts` "finds a best seller…" |
| I3 | Lowering a quantity was not logged (only removing the line was) | Every drop logs the removed part and its share of the line amount | `cart.test.ts` |
| I7 | − could leave a discount larger than the line (bill blocked), and the log recorded amount 0 | Such a drop is refused with a message; logged amounts come from the line itself | `cart.test.ts` |
| I4 | After typing 0 on a line, the next line reused the input showing 0 (and could be removed too); discount boxes could move to another line | Stable line ids for rows and inputs | flow `type-zero-keeps-next-line` |
| I5 | The "?" on the payment step switched tab and lost the bill | "?" opens Help over the screen; Esc or Close returns | flow `help-link-keeps-bill` |
| I6 | The top bar never shrank back after its tabs wrapped | Fixed min-height (48 px) instead of its own measured height | flow `top-bar-shrinks-back` |

**Deferred (minor, not fixed):**
1. The demand cache misses on every keystroke, because the window bounds move every millisecond. It runs about 8 small queries per search, which stays fast. My earlier note that "the key includes the hour" was wrong.
2. The Help "Where" line says "Scan or search" box; the visible label is "Scan, or type barcode / PLU / SKU and press Enter".
3. A letter typed before a scan stays in the box with its list.
4. Customer search reads at most 2000 matches before ranking (only matters with more than 2000 customers matching one letter).
5. The audit refuses nothing if `POS_USER_DATA` is not set. It is meant to be run only through `scripts/ui-audit.mjs`, which uses a temporary folder.
6. Shift+Enter on the very first key after leaving the quantity step may act as Enter. Low risk.

**Rulings the reviewer questioned:**
- The undo of a removal is not written to the log. I kept this. The removal stays in the voids report even if it was undone.
- The demand cache note (see minor 1 above).

## 3. What did not change

- No changes to VAT, invoice numbering, ZATCA processing, stock movements, journal posting or permissions.
- No database migration.
- No new npm packages.
- No Playwright use. The existing Playwright files are unchanged, except that `scripts/ui-shots.mjs` now imports its seed function from `scripts/ui-seed.mjs`. That script was **not run**.

## 4. Tests (fresh run at `6d2adc0`, after the review fixes)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 28 files, **270 passed** (200 before this work) |
| `npm run build` | exit 0 |
| `npm run ui-audit -- ui-audit/final` | 44 screens (English; Arabic skipped by owner request), **0 findings**, **11/11** key flows ok |
| `npm run e2e` | **Not run** (Playwright, forbidden for this task) |

**Test changes to note:**
- `handlers.test.ts`, backup key/restore test: timeout raised to 30 s. It timed out once at 7.4 s under full-suite load and takes 1.5 s alone. Assertions unchanged.
- Three of my own new test expectations were corrected or strengthened while writing them. Each is listed in the ledger with its reason. No existing assertion was weakened.

## 5. Risks and what to watch

- **`e2e/smoke.mjs` was not run**, so changed screens were not checked by it.
  - Selectors it uses were kept: `input[aria-label="quantity"]` is still the quantity step only; the cart's input is `line quantity`.
  - Run e2e once Playwright is allowed again.
- **Demand ranking** is only as good as the sales history. On a new store, everything has a score of 0 and the old name order applies.
- **Shift+Enter** uses the same 350 ms guard as Enter. Check it on the real keyboard at the store.
- **Help text** must be updated whenever a feature changes. The banned-words test only catches a few unbuilt features by name.

## 6. Arabic

The Help Centre is English only (owner decision 2026-11-07). New UI strings (minus, Undo, refusal messages, Help tab, text size) have Arabic translations, checked by `i18n.test.ts`.
