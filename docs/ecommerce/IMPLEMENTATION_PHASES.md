# Implementation phases

Status: proposal, waiting for approval. Written 2026-11-10. No phase starts without approval.

## 1. Order of work

The master prompt lists phases A to G. This plan keeps those names and changes the order in one way: **the core of Phase E comes before Phase C**. Checkout cannot be correct without real stock and reservations.

Build order: **A → B → E1 → C → D → E2 → F → G**. The client asked on 2026-11-10 to see the shop screens before the sync work, so Phase B was built first on made-up local data. Its check against real synced data waits for E1.

| Phase | Work | Size |
|---|---|---|
| A | Foundations | Medium |
| E1 | POS sync and stock engine | Large |
| B | Storefront | Medium |
| C | Checkout and payment | Large |
| D | Administration and POS handover | Large |
| E2 | Conflicts, reconciliation, recovery | Medium |
| F | Reporting | Medium |
| G | Quality assurance | Medium |

Sizes compare the phases with each other. They are not time estimates. Provider onboarding and accountant replies are outside our control.

## 2. Before anything starts

| Need | Blocks |
|---|---|
| Approval of the state machine | Phase A |
| Decisions marked "Blocks build" in `OPEN_DECISIONS.md` | Phase A |
| Test Neon project and test Vercel project | Phase A |
| Provider chosen and test keys | Phase C payment part |
| Accountant ruling on VAT date and accounts | Phase C payment part, Phase F |
| ZATCA Phase 2 finished | **Going live**, not building |

## 3. Phases and acceptance criteria

### Phase A: Architecture and foundations

Work: `store/` app, Tailwind tokens, Postgres schema and migrations, staff login, shared contracts, device enrolment, check of shared `src/core` import.

Accepted when:
- `store/` builds and deploys to a test site on its own.
- Migrations run on an empty database.
- Staff login works with roles, and a test proves a wrong role is refused on the server.
- `store/` totals match POS `computeInvoice` for a shared test set.
- POS build and installer are unaffected.

### Phase E1: POS sync and stock engine

Status 2026-11-10: built locally. Race tests ran on a throwaway local PostgreSQL 18. Not yet run on Neon. Order links to POS sales arrive with handover in Phase D. Backlog-aware freshness, nightly checks and backup-restore handling are Phase E2.

Work: migration 018, triggers, `commerce-sync`, events API, read-only catalogue copy, stock positions, reservation function, category picker, first full load.

Accepted when:
- With commerce off, the POS behaves exactly as before, with the full suite passing.
- Stock movements from all sources reach the web exactly once.
- The 5, 3, 2 scenario passes.
- Real concurrency test for the last unit passes on PostgreSQL.
- Cost data is proven absent from the payload.

### Phase B: Storefront

Work: welcome, home, categories, listing, detail, search, cart with server quote.

Accepted when:
- Categories and prices are from real synced test data.
- Unpublished items are absent and archived items cannot be ordered.
- Layout passes at 375, 768, 1280, 1600 px with no overflow.
- Stale stock shows the correct wording.

### Phase C: Checkout

Status 2026-11-10: part 1 built locally. Pickup orders work end to end with pay at pickup. Delivery orders can be chosen, but cannot be placed until online payment exists, because cash on delivery is off by default. Orders wait as "received" until Phase D lets staff accept them, and expire after 30 minutes meanwhile.

Part 1: delivery and pickup, customer details, delivery fee, free delivery progress, order creation, reservation, confirmation, tracking, pay at pickup.

Part 2, after provider approval: online payment, webhooks.

Accepted when:
- The free delivery table passes on the server, including 50.00 and 50.01.
- Retrying Place Order makes one order and one reservation.
- A failed request keeps the cart.
- Forged and repeated webhooks are harmless.
- Tracking works after refresh and only with the token.

### Phase D: Administration

Status 2026-11-10: built locally for pickup orders. Staff can accept, reject, cancel and move orders on; the POS receives accepted orders and hands them over as a normal sale, which completes the order online. Product publish, unpublish, archive and descriptions work. Still to do: photo upload (needs a storage account), delivery-fee item and online tender (need card payment first), product requests from the web.

Work: order dashboard, list, detail, accept and reject, fulfilment, product management, image upload, publish states, POS Online orders tab, handover, migrations 019 and 020.

Accepted when:
- Every transition in the state machine is enforced, and invalid ones refused.
- Accept names the exact line that failed.
- Rejecting always releases stock.
- Handover creates one POS sale from the single invoice series, with correct stock, journal and audit.
- Handover works offline, then syncs.
- Bad image files are refused.

### Phase E2: Conflicts and recovery

Work: shortage flags, nightly checkpoint, discrepancy handling, stale policy, epoch after restore, sync health page.

Accepted when:
- All 16 inventory tests in the test plan pass.
- An outage test recovers with no duplicates.
- A restored backup closes ordering until the checkpoint is done.

Status 2026-11-13: built locally. Backlog-aware freshness (the shop counts as current only when the POS has nothing left to send), checkpoint on request and nightly per store day, epoch bump after a backup restore (open orders sent again, finished ones blocked from a second handover), shortage and held-total checks, held totals shown on the POS, and a staff Stock page with Mark checked. Tested in unit tests, on a throwaway PostgreSQL 18 with race tests, and against the running local servers. Not run on Neon.

### Phase F: Reporting

Work: changes listed in `REPORTING_IMPACT.md`.

Accepted when:
- Combined total equals the sum of channels, with no double count.
- Shop-only report numbers are unchanged.
- `integrity.ts` is clean with online sales.
- Accountant has reviewed the treatment.

Status 2026-11-13: built locally. Sales report splits in store and online (count, total, pickup and delivery) and adds online quantity to top products; cashier detail shows online handovers; stock shows quantity held online. Totals are unchanged because a handover is a normal sale. Integrity checks are clean with online sales. Accountant review is still open.

### Phase G: Quality assurance

Work: full suites, integration, concurrency, security checks, visual audit, responsive review, production-readiness report, including an independent code review.

Accepted when:
- All tests pass, with results stated honestly.
- Every screen is checked at every width.
- The readiness report lists anything not tested.

Status 2026-11-13: done locally, see `READINESS_REPORT.md`. Six problems were found and fixed. Not ready to go live; the report lists what is untested. No independent reviewer was used.

## 4. Rules for every phase

- No Playwright or Puppeteer.
- Do not push until asked.
- No changes to VAT calculation, invoice numbering, ZATCA processing, or stock accounting rules.
- Production databases and real customer data are never used for tests.
- Do not go to the next phase with a critical architecture problem open.
- Deployment is claimed only with a real result.

## 5. Going live checklist

ZATCA Phase 2 complete. Accountant sign-off. Legal check on data location. Provider live keys. Real device test on a shop connection. Backup before POS update. Store terms and privacy page. Rollback steps rehearsed.
