// Search performance benchmark (audit Part 2.6). Builds synthetic catalogues of 1k–100k products in temp databases,
// then measures index build time, query latency (p50/p95/max) and query plans. Run after `npm run build`:
//   node scripts/search-bench.cjs > search-bench.json
const { mkdtempSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const root = join(__dirname, '..');
const dist = (p) => require(join(root, 'dist', 'main', p));
const { openDatabase } = dist('db/connection.js');
const { makeCtx } = dist('services/context.js');
const { rebuildSearchIndex, searchProducts } = dist('services/search.js');
const { ean13CheckDigit } = dist('core/scale-barcode.js');

const EN = ['Banana', 'Apple', 'Tomato', 'Milk', 'Rice', 'Bread', 'Chicken', 'Lamb', 'Water', 'Juice', 'Cheese', 'Yogurt', 'Sugar', 'Tea', 'Coffee', 'Dates', 'Olive Oil', 'Pasta', 'Lentils', 'Onion', 'Potato', 'Cucumber', 'Orange', 'Mango', 'Eggs', 'Butter', 'Flour', 'Salt', 'Honey', 'Biscuits'];
const AR = ['موز', 'تفاح', 'طماطم', 'حليب', 'أرز', 'خبز', 'دجاج', 'لحم غنم', 'ماء', 'عصير', 'جبن', 'زبادي', 'سكر', 'شاي', 'قهوة', 'تمر', 'زيت زيتون', 'معكرونة', 'عدس', 'بصل', 'بطاطس', 'خيار', 'برتقال', 'مانجو', 'بيض', 'زبدة', 'طحين', 'ملح', 'عسل', 'بسكويت'];
const BRAND = ['Almarai', 'Nadec', 'Al Safi', 'Herfy', 'Sadia', 'Americana', 'Goody', 'Afia', 'Nova', 'Berain', 'Rani', 'Puck', 'Lipton', 'Tamimi', 'Panda', 'Danube', 'Othaim', 'Farm', 'Bayara', 'Halwani'];
const VARIANT = ['Premium', 'Imported', 'Organic', 'Family Pack', 'Small', 'Large', 'Fresh', 'Frozen', 'Light', 'Classic', 'Bunch', 'Local'];
const SIZE = ['250g', '500g', '1kg', '2kg', '5kg', '1L', '1.5L', '2L', '330ml', '6 pack', '12 pack', '24 pack'];

function build(n) {
  const dir = mkdtempSync(join(tmpdir(), 'pos-bench-'));
  const db = openDatabase(join(dir, 'pos.db'));
  const ctx = makeCtx(db);
  const t0 = performance.now();
  db.transaction(() => {
    const ins = db.prepare(`INSERT INTO products (sku, name_ar, name_en, unit_id, sell_mode, vat_rate_bp, price_incl, created_at, updated_at) VALUES (?, ?, ?, 1, 'unit', 1500, ?, 'x', 'x')`);
    const bc = db.prepare('INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)');
    for (let i = 0; i < n; i++) {
      const b = i % EN.length, v = Math.floor(i / EN.length) % VARIANT.length, br = Math.floor(i / (EN.length * VARIANT.length)) % BRAND.length, sz = i % SIZE.length;
      const id = Number(ins.run(`SKU${String(i).padStart(6, '0')}`, `${AR[b]} ${BRAND[br]} ${sz}`, `${BRAND[br]} ${EN[b]} ${VARIANT[v]} ${SIZE[sz]}${i >= EN.length * VARIANT.length * BRAND.length ? ' #' + i : ''}`, 100 + (i % 5000)).lastInsertRowid);
      const twelve = String(628000000000 + i);
      bc.run(twelve + ean13CheckDigit(twelve), id);
    }
  })();
  const tInsert = performance.now() - t0;
  const t1 = performance.now();
  rebuildSearchIndex(ctx);
  const tIndex = performance.now() - t1;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.prepare('ANALYZE').run();
  return { dir, db, ctx, tInsert, tIndex, size: statSync(join(dir, 'pos.db')).size };
}

function time(fn, runs = 60) {
  const ts = [];
  let out;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    out = fn();
    ts.push(performance.now() - s);
  }
  ts.sort((a, b) => a - b);
  const pick = (q) => +ts[Math.min(ts.length - 1, Math.floor(q * ts.length))].toFixed(3);
  return { p50: pick(0.5), p95: pick(0.95), max: +ts[ts.length - 1].toFixed(3), results: out.length, top: out[0] ? `${out[0].matchedBy}: ${out[0].product.nameEn}` : null };
}

const sizes = (process.argv[2] ?? '1000,10000,50000,100000').split(',').map(Number);
const report = [];
for (const n of sizes) {
  const b = build(n);
  const lastBarcode = String(628000000000 + n - 1);
  const queries = {
    'barcode exact': lastBarcode + ean13CheckDigit(lastBarcode),
    'SKU exact': `SKU${String(n - 1).padStart(6, '0')}`,
    'SKU prefix "SKU0001"': 'SKU0001',
    'name 1 letter "b"': 'b',
    'name 1 letter Arabic "م"': 'م',
    'name 2 letters "ba"': 'ba',
    'name 3 letters "ban"': 'ban',
    'name 2 letters Arabic "مو"': 'مو',
    'word prefix "prem"': 'prem',
    'two words "almarai milk"': 'almarai milk',
    'Arabic "ارز"': 'ارز',
    'no results "zzzq"': 'zzzq',
  };
  const results = {};
  for (const [label, q] of Object.entries(queries)) results[label] = time(() => searchProducts(b.ctx, q, [...q].length <= 1 ? 8 : 12)); // POS suggestion limits
  report.push({ products: n, dbBytes: b.size, insertMs: +b.tInsert.toFixed(0), indexBuildMs: +b.tIndex.toFixed(0), results });
  b.db.close();
  rmSync(b.dir, { recursive: true, force: true });
}

// Query plans (on a small catalogue: plans do not depend on size once ANALYZE has run)
const p = build(2000);
const plan = (sql, ...args) => p.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail);
const plans = {
  barcode: plan('SELECT p.id FROM products p JOIN product_barcodes b ON b.product_id = p.id WHERE b.barcode = ? AND p.active = 1', '1'),
  sku: plan('SELECT id FROM products p WHERE p.sku = ? AND p.active = 1', 'x'),
  plu: plan('SELECT p.id FROM products p JOIN plu_codes c ON c.product_id = p.id WHERE c.plu = ? AND p.active = 1', '1'),
  nameEnPrefix: plan('SELECT p.id FROM products p WHERE p.active = 1 AND p.name_en_norm >= ? AND p.name_en_norm < ? ORDER BY p.name_en_norm LIMIT 20', 'ban', 'ban\u{10FFFF}'),
  nameArPrefix: plan('SELECT p.id FROM products p WHERE p.active = 1 AND p.name_ar_norm >= ? AND p.name_ar_norm < ? ORDER BY p.name_ar_norm LIMIT 20', 'مو', 'مو\u{10FFFF}'),
  ftsWordPrefix: plan('SELECT p.id FROM product_fts f JOIN products p ON p.id = f.rowid WHERE product_fts MATCH ? LIMIT 40', 'names : ("prem"*)'),
  skuPrefix: plan('SELECT id FROM products p WHERE p.sku >= ? AND p.sku < ? AND p.active = 1 LIMIT 20', 'SKU0001', 'SKU0001\u{10FFFF}'),
  oldLikeSearchForComparison: plan("SELECT id FROM products WHERE name_en LIKE '%ban%'"),
};
p.db.close();
rmSync(p.dir, { recursive: true, force: true });
console.log(JSON.stringify({ node: process.versions.node, sqlite: require('better-sqlite3')(':memory:').prepare('select sqlite_version() v').get().v, report, plans }, null, 2));
