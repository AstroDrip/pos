// Development-only UI audit without browser-automation frameworks.
// Seeds a TEMPORARY data folder with fake data, starts the real Electron app in audit mode (POS_UI_AUDIT),
// and waits for it to write screenshots, geometry findings and key-flow results.
// Usage: npm run ui-audit -- <outDir> [--demo]     (--demo opens every tab of the demo shop instead)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seed } from './ui-seed.mjs';

const root = join(import.meta.dirname, '..');
const demo = process.argv.includes('--demo');
const out = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(root, 'ui-audit', 'latest'));
const dir = mkdtempSync(join(tmpdir(), 'pos-audit-'));
if (demo) {
  const require = createRequire(import.meta.url);
  const dist = (p) => require(join(root, 'dist', 'main', p));
  const ctx = dist('services/context.js').makeCtx(dist('db/connection.js').openDatabase(join(dir, 'pos.db')));
  dist('demo/seed.js').seedDemoShop(ctx, new Date().toISOString());
  ctx.db.pragma('wal_checkpoint(TRUNCATE)');
  ctx.db.close();
} else seed(join(dir, 'pos.db'));

const electronBin = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const child = spawn(electronBin, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, POS_USER_DATA: dir, POS_RECEIPT_TO_FILE: join(dir, 'r.html'), POS_UI_AUDIT: out, POS_UI_AUDIT_LOGIN: 'owner:4321', POS_NO_RELAUNCH: '1', ...(demo ? { POS_UI_AUDIT_DEMO: '1' } : {}) },
});
const timer = setTimeout(() => { console.error('ui-audit: timed out after 10 minutes'); child.kill(); }, 600_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  rmSync(dir, { recursive: true, force: true });
  const sum = join(out, 'summary.json');
  if (!existsSync(sum)) { console.error(`ui-audit: no summary written (exit ${code})`); process.exit(1); }
  const s = JSON.parse(readFileSync(sum, 'utf8'));
  const high = s.screens.reduce((a, x) => a + x.high, 0);
  const all = s.screens.reduce((a, x) => a + x.findings, 0);
  console.log(`ui-audit: ${s.screens.length} screens, ${all} findings (${high} high) in ${out}`);
  for (const f of s.flows) console.log(`  flow ${f.flow}: ${f.ok ? 'ok' : 'FAIL'} (${f.detail})`);
  for (const e of s.errors) console.log(`  error: ${e}`);
  process.exit(s.errors.length ? 1 : 0);
});
