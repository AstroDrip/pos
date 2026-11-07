# UI Alignment Report

**Date:** 2026-11-08. **Branch:** `feature/owner-tools`.

**Method:** measured inside the real Electron app. No Playwright and no browser-automation framework.

## 1. How the audit works

- **Command:**
  ```
  npm run ui-audit -- <folder>
  ```
  This builds the app, seeds a **temporary** data folder with fake data (`scripts/ui-seed.mjs`), and starts Electron in audit mode.
- **Audit mode** (`src/main/ui-audit.ts`):
  - It runs only when `POS_UI_AUDIT` is set **and** the app is not packaged. A normal start never runs it.
  - It drives the app with Electron's own APIs:
    - `executeJavaScript` to switch tab, theme and language;
    - `sendInputEvent` for real key presses;
    - `capturePage` for screenshots.
- **What it collects:** an in-page collector (`src/main/ui-audit-collect.ts`) records the position and size of every visible element, plus the computed styles needed: position, overflow, scrollbar.
- **The checks** are pure, unit-tested functions in `src/core/geometry-audit.ts`:
  - siblings that overlap;
  - controls, tiles or cards on one visual line whose top or height differs by more than 1.5 px;
  - table header edges that do not match their column;
  - content cut off by a clipping parent;
  - elements outside the window;
  - sideways page scroll;
  - **(new)** content hidden in a sideways scroll area whose scrollbar is hidden.
- **Output files:**
  - per screen: a PNG, a JSON file (rectangles + findings) and an `__overlay.png` with suspect boxes outlined in red;
  - `summary.json`, which also holds the results of the key-press flows.

### Screens covered

58 screens per run.

- **Screens:**
  - login;
  - Sell in four states: empty, with three lines, at the payment step, and showing Undo;
  - Refund;
  - Customers with an account open;
  - Stock, Products;
  - Purchases with a supplier statement open;
  - Expenses, Accounting, Reports, Shift, Admin, Help.
- **Four variants of each:**
  - light, English, 1366×768;
  - dark, English, 1366×768;
  - light, Arabic (RTL), 1366×768;
  - light, English, 1024×700.

## 2. Results

| Run | Findings | High |
|---|---|---|
| Before (`ui-audit/before`, before the hidden-overflow check existed) | 11 | 0 |
| Same screens with the new hidden-overflow check (`ui-audit/t10b`) | 54 | 43 |
| **After** (`ui-audit/after`) | **0** | **0** |

The first "before" run reported almost no problems. It did not yet look for content hidden behind a hidden scrollbar, so it missed the most serious problem, the hidden tabs. That gap in the checks is itself a finding.

## 3. Fixes and their root causes

| # | Problem | Root cause | Fix (at the source) |
|---|---|---|---|
| 1 | **High.** At 1366 px the Help tab and part of Admin were invisible on every screen: 64 px hidden in English, 143 px in Arabic | `.top nav` scrolled sideways (`overflow-x: auto`) with its scrollbar hidden, so tabs disappeared with no sign | The tab row wraps onto a second line (`flex-wrap: wrap`) and never hides a tab. `TopBar` in `App.tsx` measures the bar's real height into `--topbar-h`, so the full-height Sell screen still fits the window. The fixed 84 px override for narrow windows was removed |
| 2 | **High** (Help tab only). The page opened scrolled down, with content under the sticky top bar | `scrollIntoView` in `Help.tsx` ran when the page opened | Removed |
| 3 | **Medium.** On Expenses, the "?" help button was 22 px tall next to the 36 px New expense button | The small help-link size was also used in page-header action rows | `.page-header .actions .help-link` uses the standard control height |
| 4 | **Medium.** Admin cards in the same grid row had different heights | `.grid-cards` used `align-items: start` | Changed to `stretch`, so cards in a row share one height |
| 5 | **Medium.** Two Admin cards stayed 16 px shorter than their row | `.card.section` (bottom margin 16 px) came later in the file than `.grid-cards > .card { margin: 0 }`, with equal specificity | `.grid-cards > .card.section` is included in the margin reset |
| 6 | **By eye.** The Customers list (900 px) was narrower than the account card below it (1100 px) | Two separate hard-coded widths | One token, `--section-w: 1100px`, used by `.card.section` and the list |
| 7 | **By eye, Arabic.** "A−" / "A+" showed as "−A" / "+A" | Text direction in RTL | The text-size control is set to `dir="ltr"` |

No negative margins, no `overflow: hidden` to hide spill, and no `!important` were used for these fixes.

## 4. Bugs found in the audit tool itself (fixed)

- **Wrong payment-step check.** Key flows looked for `[aria-label="payment step"]`, but that element is always on screen; the active step has the class `.current`. Earlier "Shift+Enter opens payment" passes were therefore no proof. The check was fixed, and every flow passes with the correct check.
- **Stale screenshots.** `capturePage` can return the last frame painted before the DOM change. A screenshot named Expenses showed Purchases, while its JSON (taken from the DOM) was correct. The runner now waits for two animation frames before each capture.
  - Screenshots in `ui-audit/before` were taken before this fix, so some may show the previous screen. Their JSON findings are correct.

## 4b. After the code review (2026-11-08)

- **Help overlay.** "?" links now open Help over the current screen instead of switching tab.
- **Top bar.** It uses a fixed minimum height, so it shrinks back after the tabs unwrap (88 → 48 px).
- **Three more real flows:** `type-zero-keeps-next-line`, `help-link-keeps-bill`, `top-bar-shrinks-back`.
- **Arabic skipped.** By the owner's request ("dont check arabic, we will solve that section later"), the audit now skips the Arabic variant unless `POS_UI_AUDIT_ARABIC=1` is set.
- **Final run:** 44 screens, 0 findings, 11/11 flows.

## 5. Real key-press flows

All 8 flows passed in the final run.

| Flow | Result |
|---|---|
| First letter "W" shows suggestions | ok |
| `+` on the empty search box: quantity 1 → 2 | ok |
| `-` on the empty search box: 2 → 1 | ok |
| `-` on the last unit removes the line and shows Undo | ok |
| Undo brings the line back with quantity 1 | ok |
| Shift+Enter with text in the box is refused with a message, and nothing is added | ok |
| Shift+Enter on the empty box opens the payment step | ok |
| Shift+Enter (pressed twice) on the payment step with cash typed creates **no** sale (4 → 4) | ok |

## 6. Screenshots inspected by eye (after)

- Sell with three lines: Arabic 1366, English 1024.
- Sell Undo bar.
- Customers with an account open (list and card now the same width).
- Expenses, dark.
- Admin.
- Help, English and Arabic (with the "English for now" notice).

The other generated screenshots were checked only by the automatic geometry checks, not individually by eye.

## 7. Limits

- The interactive DevTools Flexbox/Grid panels were not used. Layout information came from computed styles instead.
- Screenshots cover the visible window only, not the full scroll height. The scroll height is recorded in the JSON.
- No pixel-diff tool was added. Before/after comparison is by eye.
- The geometry checks find overlaps, misalignment, clipping and hidden overflow. They do not judge visual design (spacing taste, colour balance).
- Tested on this PC only (Windows, 100 % scaling).
- **Still open (minor):** the Sell keyboard hint now takes two lines in the search panel, because it lists more keys. It is readable and does not overlap anything.
