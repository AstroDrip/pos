# POS Master Prompt A: Design

**Date:** 2026-11-09. **Branch:** `feature/owner-tools`. **Status:** written for owner review.
**Decisions and inventory:** [assessment](2026-11-09-master-prompts-assessment.md). The owner accepted all ten decisions.

The phone dashboard (Master Prompt B) is a separate project with its own spec, written after this one is built.

## 1. Goal

A POS that keeps people's work when they move around, teaches them what each field and figure means, records every important change where an admin can read it, and can show that its financial numbers are right.

**Success means:** the 20 acceptance tests in Part 8 of the prompt run and pass, every existing test still passes, and the real app shows the behaviour in `ui-audit`.

## 2. Global constraints

- Do not change VAT calculations, ZATCA processing, invoice numbering, or inventory accounting and stock movement rules.
- Do not bypass permissions. Do not run destructive database commands. No automatic repair of financial records.
- No Playwright, no Puppeteer, no browser automation added. Do not run `npm run e2e`, `e2e/*.mjs` or `scripts/ui-shots.mjs`. Do not delete existing Playwright files.
- No new npm packages.
- Tests use made-up data. Never the production database. No credentials, real store details or customer details in code, tests, Help or screenshots.
- Money stays integer halalas and quantity integer milli-units. Use `roundDiv`, never `Math.round`, in `src`.
- Migrations are append-only. Existing migrations are never edited.
- New `t()` labels get Arabic strings because the i18n test needs them. Help content stays English. Arabic screens are not checked.
- Help text is plain English and describes only what exists.
- Local commits only. No pushing.

## 3. Stage 1: Sell keys, hold, customer search

### 3.1 Hold payload

`held-bills.ts` schema gains optional fields, so bills already held still load:

| Field | Meaning |
|---|---|
| `lines[].seenPrice` | Unit price when held, in halalas |
| `lines[].discount` | Line discount, in halalas |
| `lines[].scanCode` | The scale label scanned, so it stays on the sale line |
| `cash`, `card` | Text typed in Cash received and the card part, digits and one dot only, up to 12 characters |

The label and customer stay as they are. Approver names and PINs are never in the payload.

**Recall:** discounts, customer and typed amounts return. Each line uses the catalog's current price, exactly as now. If `seenPrice` differs, the bill warns: "The price of X changed from A to B." `finalizeSale` is not changed. A restored discount still needs approval at payment when the cashier lacks `sale.discount`.

Two faults in today's recall are fixed. The customer is saved but `Sell.tsx` never puts it back. A product turned off since the hold is silently dropped from the bill. It stays off the bill, because it cannot be sold, but the cashier now sees: "X is no longer sold and was left off."

**Cancel:** new `cancelHeldBill(ctx, userId, id, reason)` deletes the hold, audited as `bill.cancel` with the reason. A small Cancel control sits beside each held bill.

### 3.2 Z key

Added to `decideKey` as `{ type: 'holdBill' }`, and listed in the registry as fixed, so the admin cannot move it.

| Situation | Result |
|---|---|
| Payment step, focus in Cash received or card part, plain Z, bill has items | Holds the bill |
| IME composing | Left to the IME |
| Key repeat, or busy | Swallowed |
| Ctrl, Alt or Shift held | Ignored |
| PIN box, approver box, customer box, search box, any other field | Types normally |
| A popup or Quick Actions open | Not handled here |
| Arabic layout | Physical Z key, same rule as Quick Actions letters |
| Scanner burst | Z waits 40 ms. Another key that soon means a scan, and the hold is dropped. Same rule as Quick Actions letters |

Z calls the existing `hold()` and its `holding` guard, so a double press holds once. It needs no confirmation because it is not a financial action and can be undone by recalling.

### 3.3 Registry

`Shortcut` gains `enabled` (from the admin's settings) and `focus` (the boxes where it applies, as data). Existing text fields stay.

### 3.4 Sell flow keys

| Key | Where | Action |
|---|---|---|
| F2 (`customer.focus`, admin can move it) | Sell, search step | Focus the customer box |
| F2 | Sell, payment step | Step back to the bill, then focus the customer box |
| F2 | Sell, quantity step | Refused with the existing message, so the chosen item is not lost |
| Shift+Enter | Customer box empty, bill has items | Open payment |
| Shift+Enter | Customer box has text | Refused: "finish choosing the customer first" |
| Esc | Customer box with an open list | Close the list |
| Esc | Customer box, list closed | Back to product search |
| Ctrl+F | Customer box | Back to product search, following the existing rule |

### 3.5 Customer box

New `CustomerBox.tsx` built on `useSuggest` from the first character, 150 ms pause, ignoring IME composition. The list shows name and phone.

- ↑ ↓ move, Enter picks the highlighted row, Esc closes, typing keeps focus.
- **Nothing is picked until the cashier highlights a row and presses Enter, or clicks one.** One match is not picked by itself.
- Enter only picks from a list that answers the current text, using the existing `enterAction` rule, so a stale list cannot be chosen.
- An "Add new customer" row appears last for users with `customer.manage`. It opens a small form for name and phone. The browser `confirm` popup is removed.

**Search service:** `findCustomers` matches name, phone and VAT number, comparing names through the existing `normalizeForSearch`. A SQL function registered in `openDatabase` does this, with no schema change. Limit: 20,000 made-up customers must answer in under 30 ms. If not, the plan adds a stored normalised column.

### 3.6 Tests

Pure tests for every row in 3.2 and 3.4. Service tests: hold never creates a sale, payment, stock movement, journal entry or invoice number; recall restores everything; old-format holds load; cancel is audited; Arabic variants match. Real-app flows: Z holds, Z in a PIN box types, F2, customer list with arrows and Enter.

## 4. Stage 2: Tab memory

### 4.1 Keep tabs alive

`App.tsx` renders each visited tab once and hides the others with the `hidden` attribute. The wrapper is keyed by user id, so logout or a handover destroys everything. A tab is mounted on first visit, and only if the user has permission.

Each tab receives its state through a `useTabActive()` context.

**Traps found in the code, and the fix for each:**

| Trap | Fix |
|---|---|
| `useScanner`: a hidden Sell would still catch scans on other tabs and add them to the bill | Register only while Sell is active |
| `useScreenKeys`: the last screen to mount takes the keys | Register only while active |
| `document.querySelector('[aria-modal="true"]')`: a popup in a hidden tab would block all keys | Check visible popups only |
| `focusWhenReady` takes the first match, which may be hidden | Take the first visible match |
| `autoFocus` only runs on mount | Focus the tab's main box when it becomes active |
| Data goes stale while hidden, e.g. Sell's open shift | `useOnReturn(load)` reloads when a tab becomes active |
| `ui-audit` selectors may hit hidden tabs | Scope audit lookups to the visible tab |

With this in place, M and S are no longer grey just because the bill has items.

### 4.2 Remembered after restart

`useRemembered(tab, key, initial, validate)` stores values in `localStorage` under the user's id. Reads and writes are wrapped in try/catch, and a bad value falls back to `initial`.

| Tab | Remembered |
|---|---|
| App | Last tab, used only if the user may still open it. Otherwise Sell |
| Help | Article, search text, scroll position, text size |
| Stock | Search, low-stock tick, section |
| Products | Status, search, page |
| Customers | Search, open customer |
| Purchases | Section, supplier, filters |
| Expenses | Filters |
| Accounting, Reports | From and To dates, open report |
| Admin | Open section |

Refund, Shift and the Audit tab keep their state while moving between tabs, but start fresh after a restart. Only filters that exist today are remembered. No new filters, categories or sort options are added for this.

Scroll: elements marked `data-keep-scroll`, and the page scroll, are saved when leaving a tab and put back on return.

**Stale records:** a restored id (customer, supplier, article) is checked when loaded. If it is missing or not allowed, the value is cleared and the tab shows its normal start. Nothing is shown that the service refuses.

### 4.3 Drafts after a crash or restart

Migration 013 adds:

```sql
CREATE TABLE bill_drafts (
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('sale','supplier_bill')),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
) STRICT;
```

Sell and the supplier bill form save a draft 400 ms after a change, and clear it after a save, hold or clear. A draft is not a sale: no invoice, stock or ledger effect. Sell's payload is the hold payload from 3.1 plus the bill key.

On next login: "A bill was left open: Restore or Discard." If a sale already exists with that bill key, the sale went through before the crash, so the draft is dropped quietly. `sales.ts` is not touched. Restore and discard are audited.

**Never saved:** PINs, approver names, passwords.

### 4.4 Tests

Pure tests for `useRemembered`'s storage rules. Service tests for drafts and permissions. Real-app flows: a scan on Stock does not reach the bill; bill survives moving between tabs; filters survive; Help reopens at the same article and scroll; a second user sees nothing of the first's; restart restores tab, filters and the bill.

## 5. Stage 3: Demand ranking

**Order is unchanged at the top level:** match level comes first. An exact barcode, SKU or PLU can never be outranked.

Inside one match level, a pure `rankScore(signals)` combines:

| Signal | Rule |
|---|---|
| History | The existing score from `demand.ts` |
| Time of day | Share of the product's sales in the current 4-hour store-time block, against all blocks |
| Day of week | The same for today's weekday |
| Stock | Out-of-stock items sort after in-stock ones in the same level. They are never hidden |

Time and day count only when the store has at least 28 days of sales and the product has at least 8 sales in 90 days. Each multiplies history by at most 1.5, and together by at most 2. All numbers are constants with tests. Calculated from local sales and cached in the same way as `demand.ts`.

`SearchHit` gains `signals`. The suggestion list adds small tags, only when true: "Often bought" (history) and "Usually sold around now" (estimate). "Out of stock" is a plain fact. Help says these are guesses from past sales, not orders.

**Tests:** an exact code beats a very popular item; thin history gives no boost; caps hold; refunds reduce demand; search speed stays within the budget in `SEARCH_PERFORMANCE_REPORT.md`.

## 6. Stage 4: Audit log

### 6.1 Record

The hash formula and table shape do not change, so all old rows still verify. `appendAudit` adds an `_m` block inside `details_json`:

| Key | Content |
|---|---|
| `actor`, `role` | Display name and roles at that moment |
| `screen` | Current tab, from a new `ui.screen` channel |
| `device` | `device_id` setting, created by migration 012 |
| `shift` | Open shift id |
| `before`, `after` | Old and new values, for edits |
| `reason`, `related` | Reason, and a linked document such as the original sale |
| `status` | `ok` or `failed` |

One `redact()` removes any key matching pin, password, secret, token, key or csid, at any depth. A test runs every event through it.

Failures roll back with their action, so they are written afterwards in their own transaction. Recorded failures: permission refused (every channel), and any service error on sale, refund, payment and backup channels. Ordinary form validation is not logged.

### 6.2 Migration 012

Adds `audit_log` indexes on `at`, `action`, `entity` and `user_id`, the permissions `audit.view`, `audit.export` and `integrity.view`, and the `device_id` setting. The permissions go to the admin role only.

### 6.3 Events to add or improve

- `bill.cancel`, `bill.draft_restored`, `bill.draft_discarded`
- `shift.handover`
- `shift.cash_difference`, as its own event when a shift closes with a difference
- `audit.export`, `integrity.run`, `integrity.review`
- `denied` for refused permissions
- `before` and `after` on `product.price`, `supplier.update`, `customer.credit_settings`, `expense.edit`, `settings.*`

The list in section 2.3 of the assessment names actions the app does not have. They are not logged because they cannot happen.

### 6.4 Shift handover

New `handOverShift(ctx, outgoingId, incomingId, countedCash)`, in one transaction: close with the existing rules and cash-difference posting, then open for the next cashier. The new opening cash equals the counted cash. Audited as `shift.handover` with both people, time, expected, counted and difference.

On the Shift tab, the outgoing cashier enters the counted cash and the next cashier's username and PIN. The PIN goes through `authenticate` first, so wrong PINs and lockout work as at login. The app then switches to the new cashier. Needs `shift.close` for the outgoing and `shift.open` for the incoming user.

### 6.5 Audit tab

A new top tab, for `audit.view`, with an Activity log section:

- Search; filter by user, date range, action and entity; 100 rows per page.
- A row opens the before and after values and all details. Old rows simply show less.
- Open related record: sale or refund, customer, product. Anything else shows the reference only.
- Export to CSV with `audit.export`, at most 50,000 rows, audited. Cells that start with `= + - @` are escaped.

No edit or delete exists, and database triggers already refuse them.

### 6.6 Tests

Price change records old, new, who and when. Handover. Refund links to its sale. Cashier and supervisor refused. A direct update or delete is refused by the trigger. A tampered row is found by the chain. Old rows still verify after migration. Redaction. Backup and restore keeps the audit rows.

## 7. Stage 5: Books check and cash flow

### 7.1 Cash flow report

New read-only `cashFlow(ctx, userId, from, to)`, `finance.view`, shown in Accounting. It takes every journal line on 1010, 1020 and 1030, the same three accounts as `cashAndBank`, and groups them by source:

| Group | Sources |
|---|---|
| Sales | `sale` |
| Refunds | `refund` |
| Customer payments | `customer_receipt` |
| Supplier payments | `supplier_payment` |
| Expenses | `expense`, `expense_payment`, `expense_reversal` |
| Cash in and out | `cash_movement` |
| Cash differences | `shift_close` |
| Other | anything else |

"Other" means nothing can be dropped, so opening + all groups = closing.

### 7.2 Books check

New read-only `services/integrity.ts`. Its SQL is written fresh over source records and does not call the functions that produce the figures.

| # | Severity | Check |
|---|---|---|
| 1 | Critical | Each journal entry: debits = credits |
| 2 | Critical | All accounts: total debits = total credits |
| 3 | Critical | Assets = liabilities + equity + income − expenses |
| 4 | Critical | Each sale's `total_incl`, `total_vat`, `total_excl`, `total_discount` = sum of its lines |
| 5 | Critical | Each sale's payments add up to `paid_total`; on-account sales agree with `receivables` |
| 6 | Critical | Sale and refund journal amounts on 4000 and 2200 = their documents |
| 7 | Warning | COGS on 5000 from sales and refunds = lines' quantity × unit cost, rounded the way posting rounds |
| 8 | Critical | Refund quantity never exceeds what was sold on that line; refund has an original sale |
| 9 | Critical | Stock balance = sum of its movements |
| 10 | Warning | Account 1200 = stock at cost, within a rounding limit set from the number of movements |
| 11 | Critical | 1100 = open customer invoices; 2300 = customer advances |
| 12 | Critical | 2000 = open supplier items − unused return credits; 1310 = supplier advances |
| 13 | Critical | Closed shift's stored expected cash = float + cash sales − change + cash collections + cash in − cash out − cash refunds − till expenses − till supplier payments |
| 14 | Warning | 1010 lines for each source agree with that shift's documents. The opening float is not posted to the ledger, so it is left out |
| 15 | Critical | Cash flow closing − opening = change in 1010 + 1020 + 1030 |
| 16 | Critical | Orphans: payment without sale; movement or journal entry whose source is missing; supplier payment or receipt with no allocation and not recorded as an advance |
| 17 | Critical | Duplicate document numbers; invalid product, shift or tax-document references |
| 18 | Critical | Audit chain intact |
| 19 | Warning | Backup jobs recorded as verified that have missing details |

Exact source mapping for 6, 7 and 14 is confirmed against the posting code by a test on real seeded data. If a check is wrong, the check is fixed and recorded. The data and the money rules are not altered to make it pass.

### 7.3 Report and review

Migration 014 adds `integrity_runs`, `integrity_findings` and `integrity_reviews`.

An admin with `integrity.view` presses **Run check** on the Books check section of the Audit tab. Each finding shows problem, severity, affected record, explanation, suggested fix, and "Needs a person". There is no automatic fix. An admin can add a review note to a finding, audited; the finding stays until the data is right. Findings carry a fingerprint (check and record), so a note follows the same problem across runs. Each run is audited.

The first version has no correction buttons.

### 7.4 Tests

Every check, on a temp database: clean seed reports nothing, then one deliberate break per check is found. Triggers are dropped only inside that temp database to make the break. Cash flow ties out on the demo seed. Viewing needs permission.

## 8. Stage 6: Help registry and info icons

### 8.1 Structure

```ts
// help/fields.ts
interface FieldHelp { id: string; screen: ScreenContext; label: string; means: string; why: string;
  enter: string; required: boolean; format: string; onSave: string; usedBy: string; mistakes: string; example: string; article?: string; }
// help/metrics.ts
interface MetricHelp { id: string; screen: ScreenContext; label: string; means: string; formula: string;
  includes: string; excludes: string; kind: 'actual' | 'estimate'; vat: 'included' | 'excluded' | 'none';
  span: 'balance' | 'period'; changes: string; example: string; source: string; article?: string; }
```

Ids look like `field.product.priceIncl` and `metric.grossProfit`. Field examples and formulas come from the code, such as the formulas at the top of `financials.ts`.

### 8.2 Info icon

`<InfoIcon id="…" />` is a small muted "i" that opens a popover: short meaning, example, common mistake, and a "More" link to the article. It is not a modal, so it does not block keys. Esc closes it and focus returns. It is left out of the Tab order, so a cashier's Tab path does not change.

### 8.3 Coverage

| Covered | Not covered |
|---|---|
| Every input that saves data, on every screen | Search boxes and the shared date choosers (one entry each) |
| Every money or count figure on Accounting, Reports, Shift, Customers, Purchases, Stock, Expenses, and Sell totals | PIN boxes (no icon, and Help covers them in the login guide) |

New or extended articles for every screen in Part 4.1 of the prompt that exists: statements (balance sheet, P&L, trial balance, cash flow, VAT), audit log, books check, roles, handover. The ZATCA article says what the receipt has today and that the link to ZATCA is not set up. Screens the app does not have get no article.

### 8.4 Keeping Help true

- Every icon id exists in a registry, and every registry entry is used by an icon.
- A source-scanning test finds every `<label>` on the covered screens. Each must have an icon or be on a written skip list. A new field fails the test until it has Help.
- Every shortcut in the registry has help text.
- Each `metric.example` for a money figure has a test that creates those numbers through the real services and compares.
- The manual stays generated from the same content.

## 9. Permissions

| Action | Permission |
|---|---|
| Hold, recall, cancel a hold, own sale draft | `sale.create` |
| Supplier bill draft | `purchase.manage` |
| Handover | `shift.close` (outgoing), `shift.open` (incoming) |
| Read audit log | `audit.view` (admin) |
| Export audit log | `audit.export` (admin) |
| Run and review books check | `integrity.view` (admin) |
| Cash flow | `finance.view` |

Duplicate payments and refunds are already blocked by idempotency keys and the busy lock. Nothing here changes that.

## 10. Testing and finish of each stage

For each stage: write the failing test, watch it fail, build, run `npm test`, `npm run typecheck`, `npm run lint`, one `npm run ui-audit` run, update Help and `docs/audit/KEYBOARD_SHORTCUTS.md` where it applies, then one local commit. Vitest stays in the Node environment, so decisions live in pure functions and screens are proved in the real app.

After all six: one fresh review of the whole branch, fixes, final full run, and the "after implementation" report from Part 9.

## 11. Failure cases the plan must test

1. A scan on another tab while a bill sits in hidden Sell.
2. A handover or logout while a bill is open.
3. A crash after the sale was saved but before the draft cleared.
4. A held bill whose product was turned off or re-priced.
5. A restored customer or supplier that no longer exists.

## 12. Out of scope

Dashboard (Project B). ZATCA submission. Arabic Help. Features marked "do not build" in the assessment. Correction buttons for the books check.
