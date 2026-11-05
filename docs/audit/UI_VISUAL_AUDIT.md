# UI Visual Audit (Phase 0)

Date: 2026-11-06. Branch `feature/owner-tools` @ `c8fbb50`.

## How the audit was done

- **Rendered screens, not code alone.** `scripts/ui-shots.mjs` seeds a temporary folder with realistic fake data (8 products, 2 suppliers, a part-paid supplier invoice, credit customers, sales, a refund, wastage, expenses). It then opens the real Electron app and screenshots every tab.
- **45 baseline screenshots** are in `ui-shots/before/` (not committed; the folder is in `.gitignore`):
  - the login screen;
  - 11 tabs × 4 variants: light English 1366×768, dark English 1366×768, light Arabic 1366×768, light English 1024×700.
- **12 inspected by eye:**
  - Sell (light English 1366, light English 1024, light Arabic);
  - Customers with an account open;
  - Stock (dark);
  - Purchases (balances + supplier account);
  - Expenses, Reports, Admin.

  The other 33 were generated but not all reviewed one by one.
- **Not audited, because it does not exist:** the owner's mobile phone dashboard. Only its data side is built; the hosting decision is open.
- **Styling architecture today:**
  - one stylesheet (`src/renderer/styles.css`) with semantic colour tokens (light/dark);
  - **177 inline `style={{…}}`** in components, mostly ad-hoc layout (`maxWidth`, `flex`, `margin`, `width: 'auto'` on checkboxes, `padding: '2px 8px'` on table buttons);
  - no spacing, radius or type scale tokens;
  - no page-header component;
  - no icon library (the status badges use inline SVG).

## Findings by area

Severity: **C** critical, **H** high, **M** medium, **L** low.

### Global shell (top bar), every screen

| # | Sev | Finding | Fix |
|---|---|---|---|
| S1 | **C** | At 1024 px the 11 tabs plus the utilities are wider than the window. The bar's dark background stops, the controls spill onto the page background, the user name ("Owner") becomes white-on-light and invisible, and the page scrolls sideways | Tabs scroll horizontally inside the bar; utilities stay fixed at the end; nothing wraps |
| S2 | H | "Backup not set up" wraps to 3 lines and "Log out" to 2; the bar is about 130 px tall at 1366 px, eating screen space on every page | Compact status (dot + short label, details in a tooltip), `nowrap`, bar height 48 px |
| S3 | H | Tab order is illogical: Purchases, Expenses and Accounting come after Reports (they were appended over time) | Order by workflow: Sell, Refund, Customers · Stock, Products, Purchases · Expenses, Accounting, Reports · Shift, Admin |
| S4 | M | Tabs look like ordinary white content buttons, so the navigation does not read as navigation | Flat tab style: transparent, active = filled with the primary colour; consistent height |
| S5 | H | No page has a title; pages start directly with filters or forms | A shared `PageHeader` (title + short description + actions) on every back-office page. The Sell screen stays title-less to keep space for the cashier |

### Sell (POS)

| # | Sev | Finding | Fix |
|---|---|---|---|
| P1 | M | The customer box has only a placeholder, so once a phone is typed nothing says what the box is | Visible small label |
| P2 | M | The keyboard hint wraps to 2 lines under the search box | Smaller hint text; shorter wording kept |
| P3 | M | In the cart, the second-language product name aligns to the far end of the cell in English (it floats under the price) | Align the secondary name to the start, in its own direction |
| P4 | L | Empty discount boxes are as tall as the row | Compact inputs inside table rows |
| P5 | — | Total, payment buttons and shortcut hints are clear; Arabic RTL mirrors correctly | Keep |

### Customers

| # | Sev | Finding | Fix |
|---|---|---|---|
| C1 | **H** | Filter chips show raw codes: "paid", "partial", "due_soon", "no_due" (not translated, not human words) | Use the same labels as the status badges |
| C2 | H | Summary tiles wrap their values ("2026-11-06 / 2026-11-06" breaks into 3 lines); tile heights differ | Value text never wraps; smaller size for date values; equal tile heights |
| C3 | M | Cards nested inside the account card ("Receive a payment", "Credit settings") with different widths (900 vs 1000) | Inner sections become flat sub-panels at full width |
| C4 | M | Row buttons (Dispute / Write off / Reprint / Reverse) are full-size, making rows tall | Small row buttons; actions cell does not wrap |

### Stock

| # | Sev | Finding | Fix |
|---|---|---|---|
| K1 | M | Three narrow card columns; long helper text wraps; card headings have large top padding | Two-column grid that wraps under the stock table at narrow widths |
| K2 | M | "Stock on hand" with the low-stock filter shows an empty table with headers only, and no message | Empty-state row ("Nothing at or below its reorder level") |

### Purchases

| # | Sev | Finding | Fix |
|---|---|---|---|
| U1 | H | The sub-section buttons are oversized and "Balances and payments" wraps to 2 lines | Compact segmented control |
| U2 | M | Supplier summary tiles wrap ("3997.40 / 500.00"); 6 tiles of different height | Same tile rules as C2 |
| U3 | M | Pay form: the supplier select is truncated ("— choose –"); the date field takes more width than the amount | Form grid with sensible field widths |

### Expenses

| # | Sev | Finding | Fix |
|---|---|---|---|
| E1 | **H** | The recurring-expense form defaults to the first category, which is the capital "Equipment purchase" (shown truncated as "Equipment purchase (capi"). Same risk as BUG-016: a recurring rent could be booked as an asset | No default; the owner must choose |
| E2 | M | The categories table rows are about 50 px tall because of full-size "Edit" buttons | Small row buttons |
| E3 | M | The empty "Recurring expenses" table shows headers only, and the add form sits under it in a card | Empty-state row; the form becomes a flat sub-panel |

### Reports

| # | Sev | Finding | Fix |
|---|---|---|---|
| R1 | M | Timestamps use the operating system's locale format ("06/11/2026, 03:29:49") while every other screen uses "2026-11-06 03:29" (Saudi time) | One format: store time `YYYY-MM-DD HH:MM` |
| R2 | M | A wastage row is entirely red (every cell), which reads as an error | Only the negative value is red |
| R3 | L | Empty "Items removed before payment" shows headers only | Empty-state row |

### Admin

| # | Sev | Finding | Fix |
|---|---|---|---|
| A1 | **H** | Six cards squeezed side by side, each 160–200 px wide. Warning boxes wrap into tall narrow columns. The CSV file input is clipped ("N…") and the scale layout input is clipped | Responsive grid with a minimum card width of 340 px, so cards wrap into rows |

### Accounting, Refund, Shift, Products

- Viewed in earlier rounds; they share the same issues:
  - no page title;
  - tiles of uneven height;
  - flex rows with inline widths.
- Accounting's tiles have the same wrapping issue as C2. They are fixed by the shared rules.

### Themes and RTL

- **Dark theme:** surfaces, borders and inputs are dark; no white panels appeared.
- **Dark theme, issue:** disabled primary buttons are low-contrast (pale green on dark), which looks broken more than disabled. **M:** use a neutral disabled style.
- **Arabic:** the layout mirrors correctly (cart on the right, payment panel on the left, numbers in their own direction).
- **Arabic, issue:** the shell has the same overflow at narrow widths (S1).

### Accessibility

- Focus outlines are visible in both themes (from the earlier theme work).
- Icon-only "✕" buttons carry aria-labels in the cart; other icon-only uses are rare.
- Statuses never rely on colour alone.
- Reduced motion: there are no animations today. Any added transitions must respect `prefers-reduced-motion`.

## Plan

1. Tokens:
   - spacing 4/8/12/16/24/32;
   - radius 4/6/8;
   - type scale 12/13/14/15/18/22/32;
   - control height 36, small 28;
   - one shadow.
2. Shell: S1–S4, plus `PageHeader` (S5).
3. Shared rules:
   - tiles (C2, U2);
   - small row buttons (C4, E2);
   - sub-panels instead of nested cards (C3, E3);
   - segmented control (U1, C1);
   - empty-state rows (K2, E3, R3);
   - checkbox width;
   - neutral disabled style.
4. Screen fixes: P1–P4, C1, E1 (bug), R1, R2, A1, K1, U3.
5. Recapture every variant to `ui-shots/after/` and inspect.
6. Run the test suite and the real-app test.
