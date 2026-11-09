# Completion report: accounting fixes, cloud backup, phone dashboard

**Date:** 2026-11-09. **Branch:** `feature/owner-tools`. Commits are local. Nothing was pushed or deployed.

Status words: **Tested** = implemented and passed real tests. **Partial** = some of it is done, as stated. **Your setup** = needs your accounts or settings. **Hardware** = needs real devices. **Deferred** = left out on purpose.

## 1. What was built

| Item | Status | Notes |
|---|---|---|
| Proforma VAT review | Tested | Purchases → Proforma VAT |
| Prepaid recognised only on confirmation | Tested | Expenses → Recognise prepaid expenses |
| Reports no longer post entries | Tested | P&L, balance sheet, VAT summary, owner figures |
| Three new books checks; no records vs zero | Tested | Now 22 checks |
| Encrypted, compressed backups in pieces | Tested | File format 2. Older files still open |
| Resume, retry, no duplicate pieces, retention | Tested | Stand-in cloud, real server tests, local end-to-end |
| Full verification and protected restore | Tested | Includes a replacement computer with the recovery code |
| Cloud Backup & Recovery screen | Tested | Opens in the real app. Not yet used with a real cloud |
| Till-to-cloud sync | Tested | Real services, HTTP routes and Neon driver, against a local database |
| Next.js dashboard, 7 screens plus login | Tested | Checked at 360, 430, 768 and 1280 px, plus 390 px on two screens |
| Dark and light themes | Tested | |
| Demo mode with made-up shop | Tested | Built by the real POS services |
| Deployment to Neon and Vercel | Your setup | Prepared, never run. No deployed address exists |
| Hardware test screen | Hardware | The screen and its logic are tested. No real device has been used |
| Installer, update, uninstall | Partial | Passed on this PC in a temporary folder. Not on a clean Windows PC |
| Help guides and field help | Tested | 7 new guides, 6 new field entries. English only |
| Arabic: dashboard, RTL, Help, keyboard, receipts | Deferred | Owner's rule: no Arabic checks. New desktop labels have an unchecked Arabic string only because a repo test requires one |
| Cash drawer open command | Deferred | None exists and no model is known. Figures-only screen instead |

## 2. Main files

- **Accounting:** `src/services/vat-review.ts`, `expenses.ts`, `financials.ts`, `vat-report.ts`, `integrity.ts`, `src/renderer/VatReview.tsx`, `Expenses.tsx`.
- **Cloud on the till:** `src/services/cloud-backup.ts`, `cloud-client.ts`, `cloud-jobs.ts`, `dashboard-sync.ts`, `backup-crypto.ts`, `src/main/main.ts`, `handlers.ts`, `src/renderer/CloudBackup.tsx`.
- **Hardware:** `src/services/hardware.ts`, `src/renderer/HardwareTest.tsx`, `src/main/receipt-html.ts`.
- **Reliability:** `src/main/startup-error.ts`.
- **Dashboard:** everything in `dashboard/`. Scripts: `scripts/export-demo-snapshots.cjs`, `scripts/cloud-e2e-local.cjs`.

## 3. Database changes

**Till migrations:** 015 `supplier_vat_reviews`, `_events`, `_attachments`, `_claims`, permissions `vat.review` and `vat.approve` (admin only). 016 `prepaid_runs`. 017 `cloud_uploads`, backup frequency setting.

**Neon:** schemas `dash_auth`, `cloud`, `backup`, `sync`, `readmodel`, `demo`. Roles `dashboard_app`, `dashboard_demo`, `device_api`.

## 4–6. How it works

See [CLOUD_BACKUP_AND_SYNC.md](CLOUD_BACKUP_AND_SYNC.md), [HARDWARE_TESTING.md](HARDWARE_TESTING.md) and [METRICS.md](../dashboard/METRICS.md).

## 7–8. Deployment and settings

Steps are in [DEPLOY.md](../dashboard/DEPLOY.md). Vercel Root Directory is `dashboard`.

| Where | Name |
|---|---|
| Vercel, for the demo | `DASHBOARD_DEMO_MODE`, `DASHBOARD_DEMO_DATABASE_URL` |
| Vercel, for the real store | `DASHBOARD_DATABASE_URL`, `DEVICE_API_DATABASE_URL` |
| This computer only | `DATABASE_URL_UNPOOLED`, `DASHBOARD_APP_PASSWORD`, `DASHBOARD_DEMO_PASSWORD`, `DEVICE_API_PASSWORD`, `DEMO_ADMIN_PASSWORD`, `OWNER_USERNAME`, `OWNER_PASSWORD`, `STORE_ID` |

## 9. Demo login

Username `demo`. The password is the test value you put in `DEMO_ADMIN_PASSWORD` before running `npm run demo:seed`. None is built in.

## 10. Tests actually run

| Run | Result |
|---|---|
| POS unit and integration (`npm test`) | 749 of 749 on the final code. See limits for one intermittent timeout |
| Dashboard (`npm test` in `dashboard/`) | 67 of 67, including the scan of built browser files |
| Typecheck and lint, both projects where they apply | Clean |
| Dashboard production build | Passed |
| Real-app audit (Electron, temporary data) | 54 screens, 0 findings, 101 of 101 flows |
| Short real-app run with the new screens | 15 of 15 flows, including 4 new ones |
| Local end-to-end (`scripts/cloud-e2e-local.cjs`) | Passed: enrol, code refused twice, sync, upload, full verify, restore on a "new computer", old device cut off |
| Installer on this PC, temporary folders | Passed twice: install, start, update keeps data, uninstall keeps data, no demo or test files packaged |
| Phone layout by hand in the built-in browser | No sideways scroll, nothing cut off, tap targets at least 44 px |

Not used: Playwright, Puppeteer, `npm run e2e`.

## 11. Tests that need real devices

Listed in [HARDWARE_TESTING.md](HARDWARE_TESTING.md): scanner, real scale label, receipt printer, cash drawer, clean Windows install, and Arabic when you take that up.

## 12. Known limits

- Neon and Vercel have not been used for real. The local test stands in for Neon's HTTP service.
- Local backups run on the app's main process. On a very large database the till may pause briefly while one is made. This is not caused by the internet.
- Purchase returns are not linked to a specific invoice, so a return after a proforma gives a warning rather than an automatic VAT limit.
- Figures by category and by product are before returns. The totals are after returns.
- Retention is 7 daily and 4 weekly. It can only be changed in the database for now.
- There is no automatic updater: an update means running a new installer. The installer is not code-signed, so Windows may show a warning.
- A failed update was not simulated in the installed app. It relies on the backup made before migration, which has tests, and a new plain error message.
- `search stays quick with 20,000 products` timed out once in several whole-suite runs on this busy PC, and passes otherwise. Slow database tests were given 20 s instead of 5 s. No test was removed or weakened.
- Prepaid expenses that are due stay out of the reports until someone confirms the month. Reports warn when this applies.
- No independent reviewer read this code. It had the author's own check only.

## 13–15. Confirmations

- **ZATCA Phase 2 was not implemented.** The ZATCA code was not changed. The test receipt says TEST - NOT A SALE.
- **Accountant approval remains pending.** All accounting stays provisional. The app records an accountant's decision and does not make it.
- **No store migration was performed.** No real product, customer, supplier or opening balance was imported.
