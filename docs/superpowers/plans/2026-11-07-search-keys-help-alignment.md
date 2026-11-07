# Search, Quantity Keys, Help Centre and Alignment Audit: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Product search from the first character, ranked by real sales demand.
- `[−] qty [+]` on cart lines, plus the `-` key.
- Shift+Enter goes to payment.
- An English Help Centre, plus a manual generated from it.
- An Electron-native alignment audit with fixes.

**Architecture:**
- **Pure logic in `src/core/*`**, unit-tested in Vitest (node environment): cart quantity, geometry checks, suggestion keys, help search.
- **Demand ranking in a new service**, `src/services/demand.ts`. It is consumed by `searchProducts` only as a tie-break inside a match level.
- **Help content:** one TypeScript file feeds both the Help tab and `docs/user-guide/POS_USER_MANUAL.md`.
- **UI audit:** an environment-gated mode inside the real Electron app. It drives the app with `executeJavaScript`, `sendInputEvent` and `capturePage`.

**Tech Stack:** Electron 45, React 19, TypeScript 6, better-sqlite3, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-search-keys-help-alignment-design.md`

## Global Constraints

- **No Playwright.**
  - Do not run `npm run e2e`, `e2e/*.mjs` or `scripts/ui-shots.mjs`.
  - Do not add Playwright or any browser-automation dependency.
  - Do not delete or change existing Playwright tests or config.
- **No new npm packages.**
- **Behaviour that must not change:** VAT, invoice numbering, ZATCA processing, stock movements, journal posting.
- **No database migration.** Never touch the production database: tests use `makeTestCtx()`, and the audit uses a temporary folder with fake data.
- **Permissions:** keep every existing `requirePermission`. Ranking reads must not leak data across permissions.
- **Money and quantities:**
  - money is in halalas and quantities are in milli-units;
  - `Math.round` and `toFixed` are banned by ESLint, so use `roundDiv` from `core/money` where money rounding is needed;
  - demand scores are plain floats used for ordering only.
- **Text in the UI:**
  - every new `t('…')` string needs an Arabic entry in `src/renderer/i18n.tsx` (`i18n.test.ts` enforces this);
  - help article text is English and is **not** passed through `t()`.
- **Colours:** use CSS tokens only. No hex or rgb in `.tsx` (`theme.test.ts`). Light and dark token sets must match.
- **IPC:** new channels go in three places: zod schema in `src/shared/ipc.ts`, `PRELOAD_CHANNELS` in `src/preload/preload.ts`, and `src/main/handlers.ts`.
- **Debug code:** no debug overlay or audit code may run unless `POS_UI_AUDIT` is set **and** `app.isPackaged` is false.
- **Help:** it must teach only features that exist today. No ZATCA submission, phone dashboard, sticker printing or manual weight entry.
- **Git:** commit locally after each task, ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Never push.**
- **Verification commands:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

These failure modes are not covered by the per-step tests, so a test is added for each in its task:

1. **A barcode or PLU scanned while one letter is in the box:** it must still resolve exactly; the first-letter path must never shadow a code (Task 4, `code beats one-letter name`).
2. **Arabic single letter with alef or hamza variants**, for example `ا` vs `أ`: it must match both spellings (Task 4, `arabic one letter folds alef`).
3. **`−` on a line that has a discount, then Undo:** the discount must come back exactly. Totals must equal `computeInvoice` of the restored lines (Task 7, `undo restores discount`).
4. **Shift+Enter held down (auto-repeat), or pressed on the payment step with cash typed:** it must never pay (Task 8, `shift-enter never pays`).
5. **A product with only refunded sales,** net ≤ 0: it must score 0, never negative, and not sink below new products (Task 3, `fully refunded scores zero`).

---

### Task 0: Phase 0 audit document and task ledger

**Files:**
- Create: `docs/audit/SEARCH_KEYBOARD_HELP_ALIGNMENT_AUDIT.md`

- [ ] **Step 1: Write the audit.** It has these sections:
  - every search place, with its service, from the spec table;
  - the current gates: `minNameChars` in `src/core/search-normalize.ts`, and the gate in `SearchBox.tsx`;
  - cart quantity paths in `Sell.tsx`: `addLine`, `incLast`, the qty step, `removeLines`;
  - the key map: `decideKey` in `checkout-keys.ts`;
  - the feature inventory for Help: one line per tab, saying what exists and what does not;
  - the screens and states for the alignment audit;
  - which `package.json` scripts use Playwright (`e2e`) and so will not be run;
  - a **task ledger** table with columns Task / Status / Evidence, rows T0–T12, all "pending".
- [ ] **Step 2: Commit.** Message: `docs: phase 0 audit for search, keys, help, alignment`.

### Task 1: Geometry checks (pure)

**Files:**
- Create: `src/core/geometry-audit.ts`
- Test: `src/core/geometry-audit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BoxInfo { id: string; path: string; parent: string | null; role: 'button'|'input'|'select'|'card'|'tile'|'th'|'td'|'other'; group: string | null; rect: { x: number; y: number; w: number; h: number }; overlay: boolean; clipsChildren: boolean; text?: string }
  export interface Snapshot { screen: string; viewport: { w: number; h: number }; scrollWidth: number; boxes: BoxInfo[] }
  export interface Finding { kind: 'overlap'|'misaligned-top'|'misaligned-height'|'out-of-parent'|'out-of-viewport'|'page-overflow'|'column-edge'; severity: 'high'|'medium'|'low'; ids: string[]; detail: string }
  export function auditGeometry(s: Snapshot, tolerancePx?: number): Finding[]
  ```
  - `tolerancePx` defaults to `1.5`.
  - `group` is set by the collector for siblings that should line up: the same flex row, form row, grid row, or a table column (`th`/`td` share `col:<index>`).

- [ ] **Step 1: Write failing tests**, one per rule:
  - **`overlap`:** two non-overlay siblings that intersect by more than 1 px → finding. An overlay box → none.
  - **`misaligned-top`:** three buttons in one group with tops `[10, 10, 13]` → one finding naming the third. `[10, 11, 10]` → none (within 1.5 px).
  - **`misaligned-height`:** heights `[36, 36, 32]` → a finding.
  - **`out-of-parent`:** a child extends 5 px beyond a parent that has `clipsChildren` → high.
  - **`page-overflow`:** `scrollWidth > viewport.w + 1` → high.
  - **`column-edge`:** a `th` x-edge differs from its column's `td` x-edge by more than 1.5 px → medium.
- [ ] **Step 2:** Run `npx vitest run src/core/geometry-audit.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `auditGeometry`. Group boxes by `parent` for overlap, and by `group` for alignment. O(n²) per parent is fine.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(audit): pure geometry checks`.

### Task 2: Electron-native UI audit runner and "before" captures

**Files:**
- Create: `src/main/ui-audit.ts` (runner; imports `auditGeometry`)
- Create: `src/main/ui-audit-collect.ts`. It exports `COLLECT_SOURCE: string`, the in-page collector as a string, so the main tsconfig needs no DOM lib.
- Modify: `src/main/main.ts`, after `win.loadFile(...)`: `if (process.env.POS_UI_AUDIT && !app.isPackaged) void runUiAudit(win, process.env.POS_UI_AUDIT);`
- Create: `scripts/ui-seed.mjs`. It holds the `seed(dbPath)` function moved out of `scripts/ui-shots.mjs`, unchanged.
- Modify: `scripts/ui-shots.mjs`. Import `seed` from `./ui-seed.mjs` instead of defining it. Do **not** run this script.
- Create: `scripts/ui-audit.mjs`.
  - It makes a temporary folder and seeds it.
  - It spawns `node_modules/.bin/electron .` through `child_process.spawn`, with `POS_USER_DATA=<tmp>`, `POS_RECEIPT_TO_FILE=<tmp>/r.html` and `POS_UI_AUDIT=<out folder>`.
  - It waits for exit and prints the summary.
- Modify: `.gitignore`. Add `ui-audit/`.
- Modify: `package.json`. Add the script `"ui-audit": "npm run build && node scripts/ui-audit.mjs"`.

**Interfaces:**
- Produces:
  ```ts
  export async function runUiAudit(win: BrowserWindow, outDir: string): Promise<void>
  ```
  - It writes `<outDir>/<screen>__<theme>-<lang>-<w>x<h>.png`.
  - It writes the matching `.json`: the `Snapshot` plus its `Finding[]`.
  - It writes `…__overlay.png`, with suspect boxes outlined by an injected `outline: 2px solid` style that is removed after capture.
  - It writes `summary.json`, then calls `app.quit()`.
- **Matrix:**
  - **Screens:** login, Sell (empty), Sell (3 lines), Sell (payment step), Refund, Customers (account open), Stock, Products, Purchases, Expenses, Accounting, Reports, Shift, Admin, and Help (added once Task 10 lands; skipped if the tab is missing).
  - **Variants:** light-en-1366×768, dark-en-1366×768, light-ar-1366×768, light-en-1024×700.
- **Driving the app:**
  - window size: `win.setContentSize`;
  - theme and language: through the same localStorage keys and reload that `theme.tsx` and `i18n.tsx` read;
  - login: real typing with `sendInputEvent` (`keyDown`/`char`/`keyUp`), using the seed's test PINs;
  - tab switch: `executeJavaScript` that clicks the nav button by its text;
  - key flows: real key events:
    - Sell: type one letter, then check the suggestion list is visible;
    - `+` and `-` (from Task 8);
    - Shift+Enter (from Task 8).

  Key-flow results go into `summary.json` as `{flow, ok, detail}`.

- [ ] **Step 1:** Run `npm run typecheck`. Expected: exit 0 after adding the files.
- [ ] **Step 2:** Run `npm run ui-audit -- ui-audit/before`. Expected: PNG and JSON files in `ui-audit/before/`, `summary.json` present, process exit 0.
- [ ] **Step 3:** Check that a normal start ignores the audit. Run `npm start` without `POS_UI_AUDIT` and close it: no `ui-audit` output, no outline styles.
- [ ] **Step 4: Commit** the code only (screenshots are git-ignored). Message: `feat(audit): Electron-native UI audit runner (env-gated, dev only)`.

### Task 3: Demand score service

**Files:**
- Create: `src/services/demand.ts`
- Test: `src/services/demand.test.ts` (uses `makeTestCtx`, `seedUsers`, `createProduct`, `openShift`, `finalizeSale`, `createRefund`)

**Interfaces:**
- Produces:
  ```ts
  export const DEMAND_MIN_SALES = 3;
  export function demandScores(ctx: Ctx, now?: Date): Map<number, number> // productId -> score; products below the minimum are absent
  export function resetDemandCache(): void // tests only
  ```
- **Score:**
  - per product, `0.5·n7/7 + 0.3·n30/30 + 0.2·n90/90`;
  - `nX` = number of distinct sales in the last X days containing the product, minus the refunded share of each such sale (Σ refund qty ÷ sale-line qty, capped at 1 per sale);
  - products with net `n90 < 3`, or with net ≤ 0, are left out of the map.
- **Cache:**
  - module-level `{ key: string; map }`, where `key = \`${maxSaleId}:${maxRefundId}\``;
  - recompute only when the key changes.
- **Query:** one grouped SELECT over `sales` joined to `sale_lines` with `created_at >= now-90d`, plus one over `refunds`/`refund_lines` joined back to the sale's `created_at`. The window uses the sale's date.

- [ ] **Step 1: Write failing tests:**
  - `counts sales not units`: one sale of 5 units → n = 1.
  - `below three sales scores nothing`: 2 sales → absent.
  - `recent sales weigh more`: A has 3 sales today, B has 3 sales 60 days ago (insert with a `created_at` override through a direct UPDATE in the test, since sales are immutable — if the immutability trigger blocks it, pass `now` 60 days ahead instead) → score A > B > 0.
  - `fully refunded scores zero`: 3 sales, each fully refunded → absent.
  - `half refund subtracts half`: 4 sales, one refunded half → n = 3.5.
  - `cache refreshes after a new sale`: score, add a sale, score again → different value without calling `resetDemandCache`.
  - `held bills do not count`: `holdBill` → absent.
- [ ] **Step 2:** Run `npx vitest run src/services/demand.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(search): demand score from completed sales, net of refunds`.

### Task 4: First-character product search with the demand tie-break

**Files:**
- Modify: `src/core/search-normalize.ts`. `minNameChars` returns `1` for all text. Keep the export; callers stay compiling.
- Modify: `src/services/search.ts` (`searchProducts`)
- Modify: `src/main/handlers.ts`. `catalog.suggest` uses limit `text.trim().length === 1 ? 8 : 12`; `catalog.search` keeps 20.
- Modify: `scripts/search-bench.cjs`. Add 1-character cases (`'a'`, `'م'`) and print p50/p95.
- Test: `src/services/search.test.ts` (new) or extend `retail-scenarios.test.ts`.

**Interfaces:**
- Consumes: `demandScores(ctx)` from Task 3.
- Produces: the `searchProducts(ctx, text, limit)` signature is unchanged.
  - **Final sort:** `rank` → demand (higher first, missing = 0) → name length → `localeCompare`.
  - **When the normalised text has 1 character:** run the exact-code lookups and the name-prefix range scan only. Skip FTS and skip the 7th-level SKU prefix scan.

- [ ] **Step 1: Write failing tests:**
  - `one letter returns name-prefix matches`: products "Apple", "Apricot", "Banana", query `a` → contains Apple and Apricot, not Banana.
  - `arabic one letter folds alef`: names "أرز" and "ارز بسمتي", query `ا` → both.
  - `demand breaks ties inside a level`: "Apricot" has 3 sales today and "Apple" none; query `ap` → Apricot first.
  - `demand never beats a stronger match`: product named exactly "ap" (rank 3) with no sales, and "apricot" (rank 4) with 10 sales; query `ap` → "ap" first.
  - `code beats one-letter name`: the barcode `"7"` exists, and a product named "7up"; query `7` → the barcode product first, matchedBy `'barcode'`.
  - `new products are not penalised`: a new product with no sales still appears within the limit when it is a level-4 match and fewer than `limit` products match.
- [ ] **Step 2:** Run `npx vitest run src/services/search.test.ts`. Expected: FAIL (one-letter returns nothing today).
- [ ] **Step 3:** Implement the changes above.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all pass. Existing search tests keep their assertions; a test that asserted "no results under 3 letters" is updated, with a comment explaining why.
- [ ] **Step 5:** Run `npm run build && node scripts/search-bench.cjs`. Record p50/p95 for the 1-character cases. Expected: p95 < 20 ms on the bench catalogue.
- [ ] **Step 6: Commit.** Message: `feat(search): suggestions from the first character, demand tie-break within match level`.

### Task 5: Customer ranking

**Files:**
- Modify: `src/services/credit.ts` (`findCreditCustomers`, line ~497)
- Modify: `src/services/parties.ts` (`findCustomers`)
- Test: `src/services/credit.test.ts` (add cases)

**Interfaces:**
- The signatures are unchanged.
- **New ORDER BY:**
  1. `CASE WHEN phone = ? OR CAST(id AS TEXT) = ? THEN 0 WHEN name LIKE ? || '%' THEN 1 ELSE 2 END`;
  2. then the last activity descending: `MAX` of the customer's `sales.created_at` and `customer_receipts.created_at`, via correlated subqueries;
  3. then `name`.
- Permission checks are unchanged.

- [ ] **Step 1: Write failing tests:**
  - `exact phone first`;
  - `name prefix before contains`: "Ali" vs "Khalid Ali", query `al` → Ali first;
  - `recent customer first among equals`: two names starting with "Mo"; the one with a sale today comes first.
- [ ] **Step 2:** Run `npx vitest run src/services/credit.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(search): customer lookup ranked by match and recent activity`.

### Task 6: Shared suggestion behaviour

**Files:**
- Create: `src/core/suggest-keys.ts` (pure)
- Test: `src/core/suggest-keys.test.ts`
- Create: `src/renderer/useSuggest.ts`
- Modify: `src/renderer/SearchBox.tsx` (use the hook; keep its props)
- Modify: the product pickers in `Products.tsx:18`, `Purchases.tsx:179`, `Stock.tsx:35` and `Stock.tsx:152`, and the Customers search in `Customers.tsx`, so that they use `useSuggest`.

**Interfaces:**
- Produces:
  ```ts
  // core/suggest-keys.ts
  export function moveActive(active: number, count: number, key: 'ArrowDown'|'ArrowUp'): number // wraps; -1 when count 0
  export function shouldQuery(text: string, composing: boolean): boolean // false for blank or while composing; true from 1 char
  // renderer/useSuggest.ts
  export function useSuggest<T>(fetch: (text: string) => Promise<T[]>, opts?: { debounceMs?: number }): { text: string; setText(v: string): void; items: T[]; active: number; onKeyDown(e: React.KeyboardEvent): T | null; reset(): void; composing: { onCompositionStart(): void; onCompositionEnd(e: React.CompositionEvent<HTMLInputElement>): void } }
  ```
  - `debounceMs` defaults to 150.
  - It keeps the `seq` stale-answer guard currently in `SearchBox`.
  - `onKeyDown` returns the picked item on Enter, and resets on Escape.
- `SearchBox` keeps its scanner behaviour: `onCode` for code-like text, plus `onEmptyKey`. Only the fetching and list state move into the hook.

- [ ] **Step 1: Write failing tests:**
  - `moveActive` wraps both ways and returns -1 when the list is empty;
  - `shouldQuery('a', false)` is true;
  - `shouldQuery('', false)` and `shouldQuery('a', true)` are false.
- [ ] **Step 2:** Run `npx vitest run src/core/suggest-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the core functions, then the hook, then rewire the callers.
- [ ] **Step 4:** Run `npm run typecheck && npx vitest run`. Expected: exit 0, all pass.
- [ ] **Step 5: Commit.** Message: `refactor(search): one suggestion hook for POS, pickers and customers`.

### Task 7: Cart quantity functions and `[−] qty [+]`

**Files:**
- Create: `src/core/cart.ts`
- Test: `src/core/cart.test.ts`
- Modify: `src/renderer/Sell.tsx`:
  - move the `Line` interface (line 16) into `core/cart.ts` as `CartLine<P>`;
  - replace the qty cell (line ~389) and `incLast` (line ~147).
- Modify: `src/renderer/styles.css` (`.qty-stepper`)
- Modify: `src/renderer/i18n.tsx` (new strings)

**Interfaces:**
- Produces:
  ```ts
  export interface CartLine<P extends { id: number; sellMode: 'unit'|'weight' }> { product: P; qty: number; discount: number; scanCode?: string }
  export function incrementLine<P>(lines: CartLine<P>[], idx: number): CartLine<P>[]   // +1000 for unit lines; unchanged for weight lines
  export function decrementLine<P>(lines: CartLine<P>[], idx: number): { lines: CartLine<P>[]; removed: { line: CartLine<P>; index: number } | null } // qty 1000 → removed
  export function setLineQty<P>(lines: CartLine<P>[], idx: number, wholeUnits: number): { lines: CartLine<P>[]; removed: { line: CartLine<P>; index: number } | null } // 0 → removed; unit lines only; max 9999
  export function restoreLine<P>(lines: CartLine<P>[], removed: { line: CartLine<P>; index: number }): CartLine<P>[] // reinserts at min(index, length)
  ```
- **In `Sell.tsx`:**
  - Unit lines render `[−] <input aria-label="quantity"> [+]`; weight lines render the formatted weight only.
  - A removal through `−`, or a typed 0, calls the existing audited path: the same `bill.removed` call as `removeLines('line_removed', …)`. It then shows an Undo bar ("Item removed. Undo") for 6 s; Undo calls `restoreLine`.
  - `incLast` becomes `incrementLine` on the index of `lastUnitProduct`.

- [ ] **Step 1: Write failing tests:**
  - increment adds 1000 to unit lines and leaves weight lines unchanged;
  - decrement 3000 → 2000;
  - decrement 1000 → removed, with index returned;
  - `setLineQty(…, 0)` → removed;
  - `setLineQty(…, 10000)` → 9 999 000;
  - `undo restores discount`: a line with discount 150, decrement to removal, restore → deep-equals the original, and `computeInvoice` totals before and after are equal;
  - decrement on a weight line → unchanged, `removed` null.
- [ ] **Step 2:** Run `npx vitest run src/core/cart.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `cart.ts`, then wire up `Sell.tsx`, the CSS and the i18n strings.
- [ ] **Step 4:** Run `npm run typecheck && npm run lint && npx vitest run`. Expected: 0 / 0 / all pass.
- [ ] **Step 5: Commit.** Message: `feat(sell): minus and plus on cart lines, zero removes with undo (audited)`.

### Task 8: `-` key and Shift+Enter in the checkout state machine

**Files:**
- Modify: `src/renderer/checkout-keys.ts`
- Test: `src/renderer/checkout-keys.test.ts`
- Modify: `src/renderer/Sell.tsx`:
  - pass `shift` and `composing` into `decideKey`;
  - handle the new actions;
  - add the hint "Shift+Enter = payment".
- Modify: `src/renderer/i18n.tsx`

**Interfaces:**
- **`KeyInfo` gains** `shift: boolean; composing: boolean`.
- **`KeyAction` gains** `{ type: 'decLast' } | { type: 'qtyDec' } | { type: 'refuse'; reason: 'split' | 'pendingSearch' | 'pendingQty' }`. The existing `refuse` widens.
- **`incrementQtyText` gets a sibling:** `export function decrementQtyText(text: string): string` (minimum `"1"`).
- **Rules:**
  - `composing` → `none`, before any other rule.
  - Repeat: Shift+Enter or `-` with repeat → `swallow`.
  - **Search step:**
    - `-` with an empty box and items → `decLast`;
    - Shift+Enter with an empty box → `openPay` (same guards as Enter: the 350 ms guard, not busy, items present, otherwise `swallow`);
    - Shift+Enter with text in the box → `refuse` `pendingSearch`.
  - **Qty step:**
    - `-` → `qtyDec`;
    - Shift+Enter → `refuse` `pendingQty`.
  - **Pay step:** Shift+Enter → `swallow`.
  - Field `other` (PIN, discount): `none`.
  - Plain Enter and Ctrl+Enter keep their current rules exactly.

- [ ] **Step 1: Write failing tests:**
  - shift-enter opens pay from the empty search when the bill has items;
  - refused with search text (`pendingSearch`);
  - refused in the qty step (`pendingQty`);
  - swallowed on an empty bill;
  - swallowed within 350 ms;
  - `shift-enter never pays`: pay step with field cash and with field cardPart, repeat true and false → never `payCash` or `payCard`;
  - composing → none;
  - `-` → `decLast` / `qtyDec`;
  - `decrementQtyText('1') === '1'` and `decrementQtyText('5') === '4'`;
  - all existing tests unchanged and passing.
- [ ] **Step 2:** Run `npx vitest run src/renderer/checkout-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the state machine, then the `Sell.tsx` wiring.
  - `decLast` uses `decrementLine` (Task 7), including Undo.
  - The refuse reasons show the spec's messages, translated.
- [ ] **Step 4:** Run `npm run typecheck && npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Run `npm run ui-audit -- ui-audit/keys`. Expected: `summary.json` flows `first-letter`, `plus`, `minus` and `shift-enter-to-pay` are ok:true, and `shift-enter-on-pay-no-sale` is ok:true (the sales count is unchanged).
- [ ] **Step 6: Commit.** Message: `feat(keys): minus key and Shift+Enter to payment, never pays`.

### Task 9: Help content, help search and the generated manual

**Files:**
- Create: `src/renderer/help/content.ts`. It holds the content only and imports nothing from React.
- Create: `src/core/help-search.ts`
- Test: `src/core/help-search.test.ts`
- Create: `src/renderer/help/manual.ts`
- Test: `src/renderer/help/manual.test.ts`
- Create: `scripts/build-manual.mjs`. It spawns `npx vitest run src/renderer/help/manual.test.ts` with `WRITE_MANUAL=1` set in the child env (cross-platform, no extra packages).
- Create: `docs/user-guide/POS_USER_MANUAL.md` (generated)
- Modify: `package.json`. Add the script `"manual": "node scripts/build-manual.mjs"`.

**Interfaces:**
- Produces:
  ```ts
  export interface HelpArticle { id: string; section: HelpSectionId; title: string; keywords: string[]; what: string; steps: string[]; expect: string; problems: { problem: string; fix: string }[]; supervisor?: string; keys?: string[] }
  export type HelpSectionId = 'start'|'selling'|'payments'|'customers'|'suppliers'|'stock'|'returns'|'expenses'|'reports'|'shifts'|'backup'|'scenarios'
  export const HELP_SECTIONS: { id: HelpSectionId; title: string }[]
  export const HELP_ARTICLES: HelpArticle[]
  // core/help-search.ts
  export function searchHelp<A extends { title: string; keywords: string[] }>(articles: A[], text: string): A[] // from 1 char; title-prefix > keyword-prefix > title-contains; case-insensitive
  // help/manual.ts
  export function renderManual(): string // markdown: title, contents list, then sections → articles
  ```
- **Content:**
  - The sections are those listed in the spec.
  - **Scenarios A–J** are taken from the master prompt, one article each, only where the feature exists. A scenario whose feature is missing is left out, and the audit document says why.
  - **The Sell articles cover:** first-letter search, scanner, `+`/`−`, Shift+Enter, Enter/Ctrl+Enter payment, holding a bill, the customer box, credit sale.
  - **Writing:** plain words and short steps, as for a new cashier. No caveman style. No store secrets: example names are fictional.
- **The `manual.test.ts` test:** `renderManual()` must equal the file contents with line endings normalised. With `WRITE_MANUAL=1` it writes the file and passes.

- [ ] **Step 1: Write failing tests:**
  - `searchHelp` from one letter;
  - the ranking order;
  - every article id is unique;
  - every article has at least 1 step and a non-empty `expect`;
  - every `section` exists in `HELP_SECTIONS`;
  - the manual sync test.
- [ ] **Step 2:** Run `npx vitest run src/core/help-search.test.ts src/renderer/help`. Expected: FAIL.
- [ ] **Step 3:** Implement the search and the renderer, write the content, then run `npm run manual`.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all pass. Then change one word in the manual by hand and re-run: expect the sync test to FAIL. Revert.
- [ ] **Step 5: Commit.** Message: `feat(help): help content, first-letter help search, generated user manual`.

### Task 10: Help tab, context links and text size

**Files:**
- Create: `src/renderer/Help.tsx`
- Modify: `src/renderer/App.tsx`:
  - add `{ id: 'help', label: 'Help', group: 4 }`, visible to all roles and last;
  - add a `openHelp(articleId)` context so other screens can jump to an article.
- Create: `src/renderer/HelpLink.tsx` (`<HelpLink article="…" />`, a small "?" button with `aria-label="Help: <title>"`)
- Modify:
  - `Sell.tsx` (payment step → `payments-take-payment`);
  - `Customers.tsx` (receive payment → `customers-receive-payment`);
  - `Purchases.tsx` (pay supplier → `suppliers-pay`);
  - `Stock.tsx` (→ `stock-overview`);
  - `Refund.tsx` (→ `returns-refund`);
  - `Expenses.tsx` (→ `expenses-record`).

  Each id must exist in `HELP_ARTICLES`; the test below checks it.
- Modify: `src/renderer/styles.css` (`.help`, `.help-steps`, `.kbd`; text-size classes `.help[data-size="1|2|3"]`)
- Modify: `src/renderer/i18n.tsx`. Add "Help", "Help is available in English for now", "Text size", "Print this guide", "Search help".
- Test: `src/renderer/help/links.test.ts`. It greps the `src/renderer/*.tsx` sources for `HelpLink article="…"` and asserts that every id exists.

**Interfaces:**
- Consumes: `HELP_SECTIONS`, `HELP_ARTICLES` and `searchHelp` from Task 9; `useSuggest` is not needed (local filter).
- **Text size:**
  - stored in `localStorage` key `pos.helpSize`, values 1–3, default 2;
  - every read and write is wrapped in try/catch.
- **Arabic UI:** the help body gets `dir="ltr" lang="en"` and a notice at the top.
- **Print:** `window.print()` with a `@media print` rule that hides the nav and the section list.

- [ ] **Step 1: Write the failing links test.** Run `npx vitest run src/renderer/help/links.test.ts`. Expected: FAIL (no links yet).
- [ ] **Step 2:** Implement `Help.tsx`, `HelpLink`, the App wiring, the CSS and the i18n strings.
- [ ] **Step 3:** Run `npm run typecheck && npm run lint && npx vitest run`. Expected: 0 / 0 / all pass, including `i18n.test.ts` and `theme.test.ts`.
- [ ] **Step 4: Commit.** Message: `feat(help): Help tab with search, text size, print, and contextual links`.

### Task 11: Alignment fixes and "after" captures

**Files:**
- Modify: `src/renderer/styles.css` and the components named by the findings
- Create: `docs/audit/UI_ALIGNMENT_REPORT.md`

- [ ] **Step 1:** Run `npm run ui-audit -- ui-audit/mid` (it now includes Help and the new qty stepper). Collect every finding from `summary.json`.
- [ ] **Step 2: For each high or medium finding:**
  - open the overlay PNG;
  - name the root-cause CSS rule or component (superpowers:systematic-debugging);
  - fix it at the source;
  - false positives (an intended overlay, for example) go in the collector allowlist, with the reason in the report.

  Forbidden: negative margins, `overflow:hidden` to hide spill, `!important`.
- [ ] **Step 3:** Run `npm run ui-audit -- ui-audit/after`. Expected: zero high findings, and every remaining medium finding explained in the report.
- [ ] **Step 4:** Compare by eye at least these screenshots, before vs after:
  - Sell light-en-1366;
  - Sell light-en-1024;
  - Sell dark;
  - Sell Arabic;
  - Help light;
  - Help Arabic notice;
  - Customers.

  Record which ones were looked at.
- [ ] **Step 5:** Write `UI_ALIGNMENT_REPORT.md` with:
  - the method (no Playwright);
  - the finding counts before and after;
  - each fix with its root cause;
  - the allowlist;
  - the screenshots inspected;
  - the limits (no interactive DevTools panels, comparison by eye, this PC's display only).
- [ ] **Step 6:** Run `npm run typecheck && npm run lint && npx vitest run`. Then commit with the message `style(ui): alignment fixes from geometry audit; alignment report`.

### Task 12: Verification, reports, review and finish

**Files:**
- Create: `docs/SEARCH_INTELLIGENCE_IMPLEMENTATION.md`. It covers the ranking levels, the demand formula, the cache, the bench p50/p95 numbers, and the limits (no time-of-day, no typo tolerance).
- Create: `docs/IMPLEMENTATION_REPORT_SEARCH_HELP_ALIGNMENT.md`. It covers what was built, the tests, what was not run (e2e) and why, and the remaining risks.
- Modify: `docs/TEST_RESULTS.md` (append the fresh rows)
- Modify: `docs/audit/SEARCH_KEYBOARD_HELP_ALIGNMENT_AUDIT.md` (set each ledger row to done, with evidence)

- [ ] **Step 1 (superpowers:verification-before-completion):** run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Record the exit codes and test counts. Do **not** run `npm run e2e`.
- [ ] **Step 2:** Run `npm run ui-audit -- ui-audit/final`. Expected: every key flow ok:true, 0 high findings.
- [ ] **Step 3:** Write the two reports, update `TEST_RESULTS.md` and the ledger, and commit with the message `docs: search, help, alignment reports and test results`.
- [ ] **Step 4 (superpowers:requesting-code-review):** dispatch a reviewer subagent over `git diff 2404c12..HEAD`. Fix the confirmed findings (superpowers:receiving-code-review), re-run Step 1, and commit.
- [ ] **Step 5 (superpowers:finishing-a-development-branch):** present the options. **Do not push**, and do not offer to push.
