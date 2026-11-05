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

  await step('keyboard: typed SKU goes to the quantity step; Enter adds to the same line', async () => {
    await page.waitForTimeout(600); // outside the double-scan window
    await page.locator('input[aria-label="product search"]').fill('WAT');
    await page.keyboard.press('Enter');
    await page.waitForSelector('input[aria-label="quantity"]:focus');
    assert.equal(await page.locator('input[aria-label="quantity"]').inputValue(), '1');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.total:has-text("5.00 SAR")');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'product search');
  });

  await step('search: "wat" suggests Water; arrow + Enter, then + and Enter in quantity; Arabic "ماء" finds it too', async () => {
    const box = page.locator('input[aria-label="product search"]');
    await box.fill('wat');
    await page.waitForSelector('.suggestions li:has-text("Water 1.5L")');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('input[aria-label="quantity"]:focus');
    await page.keyboard.press('+'); // 1 -> 2
    assert.equal(await page.locator('input[aria-label="quantity"]').inputValue(), '2');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.total:has-text("10.00 SAR")'); // 2 + 2 waters
    await page.waitForTimeout(400);
    await page.keyboard.press('+'); // empty search box: one more of the last item
    await page.waitForSelector('.total:has-text("12.50 SAR")');
    // invalid quantity is refused, Esc cancels without adding
    await box.fill('WAT');
    await page.keyboard.press('Enter');
    await page.waitForSelector('input[aria-label="quantity"]:focus');
    await page.locator('input[aria-label="quantity"]').fill('1.5');
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=This item is sold by whole units');
    await page.keyboard.press('Escape');
    await page.waitForSelector('input[aria-label="quantity"]', { state: 'detached' });
    assert.match(await page.locator('.total').innerText(), /12\.50/);
    await box.fill('ماء');
    await page.waitForSelector('.suggestions li:has-text("Water 1.5L")');
    await page.keyboard.press('Escape');
    await box.fill('');
    await page.click('button[aria-label="remove line"]'); // removes the whole 5 x water line (audited removal)
    await page.waitForSelector('.total:has-text("0.00 SAR")');
    for (const expected of ['2.50', '5.00']) {
      await box.fill('WAT');
      await page.keyboard.press('Enter');
      await page.waitForSelector('input[aria-label="quantity"]:focus');
      await page.keyboard.press('Enter');
      await page.waitForSelector(`.total:has-text("${expected} SAR")`);
    }
  });

  await step('appearance: dark mode during an open bill keeps the bill', async () => {
    const bg = () => page.evaluate(() => getComputedStyle(document.querySelector('.cart')).backgroundColor);
    const light = await bg();
    await page.locator('select[aria-label="appearance"]').selectOption('dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.notEqual(await bg(), light);
    assert.match(await page.locator('.total').innerText(), /5\.00/); // bill untouched
    if (shots) await page.screenshot({ path: join(shots, 'pos-dark-sell.png') });
    await page.locator('select[aria-label="appearance"]').selectOption('light');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.match(await page.locator('.total').innerText(), /5\.00/);
  });

  await step('keyboard: Enter on the empty box opens payment; Enter pays cash once; repeated Enter makes no second sale', async () => {
    await page.locator('input[aria-label="product search"]').focus();
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForSelector('input[aria-label="cash received"]:focus');
    await page.keyboard.type('10');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=SAVED INV-00000001');
    assert.match(await page.locator('.msg:has-text("SAVED")').innerText(), /Change: 5\.00/);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter'); // focus is back on the empty search box, bill empty
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => window.pos.invoke('shift.current', null));
    assert.equal(r.data.saleCount, 1);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'product search');
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
    const grn = page.locator('.card:has(h3:text("Receive goods"))');
    await grn.locator('select').selectOption({ label: 'Farm Co' });
    await grn.locator('input[placeholder="Search name or SKU"]').fill('Water');
    await grn.locator('button:has-text("Water 1.5L")').click();
    const row = grn.locator('table.list tbody tr').first().locator('input');
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
    // keyboard card payment: refused while a split card part is typed, then Ctrl+Enter records the card sale
    await page.locator('input[aria-label="card part"]').fill('1');
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('text=A split payment is in progress');
    await page.locator('input[aria-label="card part"]').fill('');
    await page.locator('input[aria-label="cash received"]').focus();
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+Enter');
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

  await step('cashier: refund needs a supervisor PIN, pays cash and prints a credit note', async () => {
    await page.click('.top button:has-text("Refund")');
    await page.fill('input[aria-label="refund invoice"]', 'inv-00000001');
    await page.click('button:has-text("Find sale")');
    await page.waitForSelector('td:has-text("Water 1.5L")');
    await page.fill('input[aria-label="refund qty 1"]', '3');
    await page.waitForSelector('text=Check the quantities'); // only 2 were sold
    await page.fill('input[aria-label="refund qty 1"]', '1');
    await page.fill('input[placeholder="Supervisor username"]', 'owner');
    await page.fill('input[placeholder="PIN"]', '4321');
    await page.click('button:has-text("Refund about 2.50 in cash")');
    await page.waitForSelector('text=Refund CN-00000001 saved. Give the customer 2.50 in cash.');
    await page.waitForTimeout(500);
    const html = readFileSync(receipt, 'utf8');
    assert.match(html, /CREDIT NOTE/);
    assert.match(html, /CN-00000001/);
    assert.match(html, /INV-00000001/);
    // the same receipt cannot refund more than is left
    await page.fill('input[aria-label="refund invoice"]', 'INV-00000001');
    await page.click('button:has-text("Find sale")');
    await page.waitForSelector('text=Already refunded on this receipt: CN-00000001');
  });

  await step('shift shows refund and expected cash, and closes', async () => {
    await page.click('.top button:has-text("Shift")');
    await page.waitForSelector('text=Expected cash in drawer');
    const table = await page.locator('table').innerText();
    assert.match(table, /Refunds paid in cash \(1\)\s+2\.50/);
    assert.match(table, /105\.00/); // 107.50 minus the 2.50 refund
    page.once('dialog', (d) => d.accept());
    await page.locator('.card input').last().fill('105.00');
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

  await step('owner: wastage and a stock count adjust stock and show in reports', async () => {
    await page.click('.top button:has-text("Stock")');
    const waste = page.locator('.card:has(h3:text("Record wastage"))');
    await waste.locator('input[aria-label="waste product search"]').fill('Water');
    await waste.locator('button:has-text("Water 1.5L")').click();
    await waste.locator('input[aria-label="waste qty 1"]').fill('1');
    await waste.locator('button:has-text("Save wastage")').click();
    // INV-00000001 was sold before any stock arrived (cost 0.00); its refunded unit came back at that cost,
    // so the average cost is (20 x 1.50 + 1 x 0.00) / 21 = 1.43.
    await page.waitForSelector('text=ADJ-000001 saved: 1 products changed, value -1.43');
    // stock now 24 received - 4 sold + 1 refunded - 1 wasted = 20; the shelf has 18
    const count = page.locator('.card:has(h3:text("Stock count"))');
    await count.locator('input[placeholder="e.g. Monthly count, aisle 3"]').fill('E2E count');
    await count.locator('input[aria-label="count product search"]').fill('Water');
    await count.locator('button:has-text("Water 1.5L")').click();
    await count.locator('input[aria-label="count qty 1"]').fill('18');
    await count.locator('button:has-text("Post count")').click();
    await page.waitForSelector('text=ADJ-000002 saved: 1 products changed, value -2.86');
    await page.click('.top button:has-text("Reports")');
    await page.waitForSelector('text=Net sales incl. VAT');
    const text = await page.locator('.page').innerText();
    assert.match(text, /Refunds \(1, paid in cash\)\s+-2\.50/);
    assert.match(text, /Net sales incl\. VAT\s+7\.00/); // 9.50 sold - 2.50 refunded
    assert.match(text, /Wastage and stock count differences \(2\)/);
  });

  await step('owner: rent expense posted and paid by bank shows in Expenses and in the P&L; books balance', async () => {
    await page.click('.top button:has-text("Expenses")');
    await page.click('button:has-text("New expense")');
    const form = page.locator('[aria-label="expense form"]');
    await form.locator('button:has-text("Save draft")').click();
    await form.locator('text=Choose a category').waitFor(); // no default category
    await form.locator('select[aria-label="expense category"]').selectOption({ label: 'Rent' });
    await form.locator('input[aria-label="expense description"]').fill('Shop rent');
    await form.locator('select').nth(1).selectOption('out_of_scope'); // VAT treatment
    await form.locator('input[aria-label="expense amount"]').fill('1500');
    await form.locator('button:has-text("Post and pay by bank")').click();
    await page.waitForSelector('text=Expense posted and paid');
    await page.waitForSelector('td:has-text("Shop rent")');
    assert.match(await page.locator('tr:has(td:has-text("Shop rent"))').innerText(), /1500\.00[\s\S]*1500\.00[\s\S]*paid/);
    await page.click('.top button:has-text("Accounting")');
    await page.waitForSelector('text=Profit and loss');
    const text = await page.locator('.page').innerText();
    assert.match(text, /6100 Rent\s+-1500\.00/);
    assert.match(text, /Provisional figures/);
    assert.match(text, /Trial balance\s+balanced/);
    assert.doesNotMatch(text, /NOT BALANCED/);
    if (shots) await page.screenshot({ path: join(shots, 'pos-accounting.png'), fullPage: true });
  });

  await step('owner: supplier invoice for the goods receipt, paid by bank; balance clears; VAT summary matches the ledger', async () => {
    await page.click('.top button:has-text("Purchases")');
    await page.locator('select[aria-label="supplier"]').selectOption({ label: 'Farm Co' });
    await page.locator('input[aria-label="grn GRN-000001"]').check();
    await page.fill('input[aria-label="supplier invoice no"]', 'FC-1001');
    await page.fill('input[aria-label="invoice net"]', '36.00');
    await page.fill('input[aria-label="invoice vat"]', '5.40');
    await page.locator('label:has-text("Input VAT is recoverable") input').uncheck(); // Farm Co has no VAT number
    await page.click('button:has-text("Save supplier invoice")');
    await page.waitForSelector('text=Supplier invoice saved as PI-000001');
    await page.click('button:has-text("Balances and payments")');
    await page.waitForSelector('td:has-text("Farm Co")');
    assert.match(await page.locator('tr:has(td:has-text("Farm Co"))').first().innerText(), /41\.40/);
    await page.locator('.card:has(h4:text("Pay a supplier")) select[aria-label="supplier"]').selectOption({ label: 'Farm Co' });
    await page.fill('input[aria-label="supplier pay amount"]', '41.40');
    await page.click('button:has-text("Record payment")');
    await page.waitForSelector('text=Payment recorded');
    assert.equal(await page.locator('tr:has(td:has-text("Farm Co"))').count(), 0); // nothing owed any more
    await page.click('.top button:has-text("Accounting")');
    await page.waitForSelector('text=VAT summary');
    assert.match(await page.locator('h3:has-text("VAT summary")').innerText(), /matches the VAT accounts/);
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

  await step('appearance: the dark choice is kept after the window reloads', async () => {
    await page.locator('select[aria-label="appearance"]').selectOption('dark');
    await page.reload();
    await page.waitForSelector('.top');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.locator('select[aria-label="appearance"]').inputValue(), 'dark');
    await page.locator('select[aria-label="appearance"]').selectOption('light');
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
