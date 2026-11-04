// Smoke test of the PACKAGED app (run `npm run dist` first): native SQLite loads from the asar bundle,
// first-run setup writes to the database, and the app restarts with the data intact.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const exe = join('release', 'win-unpacked', 'Store POS.exe');
const dir = mkdtempSync(join(tmpdir(), 'pos-pkg-'));
const env = { ...process.env, POS_USER_DATA: dir, POS_RECEIPT_TO_FILE: join(dir, 'r.html') };
try {
  let app = await electron.launch({ executablePath: exe, env });
  let page = await app.firstWindow();
  await page.waitForSelector('text=First-time setup');
  const f = page.locator('form input');
  await f.nth(0).fill('owner');
  await f.nth(1).fill('Owner');
  await f.nth(2).fill('4321');
  await page.click('text=Create owner');
  await page.waitForSelector('text=Open shift');
  await app.close();

  app = await electron.launch({ executablePath: exe, env });
  page = await app.firstWindow();
  await page.waitForSelector('text=Log in');
  const s = await page.evaluate(() => window.pos.invoke('auth.status', null));
  assert.equal(s.data.needsSetup, false);
  await app.close();
  console.log('PASS  packaged app: native SQLite works and data persists across restart');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
