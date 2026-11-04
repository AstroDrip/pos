// End-to-end smoke test of the packaged-layout app (run `npm run build` first).
// Usage: node e2e/smoke.mjs [screenshotDir]
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const shots = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'pos-e2e-'));
const receipt = join(dir, 'receipt.html');
const dir2 = mkdtempSync(join(tmpdir(), 'pos-e2e-restore-'));
let closed = false;
const app = await electron.launch({ args: ['.'], env: { ...process.env, POS_USER_DATA: dir, POS_RECEIPT_TO_FILE: receipt } });
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
    throw e;
  }
};

try {
  const page = await app.firstWindow();
  await page.waitForSelector('text=First-time setup');

  await step('renderer has no Node access', async () => {
    const r = await page.evaluate(() => [typeof require, typeof process, typeof window.pos?.invoke, Object.keys(window.pos)]);
    assert.deepEqual(r, ['undefined', 'undefined', 'function', ['invoke']]);
  });

  await step('preload blocks unknown channels', async () => {
    const err = await page.evaluate(() => window.pos.invoke('fs.readFile', {}).then(() => 'allowed', (e) => e.message));
    assert.match(err, /Blocked channel/);
  });

  await step('webPreferences are secure', async () => {
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity };
    });
    assert.deepEqual(prefs, { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
  });

  await step('first-run owner setup', async () => {
    const inputs = page.locator('input');
    await inputs.nth(0).fill('owner');
    await inputs.nth(1).fill('Owner');
    await inputs.nth(2).fill('4321');
    await page.click('text=Create owner');
    await page.waitForSelector('text=Open shift');
  });

  await step('create a barcoded product', async () => {
    await page.click('button:has-text("Products")');
    const f = page.locator('form input');
    await f.nth(0).fill('WAT');
    await f.nth(1).fill('ماء ١.٥ لتر');
    await f.nth(2).fill('Water 1.5L');
    await f.nth(3).fill('2.50');
    await f.nth(5).fill('6281000000014');
    await page.click('text=Save product');
    await page.waitForSelector('text=Saved Water 1.5L');
  });

  await step('open shift', async () => {
    await page.click('button:has-text("Sell")');
    await page.locator('input').first().fill('100');
    await page.click('button:has-text("Open shift")');
    await page.waitForSelector('text=Scan, or type');
  });

  await step('scanner burst adds item even with focus in the text box', async () => {
    await page.locator('form input').first().focus();
    await page.keyboard.type('6281000000014', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForSelector('td:has-text("Water 1.5L")');
    assert.equal(await page.locator('form input').first().inputValue(), '');
  });

  await step('typed SKU adds to the same line', async () => {
    await page.waitForTimeout(600); // outside the double-scan window
    await page.locator('form input').first().fill('WAT');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.total:has-text("5.00 SAR")');
  });

  await step('cash sale saves, shows change and prints', async () => {
    await page.locator('input[aria-label="cash received"]').fill('10');
    await page.click('button:has-text("Cash")');
    await page.waitForSelector('text=SAVED INV-00000001');
    assert.match(await page.locator('.msg:has-text("SAVED")').innerText(), /Change: 5\.00/);
    const html = readFileSync(receipt, 'utf8');
    assert.match(html, /INV-00000001/);
    assert.match(html, /ماء/);
  });

  if (shots) await page.screenshot({ path: join(shots, 'pos-after-sale.png') });

  let recoveryCode = '';
  await step('admin: set up backup key and see the recovery code once', async () => {
    await page.click('.top button:has-text("Admin")');
    await page.click('button:has-text("Set up backup key")');
    recoveryCode = (await page.locator('pre').innerText()).trim();
    assert.match(recoveryCode, /^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/);
    await page.click('text=I have written it down');
    assert.equal(await page.locator('pre').count(), 0);
  });

  await step('admin: add a cashier and a supplier', async () => {
    const uf = page.locator('form:has(h3:text("Users")) input');
    await uf.nth(0).fill('cash1');
    await uf.nth(1).fill('Cashier One');
    await uf.nth(2).fill('1111');
    await page.click('button:has-text("Add user")');
    await page.waitForSelector('td:has-text("cash1")');
    await page.locator('form:has(h3:text("Suppliers")) input').first().fill('Farm Co');
    await page.click('button:has-text("Add supplier")');
    await page.waitForSelector('td:has-text("Farm Co")');
  });

  await step('stock: receive goods from the supplier', async () => {
    await page.click('.top button:has-text("Stock")');
    await page.locator('.card select').selectOption({ label: 'Farm Co' });
    await page.locator('.card input[placeholder="Search name or SKU"]').fill('Water');
    await page.click('.card button:has-text("Water 1.5L")');
    const row = page.locator('.card table.list tbody tr').first().locator('input');
    await row.nth(0).fill('24');
    await row.nth(1).fill('1.50');
    await page.click('button:has-text("Save receipt")');
    await page.waitForSelector('text=Received GRN-000001');
  });

  await step('cashier: discount needs supervisor PIN, then card sale', async () => {
    await page.click('.top button:has-text("Log out")');
    const f = page.locator('form input');
    await f.nth(0).fill('cash1');
    await f.nth(1).fill('1111');
    await page.click('button:has-text("Log in")');
    await page.waitForSelector('text=Scan, or type');
    assert.equal(await page.locator('.top button:has-text("Admin")').count(), 0);
    await page.keyboard.type('6281000000014', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.locator('input[aria-label="discount"]').fill('0.50');
    await page.locator('input[aria-label="discount"]').blur();
    await page.waitForSelector('text=Discount needs a supervisor');
    await page.fill('input[placeholder="Supervisor username"]', 'owner');
    await page.fill('input[placeholder="PIN"]', '0000');
    await page.click('.side button:has-text("Card")');
    await page.waitForSelector('text=NOT SAVED');
    await page.fill('input[placeholder="PIN"]', '4321');
    await page.click('.side button:has-text("Card")');
    await page.waitForSelector('text=SAVED INV-00000002');
  });

  await step('hold and recall a bill', async () => {
    await page.waitForTimeout(600);
    await page.keyboard.type('6281000000014', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.click('button:has-text("Hold bill")');
    await page.waitForSelector('text=Held:');
    await page.click('.cart button:has-text("(1)")');
    await page.waitForSelector('td:has-text("Water 1.5L")');
    await page.click('.side button:has-text("Cash")');
    await page.waitForSelector('text=SAVED INV-00000003');
  });

  await step('shift shows expected cash and closes', async () => {
    await page.click('.top button:has-text("Shift")');
    await page.waitForSelector('text=Expected cash in drawer');
    assert.match(await page.locator('table').innerText(), /107\.50/);
    page.once('dialog', (d) => d.accept());
    await page.locator('.card input').last().fill('107.50');
    await page.click('button:has-text("Close shift")');
    await page.waitForSelector('text=No open shift');
  });

  await step('owner: manual backup is verified and shown', async () => {
    await page.click('.top button:has-text("Log out")');
    const f = page.locator('form input');
    await f.nth(0).fill('owner');
    await f.nth(1).fill('4321');
    await page.click('button:has-text("Log in")');
    await page.click('.top button:has-text("Admin")');
    await page.click('button:has-text("Back up now")');
    await page.waitForSelector('text=Backup saved');
    assert.match(await page.locator('.top').innerText(), /Backup less than 1h ago/);
  });

  await step('Arabic UI switches to right-to-left and back', async () => {
    await page.click('button[aria-label="language"]');
    await page.waitForSelector('.top button:has-text("البيع")');
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await page.click('.top button:has-text("التقارير")');
    await page.waitForSelector('text=الأكثر مبيعاً');
    if (shots) await page.screenshot({ path: join(shots, 'pos-arabic-reports.png') });
    await page.click('.top button:has-text("البيع")');
    if (shots) await page.screenshot({ path: join(shots, 'pos-arabic-sell.png') });
    await page.click('button[aria-label="language"]');
    await page.waitForSelector('.top button:has-text("Sell")');
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
  });

  await step('receipt renders at 80 mm with shaped Arabic (visual check image)', async () => {
    const png = await app.evaluate(async ({ BrowserWindow }, file) => {
      const w = new BrowserWindow({ width: 320, height: 760, show: false, webPreferences: { sandbox: true, javascript: false } });
      await w.loadFile(file);
      const img = await w.webContents.capturePage();
      w.destroy();
      return img.toPNG().toString('base64');
    }, receipt);
    assert.ok(png.length > 1000);
    if (shots) writeFileSync(join(shots, 'receipt-80mm.png'), Buffer.from(png, 'base64'));
  });

  // Last: Playwright keeps waiting on a cancelled navigation.
  await step('navigation away is blocked', async () => {
    await page.evaluate(() => { window.location.href = 'https://example.com'; });
    await page.waitForTimeout(500);
    assert.match(page.url(), /^file:/);
  });

  await app.close();
  closed = true;

  // Replacement computer: empty data folder, restore with the recovery code.
  const bak = readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.posbak')).sort().at(-1);
  const env2 = { ...process.env, POS_USER_DATA: dir2, POS_RECEIPT_TO_FILE: receipt, POS_RESTORE_FILE: join(dir, 'backups', bak), POS_NO_RELAUNCH: '1' };
  const app2 = await electron.launch({ args: ['.'], env: env2 });
  await step('restore on a new computer with the recovery code', async () => {
    const p2 = await app2.firstWindow();
    await p2.waitForSelector('text=Replacing a computer?');
    await p2.fill('input[placeholder^="XXXXX"]', recoveryCode.toLowerCase());
    await p2.click('button:has-text("Choose backup file and check it")');
    await p2.waitForSelector('text=Last invoice: INV-00000003');
    p2.once('dialog', (d) => d.accept());
    const exited = new Promise((r) => app2.process().once('exit', r));
    await p2.click('button:has-text("Restore this backup")');
    await exited;
  });
  const app3 = await electron.launch({ args: ['.'], env: { ...process.env, POS_USER_DATA: dir2, POS_RECEIPT_TO_FILE: receipt } });
  await step('restored data: owner can log in and all 3 sales are there', async () => {
    const p3 = await app3.firstWindow();
    const f = p3.locator('form input');
    await f.nth(0).fill('owner');
    await f.nth(1).fill('4321');
    await p3.click('button:has-text("Log in")');
    await p3.waitForSelector('.top');
    const r = await p3.evaluate(() => window.pos.invoke('report.sales', { fromDay: '2000-01-01', toDay: '2099-12-31' }));
    assert.equal(r.ok, true);
    assert.equal(r.data.saleCount, 3);
    assert.equal(r.data.totalIncl, 500 + 200 + 250);
  });
  await app3.close();
} finally {
  if (!closed) await app.close();
  rmSync(dir2, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  for (const r of results) console.log(r.join('  '));
  console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} steps passed`);
}
