# Security and test plan

Status: approved 2026-11-10 with defaults. Checked in Phase G on 2026-11-13, see `READINESS_REPORT.md`.

## 1. Main security risks

| Risk | Control |
|---|---|
| Reading another customer's order | Random reference, secret token stored as a hash, same answer for wrong and unknown |
| Staff action beyond their role | Permission checked on the server for every call, never by hiding a button |
| Faked payment | Verified webhook or server check only. Amount and currency compared. Browser redirect is never proof |
| Changed prices in the browser | Server calculates everything. Client totals are ignored |
| Malicious upload | Section 3 |
| Database secrets exposed | Server-only variables, none with a `NEXT_PUBLIC_` prefix |
| Cost data leak | Cost is never sent by the POS sender. A test checks the payload |
| Stolen POS device key | Hashed on the server, separate from the dashboard key, can be revoked |
| Forged sync events | Device credential sets the store. The body cannot name a store |
| Brute force | Rate limits on login, order lookup, checkout |
| Order spam holding stock | Rate limit per phone and IP, cap on open unpaid orders, short expiry |
| Cross-site attacks | SameSite cookies, CSRF check on admin changes, output encoding, content security policy |
| Personal data | Only needed fields collected. Admin views audited. Retention period to be agreed |

Standards: [OWASP ASVS](https://asvs.owasp.org/), [Authentication cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [File upload cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

The no-password path in `dashboard/` is a demo convenience. It must never exist in `store/`. Staff login has hashed passwords, secure sessions and server expiry.

## 2. Permissions

Web permissions live in Postgres and use the same style as POS codes. POS and web are separate boundaries with separate accounts.

| Permission | Web | POS | Default role |
|---|---|---|---|
| `orders.view` | Yes | | Cashier and up |
| `orders.accept`, `orders.reject` | Yes | | Supervisor and up |
| `orders.fulfil` | Yes | | Cashier and up |
| `orders.handover` | | Yes | Cashier and up |
| `products.edit`, `products.publish` | Yes | | Supervisor and up |
| `product.manage` (existing) | | Yes | Unchanged |
| `stock.view` | Yes | | Cashier and up |
| `stock.override` | Yes | | Admin |
| `payments.view` | Yes | | Supervisor and up |
| `refunds.approve` | Yes | | Supervisor and up |
| `sale.refund` (existing) | | Yes | Unchanged |
| `delivery.manage` | Yes | | Supervisor and up |
| `settings.manage` | Yes | Existing | Admin |

Handover in the POS uses `finalizeSale`, so its existing `sale.create` and shift rules still apply.

## 3. Image upload

Vercel limits request bodies to 4.5 MB, so files go straight to R2.

1. Staff with `products.edit` asks for a short-lived upload URL for a `quarantine/` path, with a size limit (8 MB).
2. Browser uploads directly.
3. Server reads the file, checks the real type from its bytes (JPEG, PNG, WebP only), and limits pixel size.
4. `sharp` re-encodes it, strips metadata and makes 400, 800 and 1200 px WebP files.
5. Saved under a random name in the public path. Quarantine copy deleted.
6. Only metadata goes in Postgres.

File extensions are never trusted. Nothing uploaded can execute. SVG is refused.

## 4. Testing approach

- Unit and integration tests with vitest and PGlite, as in `dashboard/`.
- POS tests with existing vitest and real SQLite.
- **Concurrency tests need a real PostgreSQL.** PGlite runs one connection at a time, so it cannot prove row locks. These run on a disposable Neon branch or local PostgreSQL, with fictional data only.
- Payments use the provider's test mode. Apple Pay and STC Pay may not work with test keys, so those need separate live verification.
- Interactive and layout checks use the built-in browser.
- Playwright and Puppeteer are not used. Existing `e2e/` files are left in place and not run.
- No production database, no real customer data, no real store details.

## 5. Customer, free delivery and order tests

**Customer website:** homepage loads; categories from catalogue; search; product detail; correct prices; unpublished hidden; archived not orderable; out-of-stock handled; cart controls; server-verified totals; delivery and pickup; validation; one order only; retries create no duplicates; tracking after refresh.

**Free delivery:**

| Eligible subtotal | Result |
|---|---|
| SAR 0.00 | Charge applies |
| SAR 49.00 | Charge applies |
| SAR 50.00 | Charge applies |
| SAR 50.01 | Free |
| SAR 60.00 | Free |

Also: pickup has no charge; removing products changes eligibility; a discount changes it by the approved rule; VAT consistent; server and screen agree; tampering has no effect.

**Order lifecycle:** received, accepted, rejected, preparing, ready, out for delivery, completed, cancelled, expired; payment pending, successful, failed, refund; every invalid transition is refused; every permission violation is refused.

**Payments:** forged webhook refused; repeated webhook harmless; wrong amount held; late webhook cannot go backwards; capture failure leaves order unaccepted.

## 6. Inventory, admin, reporting and POS tests

**Inventory:**

| # | Case |
|---|---|
| 1 | Product available |
| 2 | Product unavailable |
| 3 | Many customers buying the last unit, real concurrency |
| 4 | POS sale while a reservation exists, the 5, 3, 2 case |
| 5 | Reservation while POS is selling |
| 6 | Reservation expiry |
| 7 | Cancellation |
| 8 | Rejection |
| 9 | Refund with restock |
| 10 | Sync failure, stale limit reached |
| 11 | Duplicate sync event |
| 12 | Recovery after outage, events in order |
| 13 | Reconciliation with a planted difference |
| 14 | Out of order events |
| 15 | Backup restore, epoch raised |
| 16 | Handover repeated |

Each checks there is no duplicate stock movement and no unflagged negative balance.

**Admin:** correct customer, location and fulfilment type; correct availability; accept and reject permissions; image upload including bad files; publish, unpublish, archive; search and filters; audit history; responsive order detail.

**Reporting:** online appears in the right reports; shop sales unchanged; no double count; movements reconcile; refunds correct; payment totals reconcile; financials consistent; existing reports do not regress.

**POS protection:**
- Full POS suite still passes.
- Triggers do nothing when `commerce_enabled` is 0.
- Migrations pass `phase1b` rollback checks.
- `integrity.ts` stays clean with online sales.
- Installer still builds, and `store/` packages do not reach it.
- Real-app `npm run ui-audit` still passes.

## 7. Not testable from here

Real provider live payments, real Neon and Vercel load, real phones and networks, ZATCA submission, and Arabic. Each will be reported as not tested until it is.

Passing tests or a successful compile will not be reported as success on their own.
