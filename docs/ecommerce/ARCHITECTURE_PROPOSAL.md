# Architecture proposal

Status: proposal, waiting for approval. Written 2026-11-10.

## 1. Four separate things

| Concern | Where | Rule |
|---|---|---|
| Read-only owner reporting | `dashboard/` and `dashboard-sync.ts` | Stays as it is |
| Customer shop | New `store/` app, public routes | No staff data, no cost prices |
| Online order administration | Same `store/` app, `/admin` routes | Same backend as the shop |
| Catalogue and stock sync | New `commerce-sync` in the POS, device API in `store/` | New boundary, separate from dashboard sync |

## 2. Data flow

```
Customer phone ──> store/ public routes ─┐
                                         ├─> one backend ──> PostgreSQL (Neon)
Staff browser ───> store/ admin routes ──┘        │  ▲
                                                  │  └── signed webhooks ── payment provider
                                  image files ────┘
                                  (Cloudflare R2)
                                                  ▲
POS (Electron, SQLite) ── calls out every ~20 s ──┘
  sends: stock movements, catalogue changes, sales made for orders, heartbeat
  gets:  accepted orders, cancellations, refund instructions, product requests
```

The browser never touches SQLite. The POS only makes outbound calls, so the shop router needs no change and the POS keeps working with no internet.

## 3. Options compared

| Option | Good | Bad | Verdict |
|---|---|---|---|
| Add to `dashboard/` | Fewer apps | Mixes public shop with private owner finance. A shop bug could reach owner data | Rejected |
| Separate `store/` web app in this repo | One repo, same stack as `dashboard/`, shared pure code | Web and desktop share a repo, so builds must stay apart | **Recommended** |
| Separate web app and separate API service | Clean scaling | Second deployment and duplicated contracts for one shop | Rejected for now |

`store/` has its own `package.json`, as `dashboard/` does. Nothing in it reaches the Electron build.

## 4. Stack

| Part | Choice | Reason |
|---|---|---|
| Web | Next.js App Router, React, TypeScript | Already used in `dashboard/`, server rendering suits product pages |
| Styling | Tailwind CSS, shop app only | Required by the master prompt. No second styling system |
| Database | PostgreSQL on Neon, its own project | Needs row locks. Keeps customer data away from owner finance and backups |
| DB driver | `@neondatabase/serverless` | Already in the repo |
| Validation | zod | Already in the repo |
| Images | Cloudflare R2 | No egress fees, S3 compatible |
| Desktop | Stays Electron, React, Vite, SQLite | Not migrated |

## 5. Shared business code

| Concept | One home | How others use it |
|---|---|---|
| Line totals and VAT | `src/core/vat.ts`, `src/core/money.ts` | `store/` imports the same files |
| Order total and delivery fee | `store/src/domain/pricing.ts` | Only the server. The browser shows the result |
| Order and payment states | `store/src/domain/order-machine.ts` | Admin and shop read it |
| Availability | One SQL view, `product_availability` | Nothing else calculates it |
| Sync message formats | `store/src/shared/commerce-events.ts` | POS imports it |

If Vercel cannot build files outside `store/`, the fallback is a build step that copies the two `src/core` files, with a test that fails if the copies differ. Phase A settles this.

## 6. The main design decisions

**Sale at handover, in the POS.** An online order becomes a normal POS sale only when goods leave the shop. Staff press Hand over in the POS Online orders tab, which calls `finalizeSale`. This keeps one invoice series, one VAT engine, one stock ledger and one set of accounts. It also works with no internet, since accepted orders are already on the POS.

**No revenue at Place Order.** Before handover there is no sale, invoice or journal entry in the POS.

**The POS is the source of physical stock.** The web holds reservations only. See `INVENTORY_RESERVATION_DESIGN.md`.

**No field has two owners.** See `DATA_OWNERSHIP_AND_SYNC.md`.

## 7. Changes in the POS

| Change | File | Effect on existing behaviour |
|---|---|---|
| New tables and triggers | Migration 018 | None until commerce is switched on |
| Tender `online` | Migration 019, `sales.ts`, `refunds.ts` | Existing tenders unchanged |
| Non-stock product kind | Migration 020, `sales.ts` | Existing products stay as they are |
| Category picker | `catalog.ts`, `Products.tsx` | New optional field in the form |
| Online orders tab | New renderer file, IPC in three places | New tab, shown only when switched on |
| `commerce-sync` loop | New service, `main.ts` timer | Off by default |
| Restore marker | `main.ts` | One extra file written on restore |
| Channel in reports | `reports.ts`, `series.ts` | Adds filters. Totals unchanged for shop sales |

Online sales are identified by a link table, `commerce_order_links`, so the `sales` table itself is not altered.

## 8. Live updates

| Method | Good | Bad | Verdict |
|---|---|---|---|
| WebSockets | Instant | Needs a separate always-on service | Rejected |
| Server-sent events | Simple one-way push | Long connections cost more and drop on serverless | Rejected for now |
| Polling | Simple, survives refresh, no open connection needed | Up to 15 s late | **Recommended** |

Customer tracking page polls every 15 s while visible. Admin polls every 10 s, with a sound for new orders. The POS polls every 20 s.

## 9. Hosting and recurring cost

| Service | Cost known so far | Source |
|---|---|---|
| Vercel | Pro $20 a month. Hobby is non-commercial only | [Pricing](https://vercel.com/pricing), [Hobby terms](https://vercel.com/docs/plans/hobby) |
| Neon | Paid plan needed. Storage about $0.35 per GB-month. Compute not yet priced. The POS poll keeps compute awake during shop hours | Earlier research, confirm at signup |
| Cloudflare R2 | Free up to 10 GB, then $0.015 per GB-month. No egress fee | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Domain | Client's choice | Quote needed |
| Payment fees | Not published by either provider | Quotes needed |
| SMS, if chosen | Not priced | Quote needed |

[Neon lists no Middle East region](https://neon.com/docs/introduction/regions). Region cannot be changed later without moving the data. Frankfurt is the proposed region, subject to the legal check in `OPEN_DECISIONS.md`.

Vercel limits request bodies to 4.5 MB, so images upload directly to R2. See `SECURITY_AND_TEST_PLAN.md`.

## 10. Dependencies

Each is checked for current version and maintenance status again at install time. Nothing is installed yet.

| Package | Why | Already in repo? | Overlap | Notes |
|---|---|---|---|---|
| next, react, react-dom | Web app | Yes, in `dashboard/` | None | Same versions as `dashboard/` |
| zod | API validation | Yes | None | |
| @neondatabase/serverless | Database | Yes | None | |
| tailwindcss, @tailwindcss/postcss | Styling, required by prompt | No | None | Shop only, build-time |
| sharp | Re-encode uploads, make sizes, strip metadata | No | None | Native binary, security relevant, keep updated |
| aws4fetch | Sign R2 upload URLs | No | Could hand-write with `node:crypto` | Small. Decide in Phase D |
| vitest, @electric-sql/pglite | Tests | Yes | None | |
| pg, @types/pg | Race tests only, which need real parallel connections | No | PGlite is one connection, so it cannot do this job | Test-only, never in the app |

Deliberately not added: component libraries, icon packages (hand SVG, as in the repo), form libraries, data-fetching libraries, chart libraries, map libraries, payment SDKs (provider REST through `fetch`), Playwright, Puppeteer.

## 11. Possible code overlap, and how it is avoided

| Risk | Answer |
|---|---|
| Two sync systems | Different jobs. Dashboard is one-way latest snapshots. Commerce is ordered events. Neither calls the other |
| Two logins | One per application boundary: POS, `dashboard/`, `store/`. They do not share accounts |
| `password.ts` copied | `store/` imports the pure helper from `dashboard/` if the build allows, else one reviewed copy |
| Two product lists | Web holds a read-only mirror of POS products. It has no form that edits POS fields |
| Two VAT engines | `store/` imports `src/core/vat.ts` |
| Tailwind vs global CSS | `store/` has one small base stylesheet that holds only Tailwind setup |

## 12. Rollback

| What failed | Action | Effect |
|---|---|---|
| Website problem | Turn store mode off, or roll back the Vercel deployment | POS keeps selling |
| Sync problem | Switch `commerce_enabled` off in the POS | Triggers stop writing. POS works as before |
| POS migration problem | Restore the backup taken just before the update. The POS has no automatic pre-migration backup today, so this is a required rollout step | Migrations 018 to 020 only add things, except the rebuild of `payments` and `refunds`, which is why a backup is required first |
| Payment problem | Disable online payment, leave pay at pickup | Orders continue |
| Orders in progress at rollback | Staff finish them manually from the admin page, or refund | No stock is left held, since reservations expire |
