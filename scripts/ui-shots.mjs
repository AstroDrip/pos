// Visual QA: seeds a temporary data folder with realistic FAKE data, opens the real app and screenshots every
// screen in light/dark, English/Arabic and two window sizes. Never touches the store's database.
// Usage: npm run build && node scripts/ui-shots.mjs <outDir>
import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed } from './ui-seed.mjs';

const root = join(import.meta.dirname, '..');
const out = process.argv[2] ?? join(root, 'ui-shots', 'latest');
mkdirSync(out, { recursive: true });

const dir = mkdtempSync(join(tmpdir(), 'pos-ui-'));
seed(join(dir, 'pos.db'));

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
