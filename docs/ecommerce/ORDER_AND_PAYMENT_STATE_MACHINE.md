# Order and payment state machines

Status: proposal. The master prompt says this must be approved before implementation.

Order status and payment status are two separate fields.

## 1. Order states

| Status | Customer sees | Staff see |
|---|---|---|
| `placed` | Order received — waiting for store acceptance | New |
| `accepted` | The store has accepted your order | Accepted |
| `preparing` | Your items are being collected | Preparing |
| `ready_for_pickup` | Ready for pickup | Ready |
| `out_for_delivery` | Out for delivery | Out |
| `completed` | Completed | Completed |
| `rejected` | The store could not accept this order, plus the reason | Rejected |
| `cancelled` | Cancelled | Cancelled |
| `expired` | This order expired | Expired |

"Order confirmed" is never shown before `accepted`.

## 2. Allowed changes

Any change not in this table is refused by the server.

| From | To | Who | Must be true | Effect |
|---|---|---|---|---|
| `placed` | `accepted` | `orders.accept` | Checks in section 3 pass | Capture payment if held. Send order to POS |
| `placed` | `rejected` | `orders.reject` | Reason given | Release stock. Void or refund payment |
| `placed` | `cancelled` | Customer | Within policy | Release stock. Void payment |
| `placed` | `expired` | System | Timer ran out | Release stock. Void payment |
| `accepted` | `preparing` | `orders.fulfil` | | |
| `accepted` | `cancelled` | `orders.reject` | Reason given | Release stock. Refund if paid |
| `preparing` | `ready_for_pickup` | `orders.fulfil` | Pickup order | Tell customer |
| `preparing` | `out_for_delivery` | POS handover | Delivery order, POS sale recorded | Reservation used, invoice number stored |
| `preparing` | `cancelled` | `orders.reject` | Reason given | Release stock. Refund if paid |
| `ready_for_pickup` | `completed` | POS handover | POS sale recorded | Reservation used, invoice number stored |
| `ready_for_pickup` | `cancelled` | `orders.reject` | Not collected, reason given | Release stock. Refund if paid |
| `out_for_delivery` | `completed` | `orders.fulfil` | Delivered | |
| `out_for_delivery` | `cancelled` | `orders.reject` | Delivery failed, reason given | Goods returned through POS credit note. Refund if paid |

Terminal states: `completed`, `rejected`, `cancelled`, `expired`.

All changes use `UPDATE ... WHERE id = ? AND status = ? AND version = ?`. If an expiry and an accept happen together, one wins and the other gets a clear message.

## 3. Checks before accepting

All done on the server, in one transaction. Staff see which line failed.

- Product still exists, and is still Published.
- POS has synced within the freshness limit.
- Reservation is still active, with the right quantity.
- On hand still covers all reservations for that product.
- Price still valid: the order keeps the price the customer saw. A later POS price change is shown to staff as a note.
- Total recalculated and equal to the stored total.
- Delivery area or pickup details are complete.
- Payment is held, paid, or due at handover, whichever the method needs.

Partial fulfilment and substitution are not in the first release. See `OPEN_DECISIONS.md`.

## 4. Payment states

| Status | Meaning |
|---|---|
| `pending` | Waiting for the customer to pay |
| `authorized` | Money is held, not taken |
| `paid` | Money taken, or collected in person |
| `failed` | Provider refused it |
| `cancelled` | Hold released, or the attempt was abandoned |
| `due_at_pickup` | To be paid at the counter |
| `due_on_delivery` | To be paid to the driver |
| `refund_pending` | Refund asked for, not yet confirmed |
| `refunded` | Fully refunded |
| `partially_refunded` | Part refunded |

## 5. Lifecycle by method

| Method | At Place Order | At Accept | At Reject or Cancel | At Handover in POS |
|---|---|---|---|---|
| Card, mada, Apple Pay | `pending`, then `authorized` from the webhook | Capture, then `paid` | Void, then `cancelled`. If already paid, refund | Sale with tender `online` |
| STC Pay, if enabled | `pending`, then `paid`, since it cannot hold | No payment step | Refund | Sale with tender `online` |
| Pay at pickup | `due_at_pickup` | No payment step | Nothing to return | Sale with cash or card, then `paid` |
| Cash on delivery, if enabled | `due_on_delivery` | No payment step | Nothing to return | Decision needed, see `OPEN_DECISIONS.md` |

Staff only see an order as New when payment is `authorized`, `paid`, or due at handover. An order still `pending` waits in the background and expires after 15 minutes.

**If capture fails at Accept:** the order stays `placed`, the payment shows `failed`, and staff see why. The order is not accepted.

**Weighted items:** the final price is known only after picking, so card orders cannot be captured at Accept. Default for the first release: an order with weighted items can only be pay at pickup.

## 6. Payment safety

- The browser redirect is never proof. Status comes from a verified webhook, or a server call to the provider.
- Amount and currency are compared to the order. A mismatch is held for staff.
- Raw card data never reaches our servers. The provider's hosted page or element takes it.
- Secret keys exist only on the server.
- Webhooks are stored once by event id, so repeats do nothing.
- A late webhook cannot move a payment backwards.

## 7. Refunds

| Case | What happens |
|---|---|
| Before handover | Provider void or refund only. No POS entry, since no sale exists |
| After handover | Staff with `refunds.approve` start it online. Provider refund runs. POS gets an instruction, and a supervisor posts the credit note against the original invoice with tender `online` |
| Sale paid at the counter | Existing POS refund, cash |

Refund timing given by [Moyasar](https://docs.moyasar.com/): mada 24 hours to 3 business days, credit cards 7 to 14 business days. Tap's timing is not confirmed.

Owner decision D1 says refunds are paid in cash from the drawer. Online refunds are an exception that needs approval, listed in `OPEN_DECISIONS.md`.

## 8. Provider comparison

| | Moyasar | Tap |
|---|---|---|
| mada, Visa, Mastercard, Amex | Yes | mada and cards confirmed |
| Apple Pay | Yes | Yes |
| STC Pay | Yes | Yes, must be enabled through Tap |
| Hold then capture | `manual` flag on card, token and Apple Pay | Yes, cards only |
| Hold limit | Not stated. The issuer may void it, and Moyasar's status stays `authorized` | Visa and Mastercard 30 days, mada and Amex 14 days |
| STC Pay hold | Not listed | Not supported |
| Webhook check | Not confirmed. Doc page not reachable | HMAC-SHA256 `hashstring` header |
| Published price | None, ask sales | None current. Old post: mada 1%, cap SAR 200 |
| Amount format | Halalas | Not confirmed |
| Settlement and onboarding | Ask sales | Ask sales |

Sources: [Moyasar create payment](https://docs.moyasar.com/api/payments/01-create-payment), [Tap authorize](https://developers.tap.company/docs/authorize), [Tap webhook](https://developers.tap.company/docs/webhook), [Tap STC Pay](https://developers.tap.company/docs/stcpay), [Tap mada fees post](https://blog.tap.company/new-mada-fees-saudi/).

Recommendation: Tap, if the quotes are close, because its docs answer more of what this design needs. Not selected until the client approves.

The provider sits behind one small module, `store/src/payments/provider.ts`, so a change later touches only that file.

## 9. Customer order access

- Public reference is random, never sequential.
- Tracking needs a secret token of at least 128 bits, stored only as a hash.
- A wrong token gets the same answer as an unknown order.
