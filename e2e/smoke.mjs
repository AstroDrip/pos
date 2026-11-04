// End-to-end smoke test of the packaged-layout app (run `npm run build` first).
// Usage: node e2e/smoke.mjs [screenshotDir]
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const shots = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'pos-e2e-'));
const receipt = join(dir, 'receipt.html');
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
    await page.locator('.side input').nth(1).fill('10');
    await page.click('button:has-text("Cash")');
    await page.waitForSelector('text=SAVED INV-00000001');
    assert.match(await page.locator('.msg').innerText(), /Change: 5\.00/);
    const html = readFileSync(receipt, 'utf8');
    assert.match(html, /INV-00000001/);
    assert.match(html, /ماء/);
  });

  if (shots) await page.screenshot({ path: join(shots, 'pos-after-sale.png') });

  await step('shift shows expected cash and closes', async () => {
    await page.click('button:has-text("Shift")');
    await page.waitForSelector('text=Expected cash in drawer');
    assert.match(await page.locator('table').innerText(), /105\.00/);
    page.once('dialog', (d) => d.accept());
    await page.locator('.card input').last().fill('105');
    await page.click('button:has-text("Close shift")');
    await page.waitForSelector('text=No open shift');
  });
  // Last: Playwright keeps waiting on a cancelled navigation.
  await step('navigation away is blocked', async () => {
    await page.evaluate(() => { window.location.href = 'https://example.com'; });
    await page.waitForTimeout(500);
    assert.match(page.url(), /^file:/);
  });

} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  for (const r of results) console.log(r.join('  '));
  console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} steps passed`);
}
