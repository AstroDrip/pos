// Installer round trip on THIS machine (per-user, no admin): silent install → launch the installed app
// (temporary data folder) → silent uninstall → check program files and shortcut are gone and the data folder stays.
// Usage: npm run dist && node e2e/installer.mjs
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const setup = resolve('release', readdirSync('release').find((f) => /^Store POS Setup .*\.exe$/.test(f)));
const installDir = join(process.env.LOCALAPPDATA, 'Programs', 'Store POS');
const exe = join(installDir, 'Store POS.exe');
const shortcut = join(homedir(), 'Desktop', 'Store POS.lnk');
const data = mkdtempSync(join(tmpdir(), 'pos-inst-'));
const log = (s) => console.log(s);
async function waitFor(cond, what, ms = 180_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
assert.ok(!existsSync(installDir), `Already installed at ${installDir}; not touching an existing install`);

try {
  execFileSync(setup, ['/S'], { stdio: 'inherit' });
  // The NSIS setup can hand off to a child process and return early: wait for the files.
  await waitFor(() => existsSync(exe) && existsSync(join(installDir, 'Uninstall Store POS.exe')), 'installed exe');
  await new Promise((r) => setTimeout(r, 3000)); // let the installer finish writing shortcuts
  log(`PASS  silent install → ${installDir} (desktop shortcut: ${existsSync(shortcut)})`);

  const app = await electron.launch({ executablePath: exe, env: { ...process.env, POS_USER_DATA: data } });
  const page = await app.firstWindow();
  await page.waitForSelector('text=First-time setup');
  const f = page.locator('form input');
  await f.nth(0).fill('owner');
  await f.nth(1).fill('Owner');
  await f.nth(2).fill('4321');
  await page.click('text=Create owner');
  await page.waitForSelector('text=Open shift');
  await app.close();
  log('PASS  installed app starts, creates its database and logs in');
} finally {
  const uninstaller = join(installDir, 'Uninstall Store POS.exe');
  if (existsSync(uninstaller)) {
    execFileSync(uninstaller, ['/S'], { stdio: 'inherit' });
    // The uninstaller also finishes in a child process: wait for the files to go.
    await waitFor(() => !existsSync(exe) && !existsSync(shortcut), 'uninstall to finish', 120_000).catch(() => {});
  }
}
assert.ok(!existsSync(exe), 'program files still present after uninstall');
assert.ok(!existsSync(shortcut), 'desktop shortcut still present after uninstall');
assert.ok(existsSync(join(data, 'pos.db')), 'store data must survive uninstall');
log('PASS  silent uninstall removes program and shortcut; store data folder is kept');
rmSync(data, { recursive: true, force: true });
