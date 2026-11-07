// Regenerates docs/user-guide/POS_USER_MANUAL.md from the Help Centre content (src/renderer/help/content.ts).
// Runs the manual test with WRITE_MANUAL=1, so the TypeScript content is read the same way the test reads it.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const r = spawnSync('npx', ['vitest', 'run', 'src/renderer/help/manual.test.ts'], { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, WRITE_MANUAL: '1' } });
process.exit(r.status ?? 1);
