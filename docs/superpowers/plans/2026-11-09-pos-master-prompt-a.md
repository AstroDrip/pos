# POS Master Prompt A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe holding and customer search on Sell, tab memory, better ranking, a readable audit log, an independent books check with cash flow, and a field-level Help registry to the existing POS.

**Architecture:** Extend existing modules: `checkout-keys` and `keyboard-registry` for keys, `held-bills` for holds, `audit.ts` for records, new read-only `integrity.ts` beside the ledger. Decisions live in pure functions tested under Vitest; screens are proved with the Electron-native `ui-audit`.

**Tech Stack:** Electron 45, React 19, TypeScript 6, better-sqlite3, zod, Vitest. No new packages.

**Spec:** `docs/superpowers/specs/2026-11-09-pos-master-prompt-a-design.md`

**Stages:** Six, in the spec's order, 25 tasks. Stage 2's drafts need Stage 1's `hydrateBill`. Stage 6 comes last because it documents the final screens.

## Global Constraints

- Do not change VAT calculations, ZATCA processing, invoice numbering, or inventory accounting and stock movement rules. `sales.ts` and `core/vat.ts` are not edited.
- Do not bypass permissions. No destructive database commands. No automatic repair of financial records.
- No Playwright, no Puppeteer, no browser automation added. Do not run `npm run e2e`, `e2e/*.mjs` or `scripts/ui-shots.mjs`. Do not delete existing Playwright files.
- No new npm packages.
- Tests use made-up data, never the production database. No credentials, real store details or customer details in code, tests, Help or screenshots.
- Money is integer halalas, quantity integer milli-units. `roundDiv`, never `Math.round`, in `src`.
- Migrations are append-only. Existing migrations are never edited. Register new ones in `src/db/migrations.ts`.
- Every new `t()` label gets an Arabic string in `i18n.tsx`. Help content stays English. Arabic screens are not checked.
- Help is plain English and describes only what exists.
- Local commits only. Never push. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- New IPC channels go in three places: `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`.

**Every task ends the same way, in addition to its own steps:** `npm test`, `npm run typecheck` and `npm run lint` all clean. **Every stage ends with:** `npm run ui-audit -- ui-audit/stage-N`, in the background, about 8 minutes. Expected: 0 findings, every flow passing, including the flows added in that stage.

## Review Focus

1. **Handover with the wrong PIN, or to the same person.** The shift stays open and untouched. Test in Task 15.
2. **The shift is closed on the Shift tab while a bill sits in hidden Sell.** On return Sell asks to open a shift, the bill is still there, and it sells into the new shift. Flow in Task 7.
3. **A held bill whose price dropped below its discount.** Recall still works, the bill shows the existing "discount is larger" message, and payment is blocked until it is fixed. Test in Task 2.
4. **A corrupt or old-shape draft or remembered value.** No crash; the app starts clean and the bad draft is removed. Tests in Tasks 6 and 8.
5. **Customer search text that is only wildcards or punctuation** (`%`, `_`, `'`). Returns nothing or a literal match, and no SQL error. Test in Task 4.

---

## Stage 1: Sell keys, hold, customer search

### Task 1: Z key and registry fields

**Files:**
- Modify: `src/renderer/checkout-keys.ts`, `src/renderer/keyboard-registry.ts`, `src/renderer/Sell.tsx`
- Test: `src/renderer/checkout-keys.test.ts`, `src/renderer/keyboard-registry.test.ts`

**Interfaces:**
- Produces: `KeyInfo.letter?: string | null`. `KeyAction` gains `{ type: 'holdBill' }`. `Shortcut` gains `enabled: boolean`, `fixed?: boolean`, `focus: string[]`. Registry entry id `hold.pay`, combo `Z`.

- [ ] **Step 1: Write failing tests in `checkout-keys.test.ts`**

```ts
const z = (o: Partial<KeyInfo> = {}) => key('z', { letter: 'Z', ...o });
const pay = (o: Partial<KeyContext> = {}) => ctx({ step: 'pay', field: 'cash', ...o });
it('Z in Cash received or card part holds', () => { expect(act(z(), pay())).toBe('holdBill'); expect(act(z(), pay({ field: 'cardPart' }))).toBe('holdBill'); });
it('Z anywhere else is typing', () => { expect(act(z(), pay({ field: 'other' }))).toBe('none'); expect(act(z(), ctx())).toBe('none'); expect(act(z(), ctx({ step: 'qty', field: 'qty' }))).toBe('none'); });
it('Z is left to an IME', () => expect(act(z({ composing: true }), pay())).toBe('none'));
it('repeat or busy cannot hold', () => { expect(act(z({ repeat: true }), pay())).toBe('swallow'); expect(act(z(), pay({ busy: true }))).toBe('swallow'); });
it('Z with an empty bill does nothing', () => expect(act(z(), pay({ billHasItems: false }))).toBe('swallow'));
it('Ctrl or Shift with Z is not a hold', () => { expect(act(z({ ctrl: true }), pay())).toBe('none'); expect(act(z({ shift: true }), pay())).toBe('none'); });
```

In `keyboard-registry.test.ts`: every `DIRECT_SHORTCUTS` entry has boolean `enabled` and an array `focus`; `hold.pay` has `fixed: true` and combo `Z`.

- [ ] **Step 2: Run:** `npx vitest run src/renderer/checkout-keys.test.ts src/renderer/keyboard-registry.test.ts`. Expected: FAIL, `holdBill` not returned.
- [ ] **Step 3: Implement.** In `decideKey`, `case 'pay'`, before the Enter handling: `letter === 'Z' && !ctrl && !shift` returns `none` unless field is `cash` or `cardPart`, `swallow` on repeat, busy or empty bill, else `holdBill`. Add `enabled: true` and `focus` to every entry. Add the `hold.pay` entry with `fixed: true`, `owner: 'checkout'`, and plain help text.
- [ ] **Step 4: Wire `Sell.tsx`.** `onStepKey` passes `letter: commandLetter(keyLike(e.nativeEvent))`. On `holdBill`, start a `zTimer` ref of 40 ms that runs the same guarded code as `run('H')`. The `useScanner` callback clears `zTimer` on every key, because the scanner sees each key first. Extract the guarded hold as `runHold()` and use it from both places.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(keys): Z holds the bill on the payment step`.

### Task 2: Hold keeps discounts, prices, customer; recall warns; cancel

**Files:**
- Modify: `src/services/held-bills.ts`, `src/services/parties.ts`, `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`, `src/renderer/Sell.tsx`
- Create test: `src/services/held-bills.test.ts`

**Interfaces:**
- Produces:
  - `HeldPayload.lines[]` gains optional `seenPrice`, `discount`, `scanCode`. `HeldPayload` gains optional `cash`, `card` (`/^\d{0,9}(\.\d{0,2})?$/`).
  - `getCustomer(ctx, id): Customer | null` in `parties.ts`.
  - `hydrateBill(ctx, p: HeldPayload): HydratedBill`, where `HydratedBill = { customer: Customer | null; billKey?: string; lines: { product: Product; qty: number; discount: number; scanCode?: string; seenPrice?: number }[]; dropped: string[]; cash: string; card: string }`.
  - `cancelHeldBill(ctx, userId, id, reason): void`. Channel `hold.cancel`: `{ id, reason: string min 1 max 200 }`.

- [ ] **Step 1: Write failing tests**

Names and assertions:
- `holding creates no sale, payment, stock movement, journal entry or invoice`: table counts for `sales`, `payments`, `stock_movements`, `journal_entries` unchanged after `holdBill`.
- `recall returns discount, scanCode, cash, card, customer`: exact values.
- `an old-format hold still loads`: insert payload `{lines:[{productId,qty:1000}]}`, `hydrateBill` gives `discount: 0, cash: '', card: ''`.
- `a re-priced item comes back at the new price with seenPrice set`: `setPrice`, then `lines[0].product.priceIncl` is new and `seenPrice` is old.
- `a discount bigger than the new line total is kept`: discount unchanged after a price drop.
- `a turned-off item is left off and named`: `dropped` is `['Apple']`, `lines` empty.
- `cancel removes the hold and is audited with the reason`: `bill.cancel` row exists; second cancel throws NOT_FOUND.
- `cancel needs sale.create`: a user with no roles throws.

- [ ] **Step 2: Run** `npx vitest run src/services/held-bills.test.ts`. Expected: FAIL, `hydrateBill` not exported.
- [ ] **Step 3: Implement the service, channels and handler.** `hold.recall` becomes `hydrateBill(ctx, recallBill(...))`. `hold.create` schema accepts the new fields.
- [ ] **Step 4: Wire `Sell.tsx`.** `hold()` sends `seenPrice: l.product.priceIncl`, `discount`, `scanCode`, `cash`, `card`. Its message becomes `Held: {0}.`. `recall()` restores lines, customer, cash, card. Show one warning listing changed prices (`The price of {0} changed from {1} to {2}.`) and dropped items (`{0} is no longer sold and was left off.`). Add a small Cancel button by each held bill. It reveals one text box for the reason and a Confirm button, which calls `hold.cancel`.
- [ ] **Step 5: Run tests.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(hold): keep discounts and customer; warn on changes; cancel a hold`.

### Task 3: F2 and the customer step keys

**Files:**
- Modify: `src/core/shortcuts.ts`, `src/renderer/keyboard-registry.ts`, `src/renderer/checkout-keys.ts`, `src/renderer/Keyboard.tsx`
- Test: `src/core/shortcuts.test.ts`, `src/renderer/keyboard-registry.test.ts`, `src/renderer/checkout-keys.test.ts`

**Interfaces:**
- Produces: `DEFAULT_COMBOS['customer.focus'] = 'F2'`. `GlobalAction` gains `{ type: 'focusCustomer' }`. `KeyContext.field` gains `'customer'`. `refuse.reason` gains `'pendingCustomer'`. `ScreenKeys.focusCustomer?: () => void`. `checkoutActive('customer')` returns `['checkout.open']`.

- [ ] **Step 1: Write failing tests.** `decideGlobal` with `F2`:
  - context `sell`, step `search` gives `focusCustomer`; step `pay` gives `focusCustomer`; step `qty` gives `{type:'refuse',reason:'qty'}`.
  - context `stock` gives `none`; palette open gives `swallow`; repeat gives `swallow`.

  `decideKey`, field `customer`, step `search`:
  - Shift+Enter, empty, items gives `openPay`; with text gives `{type:'refuse',reason:'pendingCustomer'}`; plain Enter gives `none`; no items gives `swallow`.

  `validateOverrides({ 'customer.focus': 'F1' })` is refused as a duplicate.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the registry entry `customer.focus` with contexts `['sell']`, plain help text. `Keyboard.tsx` handles `focusCustomer` by calling `screen.current?.focusCustomer?.()`.
- [ ] **Step 4: Run tests.** Expected: PASS. `KeyboardSettings` lists the new key with no code change; confirm by reading the file.
- [ ] **Step 5: Commit** `feat(keys): F2 goes to the customer box`.

### Task 4: Customer search service

**Files:**
- Modify: `src/db/connection.ts`, `src/services/parties.ts`
- Create test: `src/services/customer-search.test.ts`

**Interfaces:**
- Produces: SQL function `pos_norm(text)` registered in `openDatabase`. `findCustomers(ctx, text)` keeps its signature.

- [ ] **Step 1: Write failing tests**
  - `finds by name, phone and VAT number`.
  - `أحمد finds احمد and the other way round`, using `normalizeForSearch`.
  - `English search ignores case`.
  - `wildcards are not patterns`: `%`, `_`, `'` return `[]` with customers present and do not throw.
  - `blank returns nothing`.
  - `20,000 customers answer in under 30 ms`: insert fictional rows in one transaction, measure the best of 5 calls.
- [ ] **Step 2: Run.** Expected: FAIL on the Arabic and VAT cases.
- [ ] **Step 3: Implement.** `db.function('pos_norm', { deterministic: true }, (s) => normalizeForSearch(String(s ?? '')))`. Query with `pos_norm(name) LIKE ? OR phone LIKE ? OR vat_number LIKE ?`. Keep `rankCustomers`. A blank value after normalising and stripping returns `[]`.
- [ ] **Step 4: Run tests.** Expected: PASS. If the 30 ms limit fails: add a ruling and a stored `name_norm` column in a new migration, as the spec allows.
- [ ] **Step 5: Commit** `feat(customers): search name, phone and VAT with Arabic matching`.

### Task 5: Customer box on Sell

**Files:**
- Create: `src/renderer/CustomerBox.tsx`
- Modify: `src/core/suggest-keys.ts`, `src/renderer/Sell.tsx`, `src/main/ui-audit.ts`, `src/renderer/help/content.ts`, `docs/audit/KEYBOARD_SHORTCUTS.md`, `docs/user-guide/POS_USER_MANUAL.md` (through `npm run manual`)
- Test: `src/core/suggest-keys.test.ts`

**Interfaces:**
- Consumes: `decideKey` field `customer` (Task 3), `findCustomers` (Task 4).
- Produces: `customerEnter(s: { text: string; itemsFor: string; loading: boolean; open: boolean; active: number }): boolean`. `<CustomerBox canCreate onPick onKey onFocusBox />`, where `onKey(e, empty): boolean` passes keys to `onStepKey('customer', e, empty)`.

- [ ] **Step 1: Write failing tests for `customerEnter`.** True only when open, `active >= 0`, not loading, `itemsFor === text.trim()`. False for each single condition missing, and for `active: -1`, which is the state with one match and no highlight.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `customerEnter` and `CustomerBox`.** The input keeps `id="customer-phone"` and adds `data-kb-search="customer"`. It does not use `data-kb-suggest`, because the hub would clear the text. `useSuggest` calls `customer.find`. `onResults` sets `active` to `-1`, so nothing is highlighted. List rows show name and phone. The last row is "Add new customer" when `canCreate`, opening a small inline form with name and phone that calls `customer.create`. Esc with an open list closes it; with a closed list it calls `goStep('search')`.
- [ ] **Step 4: Replace the old form in `Sell.tsx`**, removing `findCustomer` and the `window.confirm`. Add `focusCustomer` to `useScreenKeys`: on `pay` step call `goStep('search')` first; if a customer is on the bill, `notify('A customer is already on this bill.')`; else focus `#customer-phone`. Pass `canCreate={can('customer.manage')}`, which requires adding that prop from `App.tsx`. Add the hint `{0} = customer` to the search step hints.
- [ ] **Step 5: Add Help.** Update `selling` articles for Z, F2, customer list and cancel hold. Update `KEYBOARD_SHORTCUTS.md`. Run `npm run manual`.
- [ ] **Step 6: Add flows in `ui-audit.ts`** (new `sellStepFlows()`, called beside `keyFlows()`): `z-holds-on-payment`, `z-types-in-pin-box`, `z-no-sale-created` (sales count unchanged), `f2-keeps-bill`, `customer-list-appears-first-letter`, `customer-one-match-not-picked`, `customer-arrow-enter-picks`, `held-bill-restores-discount-and-customer`.
- [ ] **Step 7: Run all checks and the stage audit.** Expected: 0 findings, new flows pass.
- [ ] **Step 8: Commit** `feat(sell): customer suggestions and step keys`.

## Stage 2: Tab memory

### Task 6: Remembered values store

**Files:**
- Create: `src/renderer/remember.ts`, `src/renderer/remember.test.ts`

**Interfaces:**
- Produces: `memoryKey(userId: number, tab: string, key: string): string` giving `pos.ui.<userId>.<tab>.<key>`. `readMemory<T>(store: StorageLike, k: string, initial: T, valid: (v: unknown) => v is T): T`. `writeMemory(store, k, v): void`. `type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`.

- [ ] **Step 1: Write failing tests** with a fake store: round trip; invalid JSON returns `initial` and removes the key; failing `valid` returns `initial`; a store that throws returns `initial` and write does not throw; two users' keys differ.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(tabs): per-user remembered values`.

### Task 7: Keep tabs alive

**Files:**
- Create: `src/renderer/TabHost.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/Keyboard.tsx`, `src/renderer/Sell.tsx`, `src/renderer/QuickActions.tsx` (only if `screen` handling needs it), `src/main/ui-audit.ts`, every screen that loads data once on mount (`Shift`, `Stock`, `Products`, `Customers`, `Purchases`, `Expenses`, `Accounting`, `Reports`, `Refund`, `Admin`)

**Interfaces:**
- Produces: `TabActiveContext`. `useTabActive(): boolean`, default `true` for the Help overlay. `useOnReturn(fn: () => void): void`, which runs `fn` when the tab goes from hidden to visible, not on first mount. `useUser(): { id: number }`. `useRemembered<T>(tab, key, initial, valid): [T, (v: T) => void]`.

- [ ] **Step 1: Move the logged-in part of `App` into `<Workspace key={user.id} user={user} />`.** Tab state and Help overlay state move inside it. Render `<div data-tab={id} hidden={tab !== id}>` for each visited tab inside a `TabActiveContext.Provider`. The set of visited tabs is state, starting with the current tab.
- [ ] **Step 2: Fix the traps in the spec, section 4.1.**
  - `useScreenKeys` and `useScanner` register only while `useTabActive()` is true (add it to the effect deps).
  - In `Keyboard.tsx`, popup detection uses a visible check: `[...document.querySelectorAll('[aria-modal="true"]')].some((el) => el.closest('[hidden]') === null)`.
  - `focusWhenReady` tries every match and takes the first that `focusEl` accepts.
  - Sell's focus effect returns early when not active. When a tab becomes active, focus its first `[data-kb-search]`.
- [ ] **Step 3: Add `useOnReturn(load)`** to every listed screen. Sell reloads shift and held bills.
- [ ] **Step 4: Remove the "leaving Sell loses the bill" rule.** In `Sell.tsx` `unavailable`, drop the `M` and `S` "Finish or hold" lines. Update `docs/audit/KEYBOARD_SHORTCUTS.md` and the Help article `start-quick-actions`. Update the tests that expect them.
- [ ] **Step 5: Scope `ui-audit` lookups** to the visible tab: add a helper that queries inside `document.querySelector('[data-tab]:not([hidden])')` and use it wherever `document.querySelector` targets screen content.
- [ ] **Step 6: Add flows:** `hidden-sell-ignores-scan` (a scan on Stock, bill line count unchanged), `bill-survives-tab-switch`, `hidden-popup-does-not-block-keys`, `shift-closed-while-bill-held-in-sell`, `logout-clears-other-users-screen` (a second login sees no bill).
- [ ] **Step 7: Run all checks and the stage audit.** Expected: 0 findings; existing flows pass unchanged except where this task updated them.
- [ ] **Step 8: Commit** `feat(tabs): tabs stay as you left them`.

### Task 8: Drafts in SQLite

**Files:**
- Create: `src/db/migrations/012_bill_drafts.ts`, `src/services/drafts.ts`, `src/services/drafts.test.ts`
- Modify: `src/db/migrations.ts`, `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`, `src/renderer/Sell.tsx`, `src/renderer/SupplierBill.tsx`

**Numbering.** Migrations are numbered in build order, so drafts are 012, audit and permissions 013 (Task 12), integrity 014 (Task 19). The spec's numbers 012 and 013 are swapped against this; the build order here wins.

**Interfaces:**
- Consumes: `hydrateBill` (Task 2).
- Produces: `type DraftKind = 'sale' | 'supplier_bill'`. `saveDraft(ctx, userId, kind, json: string)`, `loadDraft(ctx, userId, kind): { json: string; updatedAt: string } | null`, `clearDraft(ctx, userId, kind)`, `discardDraft(ctx, userId, kind)` (audited `bill.draft_discarded`), `markDraftRestored(ctx, userId, kind)` (audited `bill.draft_restored`). Channels `draft.get` (returns `{ bill: HydratedBill } | { json: string } | null`), `draft.save`, `draft.clear`, `draft.discard`, `draft.restored`. Payload limit 200,000 characters.

- [ ] **Step 1: Write failing tests**
  - `a draft creates no sale, stock or ledger row`.
  - `one draft per user and kind; saving replaces it`.
  - `another user's draft is not returned`.
  - `sale kind needs sale.create; supplier_bill needs purchase.manage`.
  - `a draft whose bill key is already a sale is removed and returns null`: insert through `finalizeSale` with that `idempotencyKey`, then `loadDraft` is null and the row is gone.
  - `corrupt JSON is removed and returns null`.
  - `restore and discard are audited`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** migration, service, channels. For kind `sale`, the handler runs `hydrateBill` on the parsed, schema-checked payload.
- [ ] **Step 4: Wire Sell.** After 400 ms of no change to lines, customer, cash, card: save the draft, or clear it if the bill is empty. Clear after sale, hold and clear bill. On mount, if a draft exists, show a banner with Restore and Discard. Never include approver fields.
- [ ] **Step 5: Wire SupplierBill.** Replace `localStorage['pos.billDraft']` with the `supplier_bill` draft. On first load, if that old key exists and no SQLite draft does, save it across and remove the old key. Keep `requestKey` inside the payload.
- [ ] **Step 6: Add flow** `reload-restores-bill`. It calls `wc.reload()` in `ui-audit.ts`, which destroys all screen state while SQLite and `localStorage` stay. A full process restart is covered only by manual steps in the final report.
- [ ] **Step 7: Run tests.** Expected: PASS.
- [ ] **Step 8: Commit** `feat(tabs): a bill left open comes back after a restart`.

### Task 9: Remember filters, last tab, Help position

**Files:** Modify `App.tsx`, `Help.tsx`, `Stock.tsx`, `Products.tsx`, `Customers.tsx`, `Purchases.tsx`, `Expenses.tsx`, `Accounting.tsx`, `Reports.tsx`, `Admin.tsx`, `ui-audit.ts`. Test: `remember.test.ts`.

**Interfaces:** Consumes `useRemembered` (Task 7).

- [ ] **Step 1: Write failing tests** for `validDay`, `validTab(tab, allowed)` and `validId` validators in `remember.ts`: bad dates, a tab the user cannot open, non-integer ids are refused.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Apply `useRemembered`** using exactly the table in spec section 4.2. Help remembers only when `initial` is undefined, so the F1 overlay stays separate. Reports' and Accounting's dates move from `useState`.
- [ ] **Step 4: Scroll.** Mark `.help-nav` and `.help-article` with `data-keep-scroll`. On leaving a tab, `TabHost` saves those and `window.scrollY` under `scroll`, and restores them after showing the tab.
- [ ] **Step 5: Stale ids.** Customers and Purchases: when the restored id's load fails with `NOT_FOUND` or `PERMISSION_DENIED`, clear it and show the normal start.
- [ ] **Step 6: Add flows:** `reload-restores-filters-and-tab` (through `wc.reload()`), `filters-survive-tab-switch`, `help-reopens-same-article-and-scroll`, `restored-missing-customer-starts-clean`, `last-tab-not-allowed-falls-back-to-sell`.
- [ ] **Step 7: Run all checks and the stage audit.** Expected: 0 findings.
- [ ] **Step 8: Commit** `feat(tabs): filters, Help position and last tab survive a restart`.

## Stage 3: Demand ranking

### Task 10: Ranking rules

**Files:** Create `src/core/rank.ts`, `src/core/rank.test.ts`. Modify `src/core/store-time.ts`, `src/core/store-time.test.ts`.

**Interfaces:**
- Produces: `MAX_SIGNAL_BOOST = 1.5`, `MAX_TOTAL_BOOST = 2`, `MIN_STORE_DAYS = 28`, `MIN_PRODUCT_SALES = 8`, `OFTEN_BOUGHT_MIN = 0.5`, `NOW_LIFT_MIN = 1.5`. `liftOf(share: number | null, parts: number): number`, which is 1 when null, otherwise `share * parts`. `rankScore(s: { history: number; hourShare: number | null; dayShare: number | null }): number`. `storeHourBlock(iso): 0..5`, `storeWeekday(iso): 0..6`.

- [ ] **Step 1: Write failing tests**: boost is 1 with null shares; below-average share gives no penalty (boost floor 1); a single boost caps at 1.5; both cap at 2; zero history stays 0; store-time block at 23:30 Saudi and at 00:10 Saudi; weekday across UTC midnight.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with boost `min(MAX_SIGNAL_BOOST, max(1, liftOf(...)))`, `parts` 6 for blocks and 7 for days.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(search): ranking rules with time and day`.

### Task 11: Patterns, search order and tags

**Files:** Modify `src/services/demand.ts`, `src/services/search.ts`, `src/renderer/SearchBox.tsx`, `src/renderer/help/content.ts`. Test: `src/services/demand.test.ts`, `src/services/search.test.ts`.

**Interfaces:**
- Consumes: Task 10.
- Produces: `demandPatterns(ctx, now?): Map<number, { hourShare: number; dayShare: number }>`, empty unless the first sale is at least `MIN_STORE_DAYS` old, with only products at `MIN_PRODUCT_SALES` or more. `SearchHit.signals: { often: boolean; now: boolean; inStock: boolean }`.

- [ ] **Step 1: Write failing tests**
  - `an exact barcode outranks a much more popular name match`.
  - `an exact SKU outranks a popular item`.
  - `a thin history gives no pattern`: 10 store days gives an empty map.
  - `an out-of-stock item sorts after an in-stock item in the same level, and is still listed`.
  - `refunds reduce demand` (existing score still net).
  - `an item sold mostly now gets signals.now; an item that is not does not`.
  - `search stays under 33 ms p95 at 20,000 products`, measured with made-up rows. 33 ms is the worst figure recorded in `SEARCH_PERFORMANCE_REPORT.md`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Patterns are cached per database until the sale id, block or day changes. Sort: `rank`, then `inStock` first, then `rankScore` descending, then the existing tie-breaks. `often` = history score at or above `OFTEN_BOUGHT_MIN`. `now` = hour lift at or above `NOW_LIFT_MIN`, with a pattern present.
- [ ] **Step 4: Add tags in `SearchBox`:** `Often bought`, `Usually sold around now`, `Out of stock`. Add a Help section saying these are guesses from past sales and never orders.
- [ ] **Step 5: Run all checks and the stage audit.** Expected: 0 findings.
- [ ] **Step 6: Commit** `feat(search): rank by time, day and stock, with plain tags`.

## Stage 4: Audit log

### Task 12: Audit record block and permissions

**Files:** Create `src/db/migrations/013_audit_and_permissions.ts`. Modify `src/db/migrations.ts`, `src/services/audit.ts`, `src/services/context.ts`, `src/main/handlers.ts`, `src/shared/ipc.ts`, `src/preload/preload.ts`, `src/renderer/App.tsx`. Create test: `src/services/audit.test.ts`.

**Interfaces:**
- Produces: `AuditInput` gains optional `before`, `after`, `reason`, `related: { type: string; id: string | number }`, `status: 'ok' | 'failed'`. `Ctx.screen?: string | null`. `redact(v: unknown): unknown`. Channel `ui.screen`: `{ screen: string max 20 }`. Settings key `device_id`. Permissions `audit.view`, `audit.export`, `integrity.view`.

- [ ] **Step 1: Write failing tests**
  - `every new row has actor, role, device, shift, status under _m`.
  - `role is the role at that moment`: `_m.role` does not change after a role row is altered.
  - `old rows still verify`: insert through the pre-upgrade `details_json` shape, and `verifyAuditChain` returns null after migration.
  - `redact removes pin, password, secret, token, key and csid, at any depth, in arrays too, case-insensitive`; `redact` matches whole words split on `_` and case changes, so `monkey` stays. `billKey`, `requestKey` and `idempotencyKey` stay too, because they link records and are not secret.
  - `only admin has the new permissions`.
  - `a direct UPDATE or DELETE on audit_log is refused`.
  - `a tampered row is found`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Migration SQL: four `CREATE INDEX`, three permission rows, `role_permissions` for admin only, and `INSERT INTO settings (key, value) VALUES ('device_id', lower(hex(randomblob(16))))`. `appendAudit` merges `_m` into a redacted details object before hashing, and leaves `rowHash` unchanged. Sessions: `ui.screen` sets `ctx.screen`. `App` calls it on every tab change.
- [ ] **Step 4: Run tests.** Expected: PASS, all existing audit tests included.
- [ ] **Step 5: Commit** `feat(audit): who, role, screen, device and before-after on every record`.

### Task 13: Failure records

**Files:** Modify `src/main/handlers.ts`, `src/services/audit.ts`. Test: `src/main/handlers.test.ts`.

**Interfaces:** Produces `appendFailure(ctx, userId: number | null, channel: string, code: string): void`, which never throws. `FAILURE_LOGGED = new Set(['sale.finalize','refund.create','credit.receipt','credit.writeOff','purchase.pay','expense.pay','backup.run','restore.apply'])`.

- [ ] **Step 1: Write failing tests**: a cashier calling a refused channel writes `denied` with the channel name and no payload; a failed `sale.finalize` writes `failed` with `_m.status: 'failed'`; ordinary `VALIDATION` on an unlisted channel writes nothing; zod failures write nothing; the original error is still returned; the chain still verifies.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** in the `dispatch` catch block. `appendFailure` runs in its own transaction after the handler's rollback, with try/catch logging to `console.error`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(audit): record refused and failed actions`.

### Task 14: Before and after on existing edits

**Files:** Modify `src/services/catalog.ts`, `parties.ts`, `credit.ts`, `expenses.ts`, `shortcuts.ts`, `store-details.ts`, `shifts.ts`. Test: `src/services/audit.test.ts`.

**Interfaces:** Consumes `AuditInput.before/after` (Task 12).

- [ ] **Step 1: Write failing tests**: `product.price` has `_m.before` and `_m.after` with old and new price; `supplier.update`, `customer.credit_settings`, `expense.edit` and `settings.store_details` show the changed fields; closing a shift with a difference writes `shift.cash_difference` with expected, counted and difference; closing with none writes no such row.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Read the old row inside the same transaction. Existing `details` stay, so existing reports keep working.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(audit): show old and new values`.

### Task 15: Shift handover

**Files:** Modify `src/services/shifts.ts`, `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`, `src/renderer/Shift.tsx`, `src/renderer/App.tsx`, `src/renderer/help/content.ts`, `src/main/ui-audit.ts`. Test: `src/services/shifts-handover.test.ts`.

**Interfaces:** Produces `handOverShift(ctx, outgoingId, incomingId, countedCash): { closed: ShiftSummary; newShiftId: number }`. Channel `shift.handover`: `{ countedCash: money, username, pin }`; it authenticates first, then sets `session.user` to the incoming user.

- [ ] **Step 1: Write failing tests**
  - `closes and opens in one step; new opening cash equals counted cash`.
  - `audit shows both people, expected, counted, difference`.
  - `a cash difference posts through the normal close rule`: `shift_close` journal entry exists.
  - `refused to the same person; the shift stays open`.
  - `wrong PIN: the shift stays open, and auth.fail is written` (through `dispatch`).
  - `outgoing needs shift.close, incoming needs shift.open`.
  - `no open shift is refused`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** as one outer `ctx.db.transaction` that calls the existing `closeShift` and `openShift`, then writes `shift.handover`. better-sqlite3 turns the inner transactions into savepoints, so `closeShift` is not edited. The day-end backup in the `shift.close` handler runs after handover as well.
- [ ] **Step 4: Add UI:** "Hand over" section on Shift with counted cash, next cashier username, PIN. After success call the app refresh, so `Workspace` remounts for the new user. Add a Help article `shifts-handover`.
- [ ] **Step 5: Add flow** `shift-handover-switches-cashier`.
- [ ] **Step 6: Run tests.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(shift): hand over to the next cashier`.

### Task 16: Audit tab

**Files:** Create `src/services/audit-view.ts`, `src/services/audit-view.test.ts`, `src/renderer/Audit.tsx`. Modify `src/renderer/App.tsx`, `keyboard-registry.ts` (`ScreenContext` gains `audit`, `CONTEXT_HELP` entry, `EVERY`), `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`, `src/renderer/help/content.ts`, `src/main/ui-audit.ts`.

**Interfaces:**
- Produces: `AuditFilters = { text?: string; userId?: number; from?: string; to?: string; action?: string; entity?: string; offset: number; limit: number }`. `listAudit(ctx, userId, f): { items: AuditView[]; total: number }`. `AuditView = { id; at; userId; actor: string; role: string | null; action; entity; entityId: string | null; before: unknown; after: unknown; reason: string | null; screen: string | null; related: {type;id} | null; status: 'ok'|'failed'; details: unknown }`. `exportAudit(ctx, userId, f): string`. `csvCell(v: unknown): string`. Channels `audit.list`, `audit.export`, `audit.filters`.

- [ ] **Step 1: Write failing tests**
  - `lists newest first and pages`; each filter narrows correctly.
  - `an old row reads with empty extras and its user's current name`.
  - `cashier and supervisor are refused for list and export`.
  - `export needs audit.export, is audited, stops at 50,000 rows`.
  - `csvCell escapes cells starting with = + - @`, quotes commas and quotes.
  - `backup and restore keep every audit row and the chain verifies`.
  - `a refund's audit row links to the original sale`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the service and channels. No update or delete channel exists.
- [ ] **Step 4: Build `Audit.tsx`:** section switch (Activity log now, Books check in Task 19), filters, table of 100 rows, Show more, a row expands to before, after and details. Open related: `sale` and `refund` open Refund with that invoice, `customer` opens Customers, `product` opens Item information; others show the reference. Export button saves through a Blob link. Add a tab `{ id: 'audit', label: 'Audit', perm: 'audit.view', group: 4 }`.
- [ ] **Step 5: Add Help article `audit-log`** and flows `audit-tab-lists-price-change`, `audit-hidden-from-cashier`.
- [ ] **Step 6: Run all checks and the stage audit.** Expected: 0 findings.
- [ ] **Step 7: Commit** `feat(audit): Audit tab for the admin`.

## Stage 5: Books check and cash flow

### Task 17: Cash flow

**Files:** Modify `src/services/financials.ts`, `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`, `src/renderer/Accounting.tsx`. Create test: `src/services/cash-flow.test.ts`.

**Interfaces:** Produces `cashFlowData(ctx, from, to): CashFlow`, with no permission check, for the books check to use. `CashFlow = { fromDay; toDay; opening: number; groups: { id: 'sales'|'refunds'|'customers'|'suppliers'|'expenses'|'cash_moves'|'differences'|'other'; amount: number }[]; net: number; closing: number }`. `cashFlow(ctx, userId, from, to): CashFlow`. Channel `finance.cashflow`.

- [ ] **Step 1: Write failing tests** on `seedDemoShop` data and small hand-built cases: `opening + net = closing`; `closing equals cashAndBank on the end day`; `a sale's card part counts under sales`; `an unknown source lands in other`; `an empty period is zero with opening = closing`; `needs finance.view`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** from `journal_lines` on 1010, 1020, 1030 by `source_type`, using the spec's group table. Add a card to Accounting with the existing `Line` component and a note that this is money moved, not profit.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): cash flow report`.

### Task 18: Books check rules

**Files:** Create `src/services/integrity.ts`, `src/services/integrity.test.ts`.

**Interfaces:** Produces `Finding = { checkId: string; severity: 'critical'|'warning'; entityType: string; entityId: string; problem: string; explanation: string; suggestion: string }`. `runChecks(ctx): Finding[]`, one function per check, exported as `CHECKS: { id: string; run: (ctx: Ctx) => Finding[] }[]`, numbered as in spec section 7.2: `je_balanced`, `tb_balanced`, `bs_balanced`, `sale_lines`, `sale_payments`, `ledger_sales_vat`, `cogs`, `refund_limits`, `stock_movements`, `inventory_value`, `receivables`, `payables`, `shift_cash`, `cash_sources`, `cash_flow`, `orphans`, `duplicates`, `audit_chain`, `backup_records`.

- [ ] **Step 1: Write failing tests.** `the clean demo shop has no findings` (seed once). Then one test per check, in a fresh temp database: drop the relevant `trg_*` triggers **in that temp database only**, make one break, assert exactly that `checkId` is reported with the right record:

| Check | Deliberate break |
|---|---|
| `je_balanced`, `tb_balanced` | Raise one journal line's debit |
| `bs_balanced` | Insert a one-sided line on an asset account |
| `sale_lines` | Change a line's `line_incl` |
| `sale_payments` | Delete a payment row |
| `ledger_sales_vat` | Change a 2200 line and its partner, keeping the entry balanced |
| `cogs` | Change a 5000 line and 1200 partner |
| `refund_limits` | Raise a refund line's qty over the sold qty |
| `stock_movements` | Change a `stock_balances` row |
| `inventory_value` | Change a 1200 line past the limit, with a balancing line |
| `receivables`, `payables` | Change a 1100 or 2000 line with a balancing line |
| `shift_cash` | Change a closed shift's `expected_cash` |
| `cash_sources` | Change a 1010 line of a sale with a balancing line |
| `cash_flow` | Call `checkCashFlow(ctx, doctoredReport)` with a report whose `net` is off by one halala. The default argument is `cashFlowData` |
| `orphans` | Point a journal entry at a missing `source_id`, with foreign keys off |
| `duplicates` | UNIQUE indexes block this on real tables, so test `duplicatesIn(ctx, table, column)` on a temp table holding two equal numbers |
| `audit_chain` | Change one audit row |
| `backup_records` | Insert a `verified_local` job with empty details |

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement each check** with its own SQL, not importing `trialBalance`, `stockDrift`, `creditControls`, `supplierControls`, `shiftSummary` or `ownerKpis`. `expected_cash` formula exactly as spec check 13. Read the posting code in `sales.ts`, `refunds.ts`, `credit.ts`, `purchasing.ts`, `expenses.ts` for the mapping behind checks 6, 7 and 14. Findings carry plain-English text. Rounding limit for check 10: one halala per product with movements.
- [ ] **Step 4: Run tests.** Expected: PASS. If the clean seed reports something: use systematic debugging to decide whether the check or the data is wrong. Never alter posting code to make a check pass. If the data is truly wrong, stop and report it.
- [ ] **Step 5: Commit** `feat(books): independent checks over source records`.

### Task 19: Run, report, review

**Files:** Create `src/db/migrations/014_integrity.ts`. Create `src/services/integrity-runs.ts` and its test. Modify `src/db/migrations.ts`, `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/preload/preload.ts`, `src/renderer/Audit.tsx`, `src/renderer/help/content.ts`, `src/main/ui-audit.ts`.

**Interfaces:** Consumes `runChecks`, `Finding`. Produces `runIntegrity(ctx, userId): IntegrityRun`, `latestIntegrity(ctx, userId): IntegrityRun | null`, `reviewFinding(ctx, userId, fingerprint, note): void`. `IntegrityRun = { id; at; userId; findings: (Finding & { fingerprint: string; reviews: { note: string; by: string; at: string }[] })[] }`. Channels `integrity.run`, `integrity.latest`, `integrity.review`.

- [ ] **Step 1: Write failing tests**: `a run saves its findings and is audited as integrity.run`; `needs integrity.view; cashier and supervisor refused`; `a note follows the same finding into the next run`; `a note does not remove the finding`; `a run changes no financial table` (row counts of `sales`, `journal_entries`, `journal_lines`, `payments`, `stock_movements`, `stock_balances` before and after).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** tables `integrity_runs (id, at, user_id)`, `integrity_findings (id, run_id, fingerprint, check_id, severity, entity_type, entity_id, problem, explanation, suggestion)`, `integrity_reviews (id, fingerprint, note, user_id, at)`, all STRICT. Fingerprint is `sha256(checkId + entityType + entityId)`.
- [ ] **Step 4: Add the Books check section to `Audit.tsx`:** Run check button, a green "No problems found" or a list sorted critical first, showing problem, severity, record, explanation, suggested fix, and "Needs a person". Note form. Add Help article `books-check`.
- [ ] **Step 5: Add flow** `books-check-clean-on-seed`.
- [ ] **Step 6: Run all checks and the stage audit.** Expected: 0 findings.
- [ ] **Step 7: Commit** `feat(books): Books check screen`.

## Stage 6: Help registry and info icons

### Task 20: Registry, icon, sync tests

**Files:** Create `src/renderer/help/fields.ts`, `src/renderer/help/metrics.ts`, `src/renderer/InfoIcon.tsx`, `src/renderer/help/registry.test.ts`, `src/renderer/help/skip-list.ts`. Modify `src/renderer/styles.css`.

**Interfaces:** Produces `FieldHelp` and `MetricHelp` as in spec section 8.1. `FIELDS: FieldHelp[]`, `METRICS: MetricHelp[]`, `helpFor(id: string): FieldHelp | MetricHelp | undefined`. `<InfoIcon id="…" />`. `LABEL_SKIPS: { file: string; label: string; why: string }[]`.

- [ ] **Step 1: Write failing tests in `registry.test.ts`**, reading source files with `node:fs`:
  - `every InfoIcon id in src/renderer exists in FIELDS or METRICS`.
  - `every FIELDS and METRICS entry is used by an InfoIcon`.
  - `ids are unique`.
  - `no entry has an empty required text`.
  - `every <label> on the covered screens has an InfoIcon in the same element or is in LABEL_SKIPS`.
  - `every DIRECT_SHORTCUTS and QUICK_ACTIONS entry has help text`.
- [ ] **Step 2: Run.** Expected: FAIL, modules missing.
- [ ] **Step 3: Implement `InfoIcon`:** `tabIndex={-1}`, small muted "i" button, a popover with `means`, `example`, `mistakes` or `changes`, and a More link to the article through the existing `HelpContext`. It is not `aria-modal`. Esc and outside click close it and return focus. Style with existing tokens.
- [ ] **Step 4:** With the entries still empty, the coverage test fails on labels. Mark that test `it.todo` until Task 23, then restore it. Run the others. Expected: PASS.
- [ ] **Step 5: Commit** `feat(help): field and figure help registry`.

### Task 21: Field help, selling and stock screens

**Files:** Modify `fields.ts`, `skip-list.ts`, `Sell.tsx`, `CustomerBox.tsx`, `Refund.tsx`, `Stock.tsx`, `Products.tsx`, `Shift.tsx`, `Customers.tsx`.

- [ ] **Step 1:** List every `<label>` and unlabelled saving input on these screens. Read the service each one reaches and write its entry from what the code does. Use made-up examples.
- [ ] **Step 2:** Add `<InfoIcon>` by each label. On Sell, only beside the customer box, discount and payment boxes, so nothing sits on the scanning path.
- [ ] **Step 3: Run** the registry tests. Expected: the used-ids tests PASS.
- [ ] **Step 4: Commit** `docs(help): explain selling, stock, shift and customer fields`.

### Task 22: Field help, purchases, expenses, admin

**Files:** Modify `fields.ts`, `skip-list.ts`, `Purchases.tsx`, `SupplierBill.tsx`, `Expenses.tsx`, `Admin.tsx`, `StoreDetailsCard.tsx`, `KeyboardSettings.tsx`.

- [ ] **Steps:** Same three steps as Task 21 for these screens. Store-details examples use made-up values only.
- [ ] **Commit** `docs(help): explain purchase, expense and admin fields`.

### Task 23: Metric help, proved by real services

**Files:** Modify `metrics.ts`, `Accounting.tsx`, `Reports.tsx`, `Shift.tsx`, `Customers.tsx`, `Purchases.tsx`, `Stock.tsx`, `Expenses.tsx`, `Sell.tsx`. Create `src/renderer/help/metrics-proof.test.ts`.

**Interfaces:** Consumes `ownerKpis`, `profitAndLoss`, `balanceSheet`, `shiftSummary`, `cashFlow`. `MetricHelp.example` for money figures has a matching numeric `proof` block: `{ sales: number; ... ; expected: number }`.

- [ ] **Step 1: Write failing tests in `metrics-proof.test.ts`** that build each example through real services and compare:
  - `gross profit`: sell goods at SAR 20,000 excl. VAT costing SAR 12,000; `grossProfit` is 800,000 halalas.
  - `net profit`: add SAR 3,000 expenses; `netProfit` is 500,000 halalas.
  - `expected cash`: float, cash sale, change, cash in, cash out, refund; `expectedCash` equals the Help example.
  - `balance sheet`: `totalAssets === totalLiabilitiesAndEquity`.
  - `customer credit`: SAR 200 sale, SAR 100 paid; SAR 100 outstanding.
  - `supplier payable`: SAR 1,000 purchase, SAR 400 paid; SAR 600 outstanding.
  - `cash flow`: example ties out.
  - `VAT`: output, input, and payable examples agree with `finance.vat`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Write `METRICS` from the code,** starting with the formula block at the top of `financials.ts`, and add `<InfoIcon>` to each figure. Figures marked provisional in the app are described as provisional.
- [ ] **Step 4: Restore the label coverage test from `it.todo`.** Add skip-list entries with reasons only for the kinds allowed by spec section 8.3.
- [ ] **Step 5: Run tests.** Expected: PASS.
- [ ] **Step 6: Commit** `docs(help): explain every money figure, proved by real numbers`.

### Task 24: Articles and final Help checks

**Files:** Modify `src/renderer/help/content.ts`, `src/main/ui-audit.ts`, `docs/user-guide/POS_USER_MANUAL.md` (through `npm run manual`).

- [ ] **Step 1: Write articles** for: balance sheet, profit and loss, trial balance, cash flow, expenses and profit, VAT (output, input, payable, Saudi example), ZATCA status, roles and permissions, and any screen named in Part 4.1 that exists and has no article. Use the prompt's worked examples. Every step is checked against the screen.
- [ ] **Step 2: Extend `CONTEXT_HELP`** so F1 opens the right article, and test each id exists.
- [ ] **Step 3: Add flows:** `info-icon-opens-right-text`, `info-icon-esc-closes-and-keeps-focus`, `tab-order-unchanged-on-sell`.
- [ ] **Step 4: Run** `npm run manual`, all checks, and the stage audit. Expected: 0 findings.
- [ ] **Step 5: Commit** `docs(help): statements, VAT and ZATCA status articles`.

## Finish

### Task 25: Whole-branch review and report

**Files:** Create `docs/IMPLEMENTATION_REPORT_MASTER_PROMPT_A.md`. Modify `CHANGELOG.md`, `docs/TEST_RESULTS.md`, `docs/ARCHITECTURE_DECISIONS.md`, `src/demo/seed.ts` only if new features need demo rows.

- [ ] **Step 1:** Run the fresh whole-branch review. Fix Critical and Important findings, each with a failing test first.
- [ ] **Step 2:** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run ui-audit -- ui-audit/final`, and `npm run ui-audit -- ui-audit/final-demo --demo`. Read each output. Expected: all pass, 0 findings.
- [ ] **Step 3:** Write the report from Part 9: modified files, migration summary, new features, real test results for the 20 acceptance tests, known limitations, unresolved discrepancies, manual checking steps.
- [ ] **Step 4: Commit** `docs: Master Prompt A report`. Do not push.
