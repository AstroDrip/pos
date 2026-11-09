# UI redesign and interactive data: audit and plan

**Date:** 2026-11-10. **Status:** approved and built. See section 12.

Covers two owner briefs: "Interactive data visualisation and contextual visual help", and "Complete POS UI/UX redesign". The second brief arrived cut off at Module 6 (Purchases). Modules 7 to 13 below come from the module table in the first brief and from this audit, until the rest arrives.

**How this was audited.** Every renderer file was outlined from the code: components, headings, tables and columns, inputs, buttons, IPC calls. `App.tsx` was read for navigation. Screenshots with demo data were viewed for Sell, Accounting, Customers, Stock, Purchases, Expenses, Reports and Admin at 1366×768. They date from 8 November, so they predate Proforma VAT, Cloud Backup and Hardware test.

**Not fully done.** Refund, Products, Shift, Audit and Help were judged from code only. Workflows were not re-traced end to end for this audit. The repository has no ZATCA folder: only two documents, plus VAT and QR code in `src/core/vat.ts` and `src/main/receipt-html.ts`. None of that is touched.

## 1. Screen inventory

| Screen | Main user and job | What they should see first | Problems found | Keep as is |
|---|---|---|---|---|
| **Sell** | Cashier: scan, take payment | The bill and the total | The total is already strong. The customer box sits between search and total. Hold and Clear look alike, and Clear wipes the bill. Help text is always on show | Keys, scanner, held bills, drafts, quick actions |
| **Refund** | Cashier or supervisor: return goods | The original sale and what can come back | One page with find, items and history. Refundable and refunded quantities need clearer separation (code only) | All limits and approvals |
| **Customers** | Owner or supervisor: collect money | Who, how much, overdue, what to do | 10 equal tiles. A 7-column invoice list with 8 filter pills. Dispute and Write off are plain row buttons. Payments, statement, collect and settings are all one scroll | Payment, advance, statement, credit logic |
| **Shift** | Cashier: cash control | Expected cash now | Cash in/out, close, handover and a 9-column history compete (code only) | Handover, close rules |
| **Products** | Manager: maintain catalogue | Find a product | 11 inputs in one form. No grouping of price, codes and tax (code only) | Validation |
| **Stock** | Manager: decide what to order | Low, out, unusual | Three entry forms take the page. The decision list is a narrow side column. Quantities read 140.000 for pieces. There is no stock movement history screen | Receive, wastage, count |
| **Purchases** | Manager: bills and supplier debts | Who we owe, what is due | 9 pills at one level. Three lists sound alike (Supplier invoices, Purchase register, Saved bills). Three ways to enter goods. Statement, tiles and invoices in one column | Bill entry, drafts, VAT review |
| **Expenses** | Owner: control costs | Spent, owed, overdue | 6 filters and 7 tiles before any record. Two tiles only split a third. Recurring, prepaid and categories trail below in one long page | All posting |
| **Accounting** | Owner: financial picture | Result, cash, who owes | 19 equal tiles. Period and right-now figures are mixed under "Owner overview". Eight sections in one scroll. Negative cash has no explanation | Provisional notes, all figures |
| **Reports** | Owner: how did we do | Trend and comparison | Summary fills a narrow column with empty space beside it. No trend visual. 12-column cashier table | Report data |
| **Admin** | Administrator: setup | Is anything wrong | About 10 cards, all open at once. Three columns of long forms. Backup state appears four times | Everything |
| **Audit** | Owner: who did what | Recent events | Own date code. Books check tucked inside (code only) | Detail, export |
| **Help** | Everyone | The answer for this screen | Good base. Only some screens link to it | Registry and tests |

**Secondary screens:** Quick actions (Ctrl+K), item information, held bills, keyboard settings, enter supplier bill, saved bill, purchase reports, Proforma VAT, expense form and detail, books check, cloud backup, hardware test, store details, scale labels, import, first-run restore, Help overlay. All stay. None is removed.

## 2. What is hard to understand

1. **Everything has the same weight.** Accounting's "Sales 211.45" looks the same as "Products below reorder 0".
2. **Amounts have no unit** on most tiles and tables.
3. **Same word, two meanings.** Reports says "Cash (net of change)" 65.50. Accounting says "Cash collected (net)" 63.00. Both are right: one is before the 2.50 refund. Nothing says so. "Net sales" also appears with and without VAT.
4. **Period and right-now figures are mixed.** Stock value and "Expenses still owed" sit under a date filter they ignore.
5. **Dates** show as 08/11/2026 in pickers and 2026-11-08 in tables.
6. **Warnings repeat.** The provisional notice is a large box on several screens.
7. **The screen shows entry before information** on Stock and Admin.

## 3. Repetition

| What | Decision |
|---|---|
| "Customers owe" / "Store owes" on Accounting, Customers, Purchases | Keep one summary on Accounting. Customers and Purchases keep their own detail (**1 + 5**) |
| Excl. recoverable VAT and Recoverable input VAT tiles on Expenses | Into an expandable detail (**4**) |
| Backup state in badge, Backup, Cloud Backup, Dashboard health | Badge stays. The three cards become one section (**2**) |
| Customers owe and overdue, 10 tiles | Answer line plus detail (**4**) |
| Provisional notice on each screen | Short tag, with full reasons on one expand (**4**) |
| Supplier invoices, Purchase register, Saved bills | Group under History with clear names. No merging until checked (**5**) |
| Stock → Receive goods and Purchases → Enter bill | Different jobs. Keep both, behind a button on Stock (**5**) |
| Suppliers form in Admin | Move to Purchases as a Suppliers view (**3**) |
| Cashier table with 12 columns, refund table with 10 | Key columns shown, the rest on expand (**4**) |

## 4. Code and design system

**In good shape:** one set of 78 tokens, light and dark. One navigation list (`TABS`). Tabs kept alive by `TabPane`. Central keys. The Help registry. No second design system is needed.

**To consolidate, not add to:**

| Duplication | Fix |
|---|---|
| `Kpi` in Expenses and `Tile` in Accounting are the same | One `Kpi` |
| Date range built five ways (Reports, Accounting, Expenses, `useRange`, Purchases, Audit) | One `DateNavigator` |
| `sar`, `sarOrZero`, `monthRange`, `Msg` repeated across screens | One small shared file |
| About 110 inline styles | Move repeats into classes |
| Ageing built separately in Customers and Purchases | Shared display. The sums stay in their services |
| `Bars` in Expenses is the only chart | Kept for lists, joined by one `Chart` |

**Charts.** The POS has no chart library, and no new package is needed. There will be one hand-written SVG `Chart`. The phone dashboard is a separate app with its own `BarChart`, so it stays a separate component that follows the same behaviour.

## 5. Navigation

One list stays the source: `TABS`, gaining six group names. `TabPane`, shortcuts and role checks do not change.

- **A slim left sidebar replaces the top tab bar.** At 1366 px the tabs wrap to two rows and take about 93 px today.
- Groups: **Sales** (Sell, Refund, Customers, Shift), **Inventory** (Products, Stock), **Purchasing** (Purchases), **Finance** (Expenses, Accounting), **Insights** (Reports, Audit), **System** (Admin, Help).
- Collapses to an icon rail, and remembers per user. **Sell always opens with the rail collapsed**, so the checkout keeps its width.
- Cashiers see only what they may open, so their list is short. Sell stays first.
- 13 small inline SVG icons. No icon package.
- A thin top strip keeps store name, backup state, theme, language and user.

## 6. Module changes

Each screen keeps every function. Each opens on what matters, with the rest one click away, using the existing `.seg` view switcher.

| Screen | Change |
|---|---|
| Sell | Customer box moves under the bill or into a slim row. Clear bill looks dangerous. Help line folds away. **No charts, no change to keys** |
| Refund | Clear steps: find, items, amount, method, confirm. Refundable and refunded side by side |
| Customers | Views: Overview, Invoices, Payments, Statement, Credit settings. One plain sentence: "Owes SAR 34.50. Nothing overdue." Write off styled as dangerous |
| Stock | Opens on Needs attention: out, low, unusual. Actions behind buttons. New Movements view from existing records |
| Products | Form grouped: Basics, Codes, Price and tax, Weighed. List with fewer columns |
| Purchases | Two levels: New, Suppliers owed, History, VAT review, Reports |
| Expenses | Opens on figures, trend, list. Recurring, prepaid and categories become views |
| Accounting | Views: Overview, Profit and loss, Cash flow, VAT, Balance sheet, Trial balance and ledger. Overview has 4 main figures, then two labelled groups: this period, right now |
| Reports | Chart first, then key figures, then tables |
| Shift | Expected cash first. Activity in time order. Close and handover behind buttons |
| Admin | Section list: Store, Users, Backup and recovery, Scale labels, Import, Hardware, Keyboard |
| Audit | Shared date navigator. Books check as its own view |

## 7. Interactive data

**`Chart`** handles line and bar:
- Hover shows a crosshair and tooltip, snapped to the nearest real point. Nothing is interpolated. The tooltip stays inside the chart.
- Multiple series all show at that point. A missing day shows a gap, never zero.
- Click opens a detail panel on the same screen. Closing it returns to the same place. Nothing in a chart can change a record.
- Keyboard: arrows move, Enter opens, Esc closes.
- Drag selects a range. Reset returns to default. Day, week and month where useful.
- A table of the same numbers is one click away.

**`DateNavigator`:** previous and next, a scrollable date strip, a normal date picker, Today, and range. It is remembered per user with the existing `useRemembered`. Wheel scrolling over the strip moves dates and does not scroll the page. Every chart, figure and table on a screen uses this one value.

**Where:** Reports (sales by day and hour, refunds), Accounting (monthly result), Expenses (monthly, category), Stock (movements), Customers (account history), Purchases (timeline). Shift and Audit get time-ordered lists, because a chart would add nothing. Sell, Refund, Products and Admin get no charts.

**Data rule.** New read-only IPC calls reuse `periodKpis`, `salesSummary` and the other existing services per day. Sales by hour is one new read-only query over `sales`. A test proves the hours add up to the day. Detail records check permissions as they do today.

**Phone dashboard:** tap to read a point, drag for a crosshair, a date strip that scrolls by touch.

**Help:** add "i" notes to charts and any missing figures. Extend the registry test to Reports, Accounting, Audit and the new views. Every screen gets a link to its own guide. The checks that compare Help with the real formulas are kept.

## 8. Order of work

Each step is tested and committed alone.

1. Shared pieces: `Kpi`, `DateNavigator`, labels and formats. Move Reports first, as the proof.
2. Sidebar. Update the `ui-audit` selectors.
3. `Chart`, its data calls, and Reports.
4. Accounting and Expenses.
5. Customers and Purchases.
6. Stock and Products.
7. Sell and Refund, small and last, with the full key tests.
8. Shift, Audit, Admin, Help.
9. Phone dashboard interaction.
10. Full checks and report.

**Tests.** Vitest for snap, scale, range and date logic and for the new data calls. New `ui-audit` flows for each acceptance test, at the desktop sizes. Dashboard by hand in the built-in browser. All existing tests must keep passing. No Playwright.

## 9. Will not change

VAT, stock, invoice, payment and permission rules. No new framework, database or chart package. ZATCA code.

## 10. Issues noted, not to be fixed silently

- "Inventory turnover" is named in the brief, but the app has no such figure. Adding one means a new formula, so it is left out unless the owner and accountant define it.
- Stock has no history screen today, though the records exist. The Movements view adds a screen, not a new calculation.

## 11. Owner decisions

1. Send the rest of the second brief, from Module 6 onward.
2. Arabic: both briefs ask for RTL checks, but the standing rule is no Arabic checks. Default: the rule stands. Layouts use direction-safe CSS and Arabic is not checked.
3. Suppliers form moves from Admin to Purchases. Default: yes.

## 12. What was built, and what differs from this plan

Built as planned, in the order above, with these differences:

- **Sell:** the customer box stayed where it is. It sits on the cashier's key path (scan, F2 customer, payment), and the brief says not to disturb that. Key help folded away and Clear bill moved apart from Hold bill.
- **Purchases:** one strip of sections under four small group names, not two levels of tabs, so every section stays one click away.
- **Stock:** gained a Find box, because Ctrl+F needs a box on the opening view. It also finds by scanned barcode.
- **Not built:** Arabic checks (owner's rule) and inventory turnover (no such figure exists). Modules 7 to 13 of the second brief never arrived, so they follow the first brief's table and this audit.
- Touch on the Windows app is coded through pointer events, but was tested only with simulated events.
