# Cloud backup, sync and dashboard

The till works offline on its own SQLite file. The cloud only ever receives copies.

```
Windows till (SQLite: the only source of truth)
  ├─ encrypted backup file ──▶ /api/device/backup/* ──▶ schema backup    (the server cannot read it)
  └─ daily figures ─────────▶ /api/device/sync ──────▶ schema readmodel ──▶ phone dashboard (read only)

Demo: real POS services ▶ seed/demo-snapshots.json ▶ schema demo ▶ phone dashboard, using its own role
```

## Backup

**Encryption.** A verified local backup is gzipped, then sealed with AES-256-GCM using a random key for that file. That key is wrapped by the master backup key. The manifest is bound to the ciphertext, so changing either is detected. File format 2 is new. Format 1 files can still be read.

**Keys.** The master key is held by Windows secure storage. The owner holds it on paper as the recovery code. Neither is sent anywhere. Cloud login for a replacement computer uses a one-way token derived from the key with HKDF. The server stores only the SHA-256 of that token.

> If the recovery code and the computer are both lost, the backups cannot be opened by anyone.

**Upload.** Files go in 2 MiB pieces, because Vercel limits a request to 4.5 MB. Each piece has its own SHA-256. The server tells the till what it already holds, so a dropped connection or restart only sends the rest. A retry of a stored piece does nothing. The queue is a table (`cloud_uploads`) that survives restarts. Failures wait 1 minute, doubling to 1 hour.

**Checks.** The server checks each piece and the list of piece hashes. It cannot check inside the file. Once a week, or when someone presses Test newest backup, the till downloads the newest copy, decrypts it into a temporary file and runs SQLite's integrity check.

**Retention.** The newest verified backup is always kept, plus the newest of each of the last 7 days and of each of the last 4 weeks. Backups not yet verified are left alone. Unfinished ones are removed after 2 days.

## Restore

The steps run in this order:

1. Authorised user: `backup.restore`, or the recovery code on an empty install.
2. Download the chosen backup.
3. Compare the manifest with the server's record.
4. Check every piece, then the whole file.
5. Decrypt on this computer.
6. Run SQLite integrity and foreign key checks.
7. Refuse a backup from a newer app version.
8. Compare table counts with the manifest.
9. Keep it in a temporary file.
10. Make a safety backup, and move the current database aside.
11. Show the backup's date, last invoice and counts.
12. Ask for confirmation. If this computer has newer sales, a separate tick is required.

### Moving to another Windows computer

You need the cloud address, the store identity and the paper recovery code.

1. Install the app. Do not create an owner.
2. Under **Restore from the cloud**, enter the three values and press **Find backups**.
3. Check the newest backup, read its date, restore it. The app restarts.

The old computer's device credential is cut off unless you untick that box. Sales made after the backup are not in it.

## Sync

The outbox is written in the same SQLite file as the sales, so nothing is lost if the network fails. Each snapshot has an event id and a version. The server applies each event id once, and keeps the highest version per record, so a late retry cannot overwrite newer figures. Versions include the clock, so figures still outrank what the cloud holds after a restore from an older backup. The store always comes from the device credential, never the request.

Sent: daily totals, position, stock, customer and supplier names with balances, the open shift. Not sent: phone numbers, VAT numbers, individual sales, the database.

A round runs every 5 minutes on the main process, never in the checkout path. It skips the work when nothing has changed.

## Security summary

| Item | How |
|---|---|
| Database access | Three roles with least privilege. Row-level security keeps demo and real logins apart |
| Browser | Server components only. Client code imports nothing from the server. A test scans the built files for connection details |
| Writes from the phone | None. Only login and logout are server actions. Routes exist only for health and the till |
| Passwords | scrypt. Sessions are random, stored as a hash, 12 hours, revocable |
| Cookies | HttpOnly, SameSite=Lax, `__Host-` and Secure in production |
| Limits | 5 failures per login locks for 15 minutes. Limits on enrolment and recovery |
| Device credential | Windows secure storage, outside the database, so never in a backup |

## Accounting workflow changes

**Prepaid.** Reports no longer post anything. `recognizePrepaidMonth` is the only way to post, after a preview. It runs in one transaction, refuses if the figures moved after the preview, and cannot post a month twice. Reports show what is waiting. Posting a prepaid expense puts it all in 1300 until then. This means a period's expenses can look lower until someone confirms the month.

**Proforma VAT.** New tables link the final tax invoice to the proforma. Document, payment and VAT status are separate. A claim is its own entry, Dr 2210 / Cr 5010, dated on the claim day, in the VAT period of the claim. The original purchase is never changed. Only VAT the accountant approved, up to the lower of the VAT booked and the VAT on the final invoice, can be claimed. Differences are shown and never adjusted automatically.

**Books check.** Three new checks: VAT claims against the ledger, account 1300 against prepaid expenses, and expense categories against account types.

All of this stays provisional until the accountant approves it.
