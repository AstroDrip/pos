// Opens the app with a separate DEMO data folder (demo-data/) holding a made-up shop, so the real store
// database is never touched. Receipts are written to demo-data/last-receipt.html instead of printing.
// Usage: npm run demo        (delete the demo-data folder, or run "npm run demo -- --fresh", for a new 12 days ending today)
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, renameSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const dist = (p) => require(join(root, 'dist', 'main', p));
const dataDir = join(root, 'demo-data');
const dbPath = join(dataDir, 'pos.db');
const marker = join(dataDir, 'DEMO-SHOP-V2');

function moveOldDemoAside() {
  if (!existsSync(dataDir)) return;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const to = join(root, 'demo-data-old-' + stamp);
  try {
    renameSync(dataDir, to);
  } catch {
    console.error('Could not move the old demo folder. Close the demo window and run this again.');
    process.exit(1);
  }
  console.log('The earlier demo folder was kept as ' + to);
}

function seed() {
  const { openDatabase } = dist('db/connection.js');
  const { makeCtx } = dist('services/context.js');
  const { seedDemoShop, DEMO_LOGINS } = dist('demo/seed.js');
  const { ean13CheckDigit } = dist('core/scale-barcode.js');
  const ean = (twelve) => twelve + ean13CheckDigit(twelve);

  mkdirSync(dataDir, { recursive: true });
  const ctx = makeCtx(openDatabase(dbPath));
  const result = seedDemoShop(ctx, new Date().toISOString());
  ctx.db.pragma('wal_checkpoint(TRUNCATE)');
  ctx.db.close();
  writeFileSync(marker, 'made-up demo shop\n');

  writeFileSync(
    join(dataDir, 'DEMO-GUIDE.txt'),
    [
      'DEMO DATA ONLY: a made-up shop, not the real store. Delete this folder to reset the demo.',
      '',
      result.sales + ' sales over ' + result.days + ' days, ending today.',
      '',
      'Logins:',
      ...DEMO_LOGINS.map((u) => '  ' + u.username + ' / PIN ' + u.pin + '  (' + u.roles.join(', ') + ')'),
      '',
      'Type these in the Sell screen box and press Enter (or scan them):',
      '  Fresh milk 1L      ' + ean('628000005000'),
      '  Basmati rice 5kg   ' + ean('628000005007') + '   (or SKU: RICE5)',
      '  Water 1.5L         ' + ean('628000005035'),
      '',
      'Receipts are saved to last-receipt.html in this folder (open it in a browser) instead of printing.',
    ].join('\r\n'),
  );
  console.log('Demo shop made: ' + result.sales + ' sales over ' + result.days + ' days.');
}

// An older demo, or one the user wants replaced, is moved aside and never deleted.
if (process.argv.includes('--fresh') || !existsSync(marker)) moveOldDemoAside();
if (!existsSync(dbPath)) seed();

const electron = require('electron'); // path to the Electron binary when required from Node
const child = spawn(electron, ['.'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, POS_USER_DATA: dataDir, POS_RECEIPT_TO_FILE: join(dataDir, 'last-receipt.html') },
});
child.unref();
console.log('Demo started. Logins and test barcodes: ' + join(dataDir, 'DEMO-GUIDE.txt'));
