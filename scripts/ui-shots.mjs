// Visual QA: seeds a temporary data folder with realistic FAKE data, opens the real app and screenshots every
// screen in light/dark, English/Arabic and two window sizes. Never touches the store's database.
// Usage: npm run build && node scripts/ui-shots.mjs <outDir>
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const out = process.argv[2] ?? join(root, 'ui-shots', 'latest');
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const dist = (p) => require(join(root, 'dist', 'main', p));

const dir = mkdtempSync(join(tmpdir(), 'pos-ui-'));
seed(join(dir, 'pos.db'));

function seed(dbPath) {
  const { openDatabase } = dist('db/connection.js');
  const { makeCtx } = dist('services/context.js');
  const { createUser } = dist('services/users.js');
  const { createProduct } = dist('services/catalog.js');
  const { createSupplier, createCustomer } = dist('services/parties.js');
  const { receiveGoods } = dist('services/inventory.js');
  const { openShift } = dist('services/shifts.js');
  const { finalizeSale } = dist('services/sales.js');
  const { createRefund } = dist('services/refunds.js');
  const { updateCustomerCredit, recordCustomerReceipt } = dist('services/credit.js');
  const { createExpense, postExpense, listCategories } = dist('services/expenses.js');
  const { createPurchaseInvoice, paySupplier } = dist('services/purchasing.js');
  const { recordWastage } = dist('services/adjustments.js');
  const ctx = makeCtx(openDatabase(dbPath));
  const owner = createUser(ctx, null, { username: 'owner', displayName: 'Owner', pin: '4321', roles: ['admin'] });
  const sup = createUser(ctx, owner, { username: 'sup', displayName: 'Supervisor', pin: '2222', roles: ['supervisor'] });
  const cashier = createUser(ctx, owner, { username: 'cashier', displayName: 'Cashier One', pin: '1111', roles: ['cashier'] });
  const set = ctx.db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  set.run('سوبرماركت تجريبي', 'store_name_ar');
  set.run('Demo Supermarket', 'store_name_en');
  const names = [
    ['WAT15', 'ماء ١.٥ لتر', 'Water 1.5L', 250, 150], ['MLK1', 'حليب طازج ١ لتر', 'Fresh milk 1L', 650, 480], ['BRD', 'خبز عربي', 'Arabic bread', 100, 60],
    ['RICE5', 'أرز بسمتي ٥ كجم', 'Basmati rice 5kg', 3200, 2500], ['OIL', 'زيت دوار الشمس ١.٨ لتر', 'Sunflower oil 1.8L', 1895, 1400], ['SUG', 'سكر ٢ كجم', 'Sugar 2kg', 950, 700],
    ['TEA', 'شاي أحمر ١٠٠ كيس', 'Black tea 100 bags', 1450, 1000], ['DAT', 'تمر سكري ١ كجم', 'Sukkari dates 1kg', 3500, 2400],
  ];
  const ids = names.map(([sku, ar, en, price, cost], i) => [createProduct(ctx, owner, { sku, nameAr: ar, nameEn: en, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: price, barcodes: [`62810000000${i}${i}`] }), cost]);
  const farm = createSupplier(ctx, owner, { name: 'Al Marai Distribution', vatNumber: '300000000000003', paymentTermsDays: 30 });
  const local = createSupplier(ctx, owner, { name: 'Jeddah Wholesale', paymentTermsDays: 0 });
  const g = receiveGoods(ctx, owner, { supplierId: farm, reference: 'DN-2231', lines: ids.map(([id, cost]) => ({ productId: id, qty: 40_000, unitCost: cost })) });
  receiveGoods(ctx, owner, { supplierId: local, reference: 'JW-88', lines: [{ productId: ids[2][0], qty: 100_000, unitCost: 55 }] });
  const total = ids.reduce((s, [, c]) => s + 40 * c, 0);
  const pi = createPurchaseInvoice(ctx, owner, { requestKey: 'seed-pi-0001', supplierId: farm, supplierInvoiceNo: 'AM-55012', supplierVatNo: '300000000000003', invoiceDate: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10), grnIds: [g.grnId], invoiceNet: total, vatAmount: Math.round(total * 0.15), vatRecoverable: true });
  paySupplier(ctx, owner, { requestKey: 'seed-sp-0001', supplierId: farm, amount: 50_000, method: 'bank', paidOn: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10), allocations: [{ invoiceId: pi.invoiceId, amount: 50_000 }] });
  const ahmed = createCustomer(ctx, owner, { name: 'Ahmed Al-Ghamdi', phone: '0551112222' });
  const sara = createCustomer(ctx, owner, { name: 'Sara Mini Market', phone: '0553334444' });
  updateCustomerCredit(ctx, owner, { customerId: ahmed, creditEnabled: true, creditLimit: 100_000, paymentTermsDays: 30 });
  updateCustomerCredit(ctx, owner, { customerId: sara, creditEnabled: true, creditLimit: null, paymentTermsDays: null });
  openShift(ctx, cashier, 20_000);
  let n = 0;
  const sale = (lines, payments, customerId) => finalizeSale(ctx, cashier, { idempotencyKey: `seed-sale-${++n}-x`, lines, payments, customerId });
  const s1 = sale([{ productId: ids[0][0], qty: 6000 }, { productId: ids[1][0], qty: 2000 }], [{ tender: 'cash', amount: 3_000 }]);
  sale([{ productId: ids[3][0], qty: 1000 }, { productId: ids[4][0], qty: 1000 }], [{ tender: 'card', amount: 5_095 }]);
  const c1 = sale([{ productId: ids[7][0], qty: 2000 }, { productId: ids[6][0], qty: 1000 }], [{ tender: 'cash', amount: 3_000 }, { tender: 'account', amount: 5_450 }], ahmed);
  sale([{ productId: ids[5][0], qty: 4000 }], [{ tender: 'account', amount: 3_800 }], sara);
  recordCustomerReceipt(ctx, cashier, { requestKey: 'seed-rc-0001', customerId: ahmed, amount: 2_000, method: 'cash', allocations: [{ saleId: c1.saleId, amount: 2_000 }] });
  createRefund(ctx, cashier, { requestKey: 'seed-rf-0001', invoiceNo: s1.invoiceNo, reason: 'Customer changed mind', lines: [{ saleLineNo: 1, qty: 1000, restock: true }], approverId: sup });
  recordWastage(ctx, owner, { requestKey: 'seed-ws-0001', reason: 'Expired', lines: [{ productId: ids[1][0], qty: 2000 }] });
  const cats = Object.fromEntries(listCategories(ctx, owner).map((c) => [c.nameEn, c.id]));
  const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  postExpense(ctx, owner, createExpense(ctx, owner, { requestKey: 'seed-ex-0001', categoryId: cats.Rent, description: 'Shop rent November', payee: 'Landlord', expenseDate: day, gross: 450_000, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false }), { requestKey: 'seed-ex-pay1', method: 'bank' });
  postExpense(ctx, owner, createExpense(ctx, owner, { requestKey: 'seed-ex-0002', categoryId: cats.Electricity, description: 'SEC electricity October', payee: 'Saudi Electricity Co.', expenseDate: day, dueDate: day, gross: 87_345, vatClass: 'standard', vatAmount: 11_393, vatRecoverable: true, invoiceRef: 'SEC-1029', supplierVatNo: '300000000000003' }));
  createExpense(ctx, owner, { requestKey: 'seed-ex-0003', categoryId: cats.Cleaning, description: 'Cleaning supplies', expenseDate: day, gross: 12_000, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false });
  ctx.db.pragma('wal_checkpoint(TRUNCATE)');
  ctx.db.close();
}

const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, POS_USER_DATA: dir, POS_RECEIPT_TO_FILE: join(dir, 'r.html') } });
const page = await app.firstWindow();
const shots = [];
const setSize = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); }, [w, h]);
const shoot = async (name) => {
  await page.waitForTimeout(250);
  const p = join(out, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  shots.push(p);
};

try {
  await setSize(1366, 768);
  await page.waitForSelector('form input');
  await shoot('00-login');
  const f = page.locator('form input');
  await f.nth(0).fill('owner');
  await f.nth(1).fill('4321');
  await page.click('button:has-text("Log in")');
  await page.waitForSelector('.top');

  // Tab labels in their on-screen order (read in English once; the same positions are used in Arabic).
  const tabs = (await page.locator('.top nav button, .top > button').allInnerTexts()).map((x) => x.trim()).filter((x) => !['Log out', 'العربية', 'English'].includes(x) && !/^\d|Backup/.test(x));
  const variants = [
    { id: 'light-en-1366', theme: 'light', ar: false, w: 1366, h: 768 },
    { id: 'dark-en-1366', theme: 'dark', ar: false, w: 1366, h: 768 },
    { id: 'light-ar-1366', theme: 'light', ar: true, w: 1366, h: 768 },
    { id: 'light-en-1024', theme: 'light', ar: false, w: 1024, h: 700 },
  ];
  for (const v of variants) {
    await setSize(v.w, v.h);
    await page.locator('select[aria-label="appearance"]').selectOption(v.theme);
    const isAr = await page.evaluate(() => document.documentElement.dir === 'rtl');
    if (isAr !== v.ar) await page.click('button[aria-label="language"]');
    for (const [i, tab] of tabs.entries()) {
      await page.locator('.top nav button, .top > button').nth(i).click();
      await page.waitForTimeout(300);
      if (tab === 'Sell') {
        await page.keyboard.type('6281000000000', { delay: 5 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(700);
        await page.keyboard.type('6281000000077', { delay: 5 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        await page.fill('input[placeholder]', '0551112222').catch(() => {});
      }
      if (tab === 'Customers') {
        await page.fill('input[aria-label="customer search"]', 'a');
        await page.waitForTimeout(500);
        await page.locator('table.list tbody tr').first().click().catch(() => {});
        await page.waitForTimeout(400);
      }
      if (tab === 'Purchases') {
        await page.locator('[aria-label="purchases section"] button').nth(2).click(); // balances and payments
        await page.waitForTimeout(300);
        await page.locator('table.list tbody tr button').first().click().catch(() => {});
        await page.waitForTimeout(400);
      }
      await shoot(`${v.id}-${String(i + 1).padStart(2, '0')}-${tab.toLowerCase()}`);
      if (tab === 'Sell') {
        // leave the bill: clear it so other variants start clean
        page.once('dialog', (d) => d.accept());
        await page.locator('button.danger:has-text("✕")').first().waitFor({ timeout: 1000 }).catch(() => {});
      }
    }
  }
  console.log(`${shots.length} screenshots in ${out}`);
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
