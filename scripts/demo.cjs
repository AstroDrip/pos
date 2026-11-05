// Opens the app with a separate DEMO data folder (demo-data/) filled with sample products, so the real
// store database is never touched. Receipts are written to demo-data/last-receipt.html instead of printing.
// Usage: npm run demo        (delete the demo-data folder to start the demo fresh)
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const dist = (p) => require(join(root, 'dist', 'main', p));
const dataDir = join(root, 'demo-data');
const dbPath = join(dataDir, 'pos.db');

// Demo-only logins (test values; never use these for the real store).
const DEMO_USERS = [
  { username: 'owner', displayName: 'Owner (demo)', pin: '4321', roles: ['admin'] },
  { username: 'cashier', displayName: 'Cashier (demo)', pin: '1111', roles: ['cashier'] },
];

function seed() {
  const { openDatabase } = dist('db/connection.js');
  const { makeCtx } = dist('services/context.js');
  const { createUser } = dist('services/users.js');
  const { createProduct } = dist('services/catalog.js');
  const { createSupplier, createCustomer } = dist('services/parties.js');
  const { receiveGoods } = dist('services/inventory.js');
  const { ean13CheckDigit } = dist('core/scale-barcode.js');
  const ean = (twelve) => twelve + ean13CheckDigit(twelve);

  mkdirSync(dataDir, { recursive: true });
  const ctx = makeCtx(openDatabase(dbPath));
  const owner = createUser(ctx, null, DEMO_USERS[0]);
  createUser(ctx, owner, DEMO_USERS[1]);
  const set = ctx.db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  set.run('سوبرماركت تجريبي', 'store_name_ar');
  set.run('Demo Supermarket', 'store_name_en');
  set.run('300000000000003', 'store_vat_number');
  ctx.db.prepare("INSERT INTO scale_barcode_formats (prefix, item_digits, value_digits, embedded) VALUES ('21', 5, 5, 'weight'), ('22', 5, 5, 'price')").run();

  const P = (sku, nameAr, nameEn, kg, price, barcode, plu) =>
    createProduct(ctx, owner, {
      sku, nameAr, nameEn, unitCode: kg ? 'KG' : 'PCS', sellMode: kg ? 'weight' : 'unit', vatRateBp: 1500, priceIncl: price,
      reorderLevel: kg ? 5000 : 10_000, barcodes: barcode ? [barcode] : [], plu,
    });
  const products = [
    [P('WAT15', 'ماء ١.٥ لتر', 'Water 1.5L', false, 250, ean('628100000001')), 1500, 48_000],
    [P('MLK1', 'حليب طازج ١ لتر', 'Fresh milk 1L', false, 650, ean('628100000002')), 480, 24_000],
    [P('BRD', 'خبز عربي', 'Arabic bread', false, 100, ean('628100000003')), 60, 40_000],
    [P('RICE5', 'أرز بسمتي ٥ كجم', 'Basmati rice 5kg', false, 3200, ean('628100000004')), 2500, 12_000],
    [P('APL', 'تفاح أحمر', 'Red apples', true, 799, null, '123'), 500, 30_000],
    [P('TOM', 'طماطم', 'Tomatoes', true, 450, null, '124'), 250, 25_000],
    [P('BAN', 'موز', 'Bananas', true, 599, null, '125'), 350, 20_000],
  ];
  const sup = createSupplier(ctx, owner, { name: 'Farm Co (demo)', vatNumber: '300000000000003', paymentTermsDays: 30 });
  receiveGoods(ctx, owner, { supplierId: sup, reference: 'DEMO-OPENING', lines: products.map(([id, cost, qty]) => ({ productId: id, qty, unitCost: cost })) });
  createCustomer(ctx, owner, { name: 'Ahmed (demo)', phone: '0551112222' });
  ctx.db.pragma('wal_checkpoint(TRUNCATE)');
  ctx.db.close();

  writeFileSync(
    join(dataDir, 'DEMO-GUIDE.txt'),
    [
      'DEMO DATA ONLY — not the real store. Delete this folder to reset the demo.',
      '',
      'Logins:',
      ...DEMO_USERS.map((u) => `  ${u.username} / PIN ${u.pin}  (${u.roles.join(', ')})`),
      '',
      'Type these in the Sell screen box and press Enter (or scan them):',
      `  Water 1.5L         ${ean('628100000001')}`,
      `  Fresh milk 1L      ${ean('628100000002')}`,
      `  Arabic bread       ${ean('628100000003')}`,
      `  Basmati rice 5kg   ${ean('628100000004')}   (or SKU: RICE5)`,
      `  Red apples 1.235 kg scale label   ${ean('210012301235')}`,
      `  Tomatoes 0.800 kg scale label     ${ean('210012400800')}`,
      `  Bananas, label price 5.99 SAR     ${ean('220012500599')}`,
      '',
      'Customer phone to attach: 0551112222',
      'Receipts are saved to last-receipt.html in this folder (open it in a browser) instead of printing.',
    ].join('\r\n'),
  );
}

if (!existsSync(dbPath)) seed();

const electron = require('electron'); // path to the Electron binary when required from Node
const child = spawn(electron, ['.'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, POS_USER_DATA: dataDir, POS_RECEIPT_TO_FILE: join(dataDir, 'last-receipt.html') },
});
child.unref();
console.log(`Demo started. Logins and test barcodes: ${join(dataDir, 'DEMO-GUIDE.txt')}`);
