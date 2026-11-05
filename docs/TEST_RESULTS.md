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

Earlier during T2–T4 the e2e scanner step failed twice on the first run straight after a build. Playwright's 5 ms "scanner"
keystrokes arrived slower than the 35 ms burst limit while the app was still warming up. It passed on every later run,
including first runs after the last builds. It is a test-timing effect, but watch for it on the store PC with the real scanner.

Simulated, not real: the owner dashboard tests use a fake in-memory server. Scale-label tests use synthetic layouts.
Not re-run in this round: `e2e/installer.mjs`, `e2e/packaged.mjs`.

Visual check by eye: dark-mode Sell screen and light-mode Accounting screen screenshots from the e2e run (readable
text, dark cards, visible focus outline).

## Manual and hardware tests
None on store hardware so far. The receipt printer, scanner, scale labels and cash drawer have not been tested; their models are unknown.

## Known limitations
See `docs/IMPLEMENTATION_STATUS.md` and the blockers column in `docs/IMPLEMENTATION_TASK_LEDGER.md`.
