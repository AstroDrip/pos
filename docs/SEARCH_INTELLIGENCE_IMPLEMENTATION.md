# Search Intelligence: Implementation

**Date:** 2026-11-08. **Branch:** `feature/owner-tools`. **Spec:** `docs/superpowers/specs/2026-11-07-search-keys-help-alignment-design.md`.

## 1. Where search is used

| Place | Code | Behaviour now |
|---|---|---|
| POS product box | `SearchBox.tsx` → `catalog.suggest` → `searchProducts` | From the **first character**; 8 results for one character, 12 otherwise |
| Product pickers (Products, Stock receive/wastage/count, Purchases return) | `useSuggest` → `catalog.search` → `searchProducts` | From the first character; 20 results |
| Customers tab | `useSuggest` → `credit.find` → `findCreditCustomers` | From the first character; ranked (see §5) |
| Sell customer box | `customer.find` → `findCustomers` | Ranked the same way |
| Help Centre | `searchHelp` (`core/help-search.ts`) | From the first character, over titles and search words |
| Suppliers | Drop-down lists | No free-text search exists, so nothing changed |
| Refund | Exact receipt number | Unchanged (an exact lookup is correct) |

All boxes share the same rules: `core/suggest-keys.ts` (`shouldQuery`, `moveActive`) and the `renderer/useSuggest.ts` hook.

- **Debounce:** 150 ms (250 ms for customers).
- **Stale answers:** a slower, older answer never replaces a newer one.
- **IME:** nothing is searched while an IME is composing.
- **Permissions:** each screen still calls its own service, with its own permission checks.

## 2. Product ranking

Match levels are unchanged and always come first:

1. barcode;
2. SKU / PLU;
3. exact name;
4. name starts with;
5. word starts with (FTS5);
6. alias / category;
7. SKU starts with.

**Inside one level**, products are ordered by demand (higher first), then by shorter name, then alphabetically. A popular product can never move above a stronger match. This is tested in `search.test.ts`: "never beats a stronger match".

**One character uses only indexed lookups:**
- exact codes;
- "name starts with" range scans on `name_en_norm` and `name_ar_norm`.

FTS and the SKU-prefix scan start from two characters, because a one-character FTS prefix has no index.

Arabic normalisation is unchanged: alef and hamza forms, ta marbuta, diacritics and digits are folded. One Arabic letter matches both `أرز` and `ارز` (tested).

Typo tolerance was **not** added. It would weaken exact matching for codes.

## 3. Demand score (`services/demand.ts`)

- **Source:** completed sales only. Rows in `sales` are always finalised and immutable. Held bills are not sales and do not count (tested).
- **Unit counted:** distinct sales containing the product, not units, because kg and pieces cannot be compared.
- **Refunds:** each refund subtracts its share of that sale (refunded qty ÷ sold qty).
- **Score:**
  ```
  0.5·n7/7 + 0.3·n30/30 + 0.2·n90/90
  ```
  This is net sales per day, with recent days weighted more.
- **Conservative rule:** fewer than **3** net sales in 90 days gives no score. That is neutral: new products keep their normal place.
- **No migration and no network.**

### Speed

The first version recomputed 90 days after every sale and took 0.5–1.1 s at 27,000 sales, which would freeze the first keystroke after a sale. It was replaced before commit.

How it works now:
- an in-memory cache per database;
- new sales and refunds are added incrementally;
- the 7/30/90-day windows are aged incrementally (only sales crossing a window edge are read);
- the full read happens once, at app start.

Equivalence tests compare the incremental results with a full recompute after new sales, refunds and ageing across all three edges.

| Measured (27,000 sales × 5 lines, 500 products) | Time |
|---|---|
| First call (at app start) | 830 ms |
| After a new sale | 0.7–2.6 ms |
| Ageing after 10 minutes | 0.9–5.3 ms |
| Cached | 0.06 ms |

### Search latency

`scripts/search-bench.cjs`, POS limits, run on this PC:

| Query | 10k products p50 / p95 | 100k products p50 / p95 |
|---|---|---|
| 1 letter "b" | 0.26 / 0.62 ms | 0.86 / 1.77 ms |
| 1 letter Arabic "م" | 0.24 / 0.86 ms | 1.16 / 2.45 ms |
| 2 letters "ba" | 0.84 / 1.50 ms | 3.83 / 6.79 ms |
| 3 letters "ban" | 0.69 / 1.49 ms | 3.22 / 5.22 ms |
| Barcode exact | 1.29 / 4.15 ms | 2.46 / 3.95 ms |

## 4. Not done (limitations)

- **Time-of-day or day-of-week weighting.** The store is not live, so there is no history to learn from.
- **Typo tolerance.** Deliberately not added.
- **Suppliers.** They have no free-text search.

## 5. Customer ranking (`parties.ts` `rankCustomers`)

Order:
1. exact phone or customer number;
2. name or phone starting with the text;
3. contains the text.

Inside each group, the customer with the most recent sale or payment comes first, then by name.

`sales.customer_id` has no index and no migration was allowed, so last activity comes from an incremental in-memory cache that reads only new sales and receipts. It does not use a correlated subquery over all sales.

## 6. Tests

- `services/search.test.ts` (7);
- `services/demand.test.ts` (11);
- `core/search-normalize.test.ts`;
- `core/suggest-keys.test.ts`;
- customer ranking in `services/credit.test.ts` (3);
- `core/help-search.test.ts`.

The real app was also checked: the first letter "W" shows suggestions (`npm run ui-audit`).
