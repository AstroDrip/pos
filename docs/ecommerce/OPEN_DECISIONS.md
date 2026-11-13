# Open decisions

Status: waiting for the client. Written 2026-11-10. Defaults are assumptions until approved.

"Blocks build" means the design changes depending on the answer. "Can wait" means it is a setting or a small change.

## 1. Decisions that affect the architecture

| # | Decision | Default (assumption) | Why it matters | Status |
|---|---|---|---|---|
| 1 | Sell live before ZATCA Phase 2? | No. Build and test first | Every online sale is a POS invoice, and the POS prints a test receipt today | Blocks launch |
| 2 | Where customer data lives | Neon Frankfurt, after a legal check | See section 4 | Blocks build |
| 3 | Payment provider | Tap, if quotes are close | Comparison in `ORDER_AND_PAYMENT_STATE_MACHINE.md` | Blocks payment part |
| 4 | Payment methods at launch | Card, mada, Apple Pay, pay at pickup | Hold and capture only works for some | Blocks payment part |
| 5 | Cash on delivery | Off at first | The driver holds cash after the sale is booked. Needs a cash-handover process | Blocks if on |
| 6 | Weighted items online | Pay at pickup only, at first | Final price is unknown at Accept | Blocks build |
| 7 | When to reserve stock | At Place Order | Prompt asks for this choice | Blocks build |
| 8 | Stock sync failure policy | Close ordering after 15 min, block Accept | Trades sales for safety | Blocks build |
| 9 | Accounts or guest | Guest with phone and a private tracking link | Prompt mentions a logged-in customer. Accounts need phone verification and SMS costs | Blocks build |
| 10 | Who edits the catalogue | POS owns sales fields, web owns photos and text | See `DATA_OWNERSHIP_AND_SYNC.md` | Blocks build |
| 11 | Arabic in the first release | English first, text kept together for later | Standing rule says no Arabic checks. RTL would be a separate approved step | Blocks build |
| 12 | Multiple stores or areas | One store, a list of delivery areas | Adding stores later needs schema work | Blocks build |
| 13 | Online refund method | Back through the provider | Owner rule D1 says refunds are cash from the drawer. This is an exception | Blocks payment part |
| 14 | When card money is taken | At Accept | Accountant may need it moved to handover because of VAT date | Blocks payment part |

## 2. Business settings

| # | Decision | Default (assumption) | Status |
|---|---|---|---|
| 15 | Domain and hosting | Vercel Pro, domain to be chosen | Can wait |
| 16 | Delivery fee | Needs a number from the client. A setting, not in code | Before launch |
| 17 | Free delivery basis | Items after discount, before VAT | Needs confirmation, see below |
| 18 | Delivery areas | Client to list | Before launch |
| 19 | Delivery scheduling | As soon as possible, no slots | Can wait |
| 20 | Pickup scheduling | Same day, no slots | Can wait |
| 21 | Opening hours for ordering | Closed outside hours, so orders do not expire overnight | Before launch |
| 22 | Customer notifications | Tracking page only. Staff may phone. SMS or WhatsApp later | Can wait |
| 23 | Substitution | Not in first release. Staff phone the customer, then reject or cancel | Can wait |
| 24 | Partial fulfilment | Not in first release | Can wait |
| 25 | Cancellation | Customer may cancel until accepted. After that, staff only | Before launch |
| 26 | Reservation timers | 15 min to pay, 30 min for store to accept | Setting |
| 27 | Online discounts | None at first. Banners only. Discounts in the POS need supervisor approval | Can wait |
| 28 | Live driver location | No | Can wait |
| 29 | Cashier warning when selling reserved stock | No Sell screen change in first release | Can wait |
| 30 | Delivery drivers | Store's own staff | Can wait |
| 31 | Order and customer data retention | Agree with legal adviser | Before launch |

**On item 17.** Shelf prices include VAT. If the basis is before VAT, at 15% a customer needs a shelf total above SAR 57.50 to pass SAR 50.00 before VAT. A customer who sees SAR 55.00 in the cart may be confused to hear they have not reached SAR 50. The alternative is after discount **including** VAT, which matches what the customer sees. The prompt recommends before VAT, so that stays the default, but this should be a deliberate choice. Either way the comparison stays strictly greater than SAR 50.00.

## 3. For the accountant

Listed in `REPORTING_IMPACT.md` section 4: VAT date for prepaid orders, the account for online money, delivery fee income account, provider fees and settlement, cash on delivery.

## 4. Legal check

The [regulation on personal data transfers outside the Kingdom](https://www.dlapiperdataprotection.com/index.html?c=SA&t=law) limits sending personal data abroad, through routes such as standard clauses, and with a risk assessment. One [US government summary](https://www.trade.gov/market-intelligence/saudi-arabia-ict-cross-border-data-transfer-rules-now-under-enforcement) describes stricter local storage needs. These are third-party summaries, and they are not legal advice.

The shop would hold names, phones and home addresses. [Neon has no Middle East region](https://neon.com/docs/introduction/regions). A Saudi lawyer needs to say whether Frankfurt is acceptable, and what paperwork is needed. If it is not, the database moves to a Saudi-hosted PostgreSQL. The design still works, with a different driver setup and cost.

Saudi e-commerce law duties such as store terms and returns were not researched, and need the same check.

## 5. Facts still to confirm

| Fact | From |
|---|---|
| Current fee rates and settlement | Moyasar and Tap sales |
| Moyasar webhook verification and hold limit | Moyasar docs or support |
| Partial capture | Both providers |
| Whether mada holds work on Moyasar | Moyasar |
| Neon plan price for always-awake shop hours | Neon pricing at signup |
| Next.js build reaching `../src/core` on Vercel | Phase A check |
