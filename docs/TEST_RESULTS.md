# Test Results

Only commands that were actually run are recorded here.

| Date | Commit / state | Command | Result |
|---|---|---|---|
| 2026-11-05 | `main` @ 20d68df (baseline) | `npx vitest run` | 11 files, **119 passed**, 0 failed |
| 2026-11-05 | `feature/owner-tools` after T2 | `npx vitest run` | 1 failed (300-sale stress test timed out at 6.2 s under load, 5 s limit; passed alone). Timeout raised to 30 s, assertions unchanged (commit 2406758) |
| 2026-11-05 | `feature/owner-tools` @ 85d9b06 | `npm run typecheck`, `npm run lint` | clean |
| 2026-11-05 | `feature/owner-tools` @ 85d9b06 | `npx vitest run` | 17 files, **171 passed**, 0 failed |
| 2026-11-05 | `feature/owner-tools` @ 85d9b06 | `npm run build && node e2e/smoke.mjs` (3 runs) | **27/27, 27/27, 27/27** |
| 2026-11-05 | `feature/owner-tools` @ 85d9b06 | `npm audit --omit=dev` | 0 vulnerabilities |

| 2026-11-06 | `feature/owner-tools` (purchasing) | `npx vitest run` | 18 files, **183 passed**, 0 failed |
| 2026-11-06 | `feature/owner-tools` (purchasing) | `npm run build && node e2e/smoke.mjs` | **28/28** |
| 2026-11-06 | `feature/owner-tools` (credit) | typecheck / lint / build | exit 0 / 0 / 0 |
| 2026-11-06 | `feature/owner-tools` (credit) | `npx vitest run` | 19 files, **200 passed**, 0 failed |
| 2026-11-06 | `feature/owner-tools` (credit) | `node e2e/smoke.mjs` | **29/29** |
| 2026-11-06 | red-green | refund offset disabled on purpose → credit test fails; restored → passes | confirmed |
| 2026-11-06 | `feature/owner-tools` (UI polish) | typecheck / lint / vitest / e2e | 0 / 0 / **200 passed** / **29/29** |
| 2026-11-06 | UI polish | `node scripts/ui-shots.mjs` before and after | 45 + 45 screenshots in `ui-shots/` (not committed) |
| 2026-11-08 | `feature/owner-tools` @ 2bfe211 (search/keys/help/alignment) | typecheck / lint / `npm test` / build | 0 / 0 / 28 files **261 passed** / 0 |
| 2026-11-08 | same | `npm run ui-audit -- ui-audit/after` (Electron-native, no Playwright) | 58 screens, 0 geometry findings, 8/8 key flows ok |
| 2026-11-08 | same | `node scripts/search-bench.cjs 1000,10000,100000` | 100k products p95: 1 letter 1.8–2.4 ms, 2–3 letters 5–7 ms |
| 2026-11-08 | same | `npm run e2e` | **not run** (Playwright forbidden for this task) |
| 2026-11-08 | `feature/owner-tools` @ 6d2adc0 (after code-review fixes) | typecheck / lint / `npm test` / build | 0 / 0 / 28 files **270 passed** / 0 |
| 2026-11-08 | same | `node scripts/ui-audit.mjs ui-audit/final` | 44 screens (English only, owner: Arabic later), 0 findings, 11/11 key flows ok |

Earlier during T2–T4 the e2e scanner step failed twice on the first run straight after a build. Playwright's 5 ms "scanner"
keystrokes arrived slower than the 35 ms burst limit while the app was still warming up. It passed on every later run,
including first runs after the last builds. It is a test-timing effect, but watch for it on the store PC with the real scanner.

Simulated, not real: the owner dashboard tests use a fake in-memory server. Scale-label tests use synthetic layouts.
Not re-run in this round: `e2e/installer.mjs`, `e2e/packaged.mjs`.

Visual check by eye: dark-mode Sell screen and light-mode Accounting screen screenshots from the e2e run (readable
text, dark cards, visible focus outline).

## Master Prompt A (2026-11-09)
- `npm test`: 651 passed. `npm run typecheck` and `npm run lint`: clean.
- `npm run ui-audit` (Electron itself, temporary data): 54 screens, 0 findings, 101 of 101 flows.
- `npm run ui-audit -- <dir> --demo`: 25 screens, 0 findings, 24 of 24 flows.
- Not run: `npm run e2e`, Playwright. Not tried: real scanner, real Arabic keyboard, true process restart (a full screen reload was used).

## Redesign and interactive data (2026-11-10)
- POS `npm test`: 774 passed. Dashboard `npm test`: 72 passed. Typecheck and lint clean.
- `npm run ui-audit` (Electron itself): 54 screens, 0 findings, 111 of 111 flows, including chart hover, click, close, date strip wheel and date choice.
- `npm run ui-audit -- <dir> --demo`: 60 screens, 0 findings, 59 of 59 flows.
- Chart touch on the phone dashboard: tried with simulated touch events in the built-in browser at 375 px.
- Not tried: real touch hardware, a real scanner on the new Stock box, Arabic. Not run: `npm run e2e`, Playwright.

## Cloud phase (2026-11-09)
- POS `npm test`: 749 passed. Dashboard `npm test`: 67 passed. Typecheck and lint clean. Dashboard production build passed.
- `npm run ui-audit`: 54 screens, 0 findings, 101 of 101 flows. Short run with the new screens: 15 of 15.
- `scripts/cloud-e2e-local.cjs` against a local database: passed.
- Installer on this PC, temporary folders: install, update and uninstall passed, data kept.
- Not tried: real Neon or Vercel, real hardware, clean Windows, Arabic. Not run: `npm run e2e`, Playwright.

## Manual and hardware tests
None on store hardware so far. The receipt printer, scanner, scale labels and cash drawer have not been tested; their models are unknown.

## Known limitations
See `docs/IMPLEMENTATION_STATUS.md` and the blockers column in `docs/IMPLEMENTATION_TASK_LEDGER.md`.
