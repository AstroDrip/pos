# Security and Fraud Audit

Date: 2026-11-05.

## 1. Roles and permissions (enforced in the backend, not just hidden buttons)

| Permission | Cashier | Supervisor | Admin |
|---|:-:|:-:|:-:|
| sale.create, shift.open, shift.close, customer.manage | ✓ | ✓ | ✓ |
| sale.discount (approve discounts) | — | ✓ | ✓ |
| cash.move, drawer.open, product.manage, stock.receive, stock.adjust, supplier.manage, reports.view, backup.run | — | ✓ | ✓ |
| user.manage, settings.manage, backup.restore | — | — | ✓ |

- The prompt suggests a separate **Manager** role. Today, Supervisor covers manager duties. Splitting it is a small change, but it is a policy decision (who may change prices vs. who may approve discounts).
- **Test:** a logged-in cashier calling 22 manager/admin operations directly over IPC (bypassing the UI) is refused on every one (`handlers.test.ts`).
- Every payload is schema-validated. Unknown channels are rejected in both preload and main.
- The login identity lives in the main process; the renderer cannot claim to be someone else.

## 2. Receipt and record immutability

| Attempt | Result | Evidence |
|---|---|---|
| Edit or delete a finalised sale, line, payment, stock movement, journal line, audit row or closed shift through the app or with SQL `UPDATE`/`DELETE` | **Blocked** by triggers | `services.test.ts` |
| Change a price after sale, then reprint | Reprint reads the stored snapshot; shows the original price; marked COPY; audited | `services.test.ts`, `handlers.test.ts` |
| Insert a forged audit row | Hash chain breaks; red banner for supervisors and owner | BUG-010 test |
| Remove a sale from the daily report | Impossible without breaking triggers; reports read the sales table directly | — |
| Same invoice number twice | `UNIQUE(invoice_no)`; counter in the same transaction | tests |

**Residual risk R-1.** Someone with Windows access to the data folder and a SQLite tool can drop the triggers and edit `pos.db`. Mitigations in place:
- the audit chain detects audit-log edits;
- backups preserve history.

Recommended (not implemented):
1. a separate Windows account for cashiers without access to the app data folder;
2. BitLocker / device encryption;
3. the ZATCA invoice hash chain (PIH), which makes edited sales detectable against reported invoices;
4. extending the hash chain to sales rows. This is a design change, so I'm asking first.

## 3. Cashier fraud scenarios

| Scenario | How the system responds | Detection |
|---|---|---|
| Records lower payment / keeps change | Expected cash computed from recorded sales; shift close shows over/short, posted to 6000 | Cashier activity: over/short per closing cashier |
| Fake discount | Needs a supervisor PIN; approver stored on the sale | Discounts count and value per cashier |
| Removes items before payment and pockets cash | Allowed (decision Q-10), always audited with bill and invoice no. | "Items removed before payment" report; removals per cashier |
| Removes an item **after** payment, voids a sale | Impossible (immutable) | — |
| Scans a cheaper product instead | Not detectable by software alone; the product name prints on the receipt for the customer | CCTV / spot checks |
| Fake refund, credit to self | No refunds exist yet. The design (financial audit §4) requires a link to the original sale, refundable qty and approval | — |
| Excessive reprints | Audited | Reprints per cashier |
| Drawer opened without a sale | No drawer command yet; it will be audited when built | — |
| Uses another user's login / shares PIN | Not preventable by software; PIN lockout; idle auto-lock not implemented (F-AUTH-1) | User activity in the audit log |
| Edits the shift closing amount | Closed shift is immutable | — |
| Deactivated employee logs in | Refused | test |
| Tries to alter the audit log | Update/delete blocked; insert detected | tests |

Reports present **facts for review, not accusations**; the cashier report says this on screen.

## 4. Application security review

| Area | Finding |
|---|---|
| Electron | contextIsolation on, nodeIntegration off, sandbox on, CSP `default-src 'none'`, navigation and new windows blocked, permissions denied, single instance per data folder. Verified in E2E. |
| SQL injection | All queries are parameterised. The only interpolated identifiers are code constants. FTS input is quoted per word (test sends `"`, `*`, `NEAR(`, `; DROP TABLE`). |
| Passwords | PINs hashed with scrypt + per-user salt; constant-time compare; 5 failures → 5-minute lock. 4-digit PINs are weak against a patient insider (about 7 days of guessing with lockout); recommend 6 digits for supervisors and admin. |
| Secrets | Backup key stored with Windows DPAPI (`safeStorage`); recovery code shown once; nothing in source, logs or renderer. There are no ZATCA keys yet. |
| Backups | AES-256-GCM, manifest authenticated, verified after writing; restore checks integrity and row counts. |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities (2026-11-05). 14 moderate in build-only tools (electron-builder/eslint `minimatch`), not shipped. |
| Local storage | Only the UI language is stored in the browser; changing it has no security effect. |
| Receipt template | Compiled into the app; not a file the user can swap (the installed app is in an asar archive; unsigned, see the readiness report). |
