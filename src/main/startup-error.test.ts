import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startupMessage } from './startup-error';

const root = join(__dirname, '..', '..');

describe('startup failure message', () => {
  it('a database from a newer version asks for an update and says the data is safe', () => {
    const m = startupMessage(new Error('Database schema v99 is newer than this app (v17). Update the app.'), 'C:\\data');
    expect(m.title).toBe('Please update the app');
    expect(m.body).toContain('C:\\data');
    expect(m.body).toContain('Do not delete');
  });
  it('a damaged file points to restore, and an unknown fault still tells them what to do', () => {
    expect(startupMessage(new Error('SQLITE_CORRUPT: database disk image is malformed'), 'x').body).toMatch(/Restore/);
    expect(startupMessage('weird', 'x').title).toBe('The app could not start');
  });
});

describe('installer settings', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { build: { files: string[]; nsis: Record<string, unknown> } };
  it('uninstalling or updating never removes the store data', () => expect(pkg.build.nsis.deleteAppDataOnUninstall).toBe(false));
  it('installs per user, so the data folder is the same across updates', () => expect(pkg.build.nsis.perMachine).toBe(false));
  it('the demo shop and development files are left out', () => {
    expect(pkg.build.files).toContain('!dist/main/demo/**');
    expect(pkg.build.files.some((f) => /scripts|dashboard|\.env|src/.test(f.replace('!', '')) && !f.startsWith('!'))).toBe(false);
  });
  it('the database lives in the user data folder, apart from the program files', () => {
    const main = readFileSync(join(root, 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toContain("app.getPath('userData')");
    expect(main).toContain("join(dataDir, 'pos.db')");
  });
  it('the local-testing paths stay out of a packaged build', () => {
    const main = readFileSync(join(root, 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toContain('auditDir && !app.isPackaged');
  });
});
