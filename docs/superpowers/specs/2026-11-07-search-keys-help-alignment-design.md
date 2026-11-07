# Design: first-letter search with demand ranking, quantity minus, Shift+Enter, Help Centre, alignment audit

Date: 2026-11-07. Branch `feature/owner-tools` @ `2404c12`. Source: the owner's master prompt of 2026-11-07.

## Intent

The goals:
- make the cashier faster;
- make product suggestions smarter, using the store's real sales;
- make the app easy to learn for staff of any age;
- make the layout precise.

The constraints:
- no Playwright or other browser-automation framework for this work;
- no changes to money, stock, VAT, invoice numbering or ZATCA behaviour;
- one source of truth for search behaviour, cart quantity, checkout transitions and help content.

Decisions taken with the owner (2026-11-07):
- The design below is approved as summarised in chat.
- **The Help Centre is English only for now.** Arabic comes later, after the owner checks the wording. In the Arabic UI the Help tab says so.

## 1. Search from the first character

### Where search exists today (all to be covered)

| Place | Service | Today |
|---|---|---|
| POS search box (`SearchBox.tsx`) | `catalog.suggest` → `services/search.ts searchProducts` | Names need 3 Latin or 2 Arabic letters (`minNameChars`); codes have no minimum |
| Product pickers: Products, Stock (receive, wastage, count), Purchases (returns) | `catalog.search` → the same service | Same minimum |
| Customers tab | `credit.find` (`services/credit.ts`) | Works from 1 character; ordered by name |
| Sell customer box | `customer.find` (`services/parties.ts`) | Works from 1 character on Enter |
| Suppliers | Drop-down lists only | No search to change |
| Refund | Exact invoice number | Unchanged (exact lookup) |
| Expenses | Payee filter (substring) | Works from 1 character |
| Help Centre | New | From the first character |

### Product ranking

The match levels stay first, and their order never changes:

1. barcode;
2. SKU/PLU;
3. exact name;
4. name starts with;
5. word starts with;
6. alias/category;
7. SKU starts with.

**Within a level**, products are ordered by **demand score**, then by the current tie-breakers (shorter name, then alphabetical). A popular product can therefore never jump above a stronger match. Typo tolerance is **not** added: it would weaken exact matching, and scanner and typed codes must stay exact.

One- and two-character queries:
- use the indexed name "starts with" range (B-tree on `name_en_norm` / `name_ar_norm`) and word prefixes;
- FTS is used only from 2 characters (its prefix index covers 2–3);
- a one-character FTS query is not run.

Result limits: POS 8 for one character and 12 otherwise; pickers 20.

### Demand score (`services/demand.ts`, new)

- **Source:** completed sales only. A row in `sales` is always a completed sale: there are no drafts, and finalised sales are immutable. Held bills are not sales.
- **Unit counted:** the number of distinct sales containing the product (`sale_lines`, one per product per sale). Units are not used, because kilograms and pieces cannot be compared.
- **Refunds:** each refund containing the product subtracts its share of that sale (refunded qty ÷ sold qty).
- **Score:**

  ```
  0.5 · (sales in last 7 days ÷ 7) + 0.3 · (last 30 ÷ 30) + 0.2 · (last 90 ÷ 90)
  ```

  This is the net number of sales per day, weighted towards recent days.
- **Conservative rule:** a product with fewer than **3** net sales in 90 days scores 0. That is neutral, not a penalty: new products keep their normal place within their match level.
- **Cache:**
  - one in-memory map per process, keyed by the newest `sales.id` and `refunds.id`;
  - it is recomputed (one grouped query over 90 days, using the `sales.created_at` index) only when a sale or refund has been added since;
  - no keystroke recomputes anything else;
  - no migration and no network.
- **Not done:** time-of-day and day-of-week weighting. The store is not live yet, so there is not enough history. Recorded as a limitation.

### Customer ranking

`credit.find` orders by:
1. exact phone or ID;
2. name starting with the text;
3. everything else;

then by the last activity (latest sale or payment). Only customer records are used.

### Shared front-end behaviour

`renderer/useSuggest.ts` (new hook) provides:
- debounce;
- a sequence guard (stale answers are dropped);
- IME composition guard;
- ↑/↓/Enter/Esc handling;
- the empty state.

`SearchBox` (POS), the product pickers, the Customers search and the Help search use it. Data still comes from each domain's own service and its permission checks.

## 2. Quantity minus and plus on cart lines

- **Unit lines** show `[−] qty [+]`. The middle is an input for typing a quantity.
  - `+` adds 1; `−` subtracts 1; typing sets a whole number of 1 or more.
  - `−` on 1, or typing 0, removes the line. A small **Undo** puts it back (same product, quantity and discount).
  - Removal is audited exactly like the ✕ button (`bill.removed`), and the undo is not hidden.
- **Weighed lines** (from scale labels) show their weight with no `±`. The label is the weight; typing a weight remains blocked (owner decision Q-8).
- **Keyboard:**
  - empty search box: `-` subtracts 1 from the last unit line added, mirroring `+`;
  - in the quantity step: `-` subtracts 1 (never below 1).
- **One quantity state:** pure functions in `core/cart.ts` (`incrementLine`, `decrementLine`, `setLineQty`), unit-tested. Totals keep using `computeInvoice` (`core/vat.ts`). There is no new money logic.

## 3. Shift+Enter: finish taking the order

This is part of the existing state machine in `renderer/checkout-keys.ts`.

| State | Shift+Enter |
|---|---|
| Search box empty, bill has items | Go to the payment step (same as Enter on the empty box) |
| Search box has text | Refused: "Pick the product (↑↓ Enter) or clear the search first" |
| Quantity step open | Refused: "Press Enter to add the item, or Esc to cancel" |
| Bill empty, or payment saving | Nothing |
| Payment step | **Nothing.** It never pays, so a held or repeated Shift+Enter cannot create a sale |

The usual guards apply:
- auto-repeat ignored;
- 350 ms after a step change;
- IME composition ignored;
- not acted on from other fields (supervisor PIN, discount boxes, any textarea).

Enter, Ctrl+Enter, Esc, `+` and the scanner path are unchanged. The hint "Shift+Enter = payment" is shown next to the existing hints.

## 4. Help Centre (English)

- **One source:** `src/renderer/help/content.ts`, a typed list of sections and articles. Each article has:
  - id;
  - title;
  - search words;
  - "What this does";
  - steps;
  - "What you should see";
  - "If something goes wrong";
  - an optional "Ask a supervisor when…".
- **Manual:** `scripts/build-manual.mjs` writes `docs/user-guide/POS_USER_MANUAL.md` from the same source. A Vitest test fails if the committed manual differs from the generated one.
- **Content scope:** only what the app does today. The inventory is in the audit document; incomplete features (ZATCA, phone dashboard, sticker printing, typing a weight) are **not** taught.
  - **Sections:** Getting started, Selling, Taking payments, Customers and credit, Suppliers and purchasing, Stock and products, Returns and refunds, Expenses and accounts, Reports, Shifts and daily work, Backup and recovery.
  - **Scenarios:** A–J from the prompt, where the feature exists.
- **Interface:**
  - a "Help" tab, visible to every role, last in the bar, with a "?" icon;
  - a left list of sections, the article on the right;
  - large step numbers;
  - key caps for keys;
  - A−/A+ text size, remembered per till;
  - search from the first character over titles and search words;
  - a "Print this guide" button.
  - Arabic UI: the tab shows "Help is available in English for now".
- **Context links:** a small "?" beside complex screens opens the matching article:
  - Sell (payment step);
  - Customers (receive a payment);
  - Purchases (pay a supplier);
  - Stock;
  - Refund;
  - Expenses.

## 5. Alignment audit without Playwright

- **Pure geometry checks:** `src/core/geometry-audit.ts`, unit-tested on rectangle fixtures:
  - overlaps between unrelated siblings, with an allowlist for overlays: suggestions, dropdowns, badges, focus rings;
  - repeated elements whose top or height differs by more than 1.5 px (buttons in one group, inputs in one form row, cards in one grid row, table header vs cell column edges);
  - elements outside their parent or the viewport;
  - horizontal page overflow.
- **DOM collector:** a self-contained function that gathers element rectangles and computed styles and returns findings. It runs inside the real Electron page.
- **Runner:** an audit mode in `src/main/main.ts`, active **only** when `POS_UI_AUDIT=<folder>` is set. It uses Electron's own APIs:
  - `webContents.executeJavaScript` to log in, switch tab, theme, language and size;
  - `webContents.sendInputEvent` for real key presses (first-letter search, `+`/`−`, Shift+Enter);
  - `webContents.capturePage` for screenshots;
  - writes PNG + JSON findings, plus an overlay screenshot with suspect boxes outlined, then quits.

  The seed data is fake (the same seed as the earlier visual QA, moved into a non-Playwright `scripts/ui-audit.cjs`). Nothing is shipped in normal runs.
- **Honest limits:**
  - I cannot click through the DevTools Flexbox/Grid panels by hand. Their information is read as computed styles instead.
  - No pixel-diff dependency is added; before/after screenshots are compared by eye.
- **Fixes:** at the source rule in `styles.css` or the component, never with negative margins or hidden overflow. Each fix is recorded with its root cause in `docs/audit/UI_ALIGNMENT_REPORT.md`.

## 6. Testing

- **Vitest** (`npm test`) covers:
  - first-character search, ranking levels, demand scoring and the conservative rule, refunds subtracted, cache invalidation, new products, Arabic first-letter;
  - customer ranking;
  - cart increment, decrement, zero-removal and undo;
  - key decisions for `-` and Shift+Enter (repeat, guard, IME, unresolved search, payment step);
  - help search and the manual sync;
  - geometry checks.
- **Benchmark:** `scripts/search-bench.cjs` gains a one-character case; p50/p95 are recorded from a real run.
- **Electron runner:** real key presses and screenshots, inspected by eye.
- **Not run in this task:** `npm run e2e` / `e2e/*.mjs` (Playwright). They stay in the repo unchanged.

## Out of scope

- Typo tolerance.
- Time-of-day ranking.
- Arabic help text.
- New dependencies.
- Changes to services that post money or stock.
