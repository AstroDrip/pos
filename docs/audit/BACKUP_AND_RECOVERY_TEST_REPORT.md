# Backup and Recovery Test Report

Date: 2026-11-05. Local encrypted backup and restore: **built and tested**. Off-site (cloud) upload: **not built** (Phase 6). Until it exists, backups sit on the same disk as the database, and the UI tells staff to copy them to USB.

## Method (as built)

1. **Consistent snapshot:** `VACUUM INTO` a temp file. This is safe with WAL; the live file is never copied.
2. **Check the snapshot:** `integrity_check`, `foreign_key_check`, row counts of key tables, last invoice number, schema version.
3. **Encrypt:** AES-256-GCM with a random per-file key, wrapped by a master key. The manifest is authenticated as associated data.
4. **Write and re-read:** written to `.part`, renamed (atomic), then read back from disk and decrypted to verify. The job is marked `verified_local` only after that.
5. **Master key:** protected with Windows DPAPI. A 55-character recovery code with a checksum is shown once to the owner.
6. **When backups run:** at shift close, every 4 hours while the app is open, on demand (admin or supervisor), and before every schema migration (encrypted once a key exists).
7. **Retention:** the newest 30 local files.

## Tests run (all passed on 2026-11-05)

| Test | Evidence |
|---|---|
| Backup during use contains committed sales; file has no readable names or SQLite header | `phase1b.test.ts` |
| One flipped byte in the body or manifest → "damaged or altered", restore refuses and stages nothing | `phase1b.test.ts` |
| Wrong key → "different backup key" | `phase1b.test.ts` |
| Failed backup is recorded as failed and never shown as success | `phase1b.test.ts` |
| Retention prunes the oldest files | `phase1b.test.ts` |
| Restore to a "replacement computer" (fresh DB): decrypt with the recovery code → integrity check → row counts match the backup record → install (old DB moved aside, not deleted) → reopen → data present | `phase1b.test.ts` |
| Same flow through the real app UI, then restart; owner logs in and all 3 sales are there | `e2e/smoke.mjs` steps 20–21 |
| Restore over IPC on a fresh install with the recovery code; refused for anonymous users once users exist | `handlers.test.ts` |
| Encrypted pre-migration snapshot is restorable | `phase1b.test.ts` |
| Cashier cannot run a backup or restore | permission matrix |

## Not tested / not built

| Item | Status |
|---|---|
| Upload to cloud, checksum after upload, interrupted upload, expired credentials, download and restore from cloud | Not built (Phase 6; provider and region not chosen) |
| Disk full during backup | Not simulated. Code path: the write fails, the job is recorded as failed, the temp file is removed |
| Restoring a backup older than the last ZATCA-reported invoice | Must be designed with ZATCA (risk Z-3) |
| Restore on physically different hardware | Simulated with a separate data folder; a real second PC was not available |
| Customer credit, ZATCA records | Do not exist yet |

## What a backup contains

The whole database: products, prices, stock movements, sales, payments, journals, shifts, users (PIN hashes), audit log and backup history. It does **not** contain the backup key itself; that comes from the recovery code. ZATCA keys will be excluded by design.
