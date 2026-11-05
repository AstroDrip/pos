# Search Performance Report

Measured 2026-11-05 on the development laptop (Windows 11, Node 24.19.0, SQLite 3.53.4, the same engine the app bundles). **This is not the store PC.** Re-run `node scripts/search-bench.cjs` there before go-live. Raw results: [search-bench-2026-11-05.json](search-bench-2026-11-05.json).

## Strategy

| Query type | Index used | Why |
|---|---|---|
| Exact barcode | `product_barcodes` primary key | Scans must be instant |
| Exact SKU | `products.sku` UNIQUE index | — |
| Exact PLU | `plu_codes` primary key | — |
| Name starts with (EN / AR) | `ix_products_name_en_norm`, `ix_products_name_ar_norm`: partial B-tree indexes (`WHERE active = 1`) on **normalised** names, queried as a range `>= q AND < q‖U+10FFFF` | Equivalent to `LIKE 'q%'` but always uses the index (no collation pitfalls) |
| Any word starts with | FTS5 table `product_fts(names, aliases, category)`, `unicode61 remove_diacritics 2`, `prefix='2 3'` | Prefix indexes make 2- and 3-character queries cheap |
| SKU starts with | `products.sku` UNIQUE index range | — |
| Not used | `LIKE '%q%'` | Full index scan (the old implementation: `SCAN products …`) |

**Normalisation** (`src/core/search-normalize.ts`) applies to search keys only; stored names are untouched:
- NFKC, then lower case;
- remove harakat and tatweel;
- unify أ/إ/آ/ٱ → ا, ى/ئ → ي, ة → ه, ؤ → و;
- convert Arabic-Indic digits to ASCII;
- turn punctuation into word breaks.

The owner should confirm that treating ة/ه and ى/ي as equal is acceptable. It improves recall, and products whose names differ only in those letters would both be listed, never one silently substituted for the other.

**Ranking**
1. Exact barcode.
2. Exact SKU or PLU.
3. Exact name.
4. Name starts with the text.
5. Every typed word starts a word in the name.
6. Alias or category.
7. SKU prefix.

Within a tier, shorter names come first. Results are capped at 20.

**UI** (`src/renderer/SearchBox.tsx`)
- Suggestions after 3 Latin / 2 Arabic characters; codes at any length.
- 200 ms debounce.
- A sequence counter drops stale responses.
- No query runs while an IME is composing.
- ↑/↓/Enter/Esc keyboard control.
- Digit-only input on Enter always uses the exact lookup.

## Query plans (`EXPLAIN QUERY PLAN`)

```
barcode       SEARCH b USING INDEX sqlite_autoindex_product_barcodes_1 (barcode=?) ; SEARCH p USING INTEGER PRIMARY KEY
sku           SEARCH p USING INDEX sqlite_autoindex_products_1 (sku=?)
plu           SEARCH c USING INDEX sqlite_autoindex_plu_codes_1 (plu=?) ; SEARCH p USING INTEGER PRIMARY KEY
name EN       SEARCH p USING COVERING INDEX ix_products_name_en_norm (name_en_norm>? AND name_en_norm<?)
name AR       SEARCH p USING COVERING INDEX ix_products_name_ar_norm (name_ar_norm>? AND name_ar_norm<?)
word prefix   SCAN f VIRTUAL TABLE INDEX 0:M3 (FTS5 full-text index) ; SEARCH p USING INTEGER PRIMARY KEY
SKU prefix    SEARCH p USING INDEX sqlite_autoindex_products_1 (sku>? AND sku<?)
old LIKE      SCAN products USING COVERING INDEX ix_products_name_en      ← full scan, replaced
```

The FTS line says "SCAN … VIRTUAL TABLE", but that is FTS5's own inverted index (`M3` = MATCH), not a table scan.

## Results: whole `searchProducts()` call, 60 runs each, milliseconds

| Products | DB size | Index build | Barcode p95 | SKU p95 | "ban" p95 | Arabic "مو" p95 | "prem" p95 | "almarai milk" p95 | no result p95 | Worst max |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 0.8 MB | 25 ms | 1.08 | 1.08 | 1.08 | 1.25 | 1.15 | 1.45 | 0.85 | 8.8 |
| 10,000 | 5.4 MB | 251 ms | 0.93 | 1.41 | 1.21 | 1.18 | 1.29 | 1.50 | 1.69 | 2.5 |
| 50,000 | 26.6 MB | 4.4 s | 2.68 | 2.69 | 3.15 | 3.35 | 4.00 | 4.84 | 2.81 | 7.6 |
| 100,000 | 52.8 MB | 14.1 s | 3.40 | 2.87 | 2.92 | 3.87 | 4.79 | 5.46 | 3.83 | 7.3 |

**Before optimisation** (same machine, first run): at 100k products, "prem" had p95 33 ms and max 39 ms, and the index build took 38–45 s. Two changes fixed this (BUG-014): no bm25 sort over all matches, and cached prepared statements.

**Target and verdict.** The target was suggestions within the 200 ms debounce, with a barcode scan feeling instant. The worst query measured was 8.8 ms, at least 20× below the budget, even at 100,000 products. A real supermarket catalogue is usually 5,000–30,000 products.

**Write overhead.** Indexing costs about 0.14 ms per product during a full rebuild. Creating or editing one product adds one FTS row and one index update, well under 1 ms. The full rebuild runs only when the index format changes (`search_index_version`) or on first start after migration 004 (14 s at 100k; well under a second at typical sizes).

**Synthetic data.** 30 base products × 12 variants × 20 brands × 12 sizes, in Arabic and English, giving realistic prefix collisions (≈1/30 of the catalogue matches "ban"). Measurements are in-process; the IPC hop to the renderer adds about 1 ms. Time-to-suggestion in the UI is about 200 ms debounce + under 10 ms.
