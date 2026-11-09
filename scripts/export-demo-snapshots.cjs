// Builds the made-up shop with the real POS services and writes the figures the dashboard demo shows.
// Usage: npm run build:main, then node scripts/export-demo-snapshots.cjs
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const dist = (p) => require(join(__dirname, '..', 'dist', 'main', p));
const DAYS = 62;

const dir = mkdtempSync(join(tmpdir(), 'pos-demo-export-'));
try {
  const { openDatabase } = dist('db/connection.js');
  const { makeCtx } = dist('services/context.js');
  const { seedDemoShop } = dist('demo/seed.js');
  const { buildSnapshots } = dist('services/dashboard-sync.js');
  const { storeDay } = dist('core/store-time.js');
  const db = openDatabase(join(dir, 'pos.db'));
  const base = makeCtx(db);
  const now = new Date().toISOString();
  const ctx = { ...base, now: () => now, uuid: randomUUID };
  seedDemoShop(ctx, now, { days: DAYS });
  const events = buildSnapshots(ctx, DAYS + 5).map((s) => ({ ...s, createdAt: now }));
  db.close();
  const out = { storeName: 'Al Nakheel Grocery (demo)', today: storeDay(now), generatedAt: now, events };
  writeFileSync(join(__dirname, '..', 'dashboard', 'seed', 'demo-snapshots.json'), JSON.stringify(out));
  console.log(`Wrote ${events.length} records. Demo day: ${out.today}.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
