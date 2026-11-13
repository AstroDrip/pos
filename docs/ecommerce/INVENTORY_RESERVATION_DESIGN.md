# Inventory and reservation design

Status: proposal, waiting for approval. Written 2026-11-10.

## 1. The rule

| Number | Source | Who can change it |
|---|---|---|
| On hand | POS movements | Sync only |
| Reserved | Sum of active reservations | Order engine only |
| Safety stock | Web setting per product | Admin |
| **Available** | On hand − reserved − safety | Calculated, never stored |

Available is shown as 0 when the sum is below 0. Nobody can type a stock number on the website. Physical changes, such as counts and goods receipts, stay in the POS.

Reserved stock is not sold stock. It leaves on hand only when the POS records the sale.

## 2. Reservation lifecycle

| Event | Action |
|---|---|
| Place Order | Validate, create reservation, available goes down |
| Payment not finished in 15 min | Release |
| Not accepted in 30 min | Release, order `expired` |
| Rejected or cancelled | Release |
| Authorised staff release | Release, reason required, audited |
| POS handover | Consume |

Timing rule: reservation starts at Place Order, not at Add to Cart. Carts hold nothing.

Timers run only while the store is open and the POS is in sync, as set in `DATA_OWNERSHIP_AND_SYNC.md`. Accepted orders do not expire by timer, so staff must act on them.

## 3. Stopping overselling

`place_order_reserve` is one SQL function, called as a single statement:

1. `SELECT ... FROM inventory_positions WHERE id = ANY(...) ORDER BY id FOR UPDATE`. Locking in id order prevents deadlocks. See the [PostgreSQL locking docs](https://www.postgresql.org/docs/17/explicit-locking.html).
2. For each line check `on_hand − reserved − safety >= qty`.
3. If any line fails, raise an error naming the products. Nothing is changed.
4. Otherwise add to `reserved` and insert the reservations.

A second buyer waits on the lock, then sees the new number. There is no read-then-use-later gap.

## 4. Consuming a reservation without counting twice

At handover the POS runs one SQLite transaction:

1. `finalizeSale` with idempotency key `order:<id>`, which writes movements as normal.
2. Insert the row in `commerce_order_links`.
3. Triggers add the movements to the outbox.

When the server applies a linked `stock.movement`:

```
on_hand  = on_hand  - sold qty
reserved = reserved - reservation qty
reservation.state = consumed
```

Both change in one statement, so available does not jump. For a weighed item the sold quantity may differ from the reservation. Each number uses its own value.

## 5. Scenarios

Safety stock is 0 in these examples.

| # | Scenario | Result |
|---|---|---|
| 1 | **Prompt's case.** On hand 5. Web reserves 3. POS sells 2 | On hand 3, reserved 3, available 0. No negative. Both fulfilled |
| 2 | On hand 5. Web reserves 3. POS sells 4 while online | On hand 1, reserved 3, available 0. Shortage of 2 is flagged on the order |
| 3 | Same as 2, but POS is offline | POS sells freely. On reconnect the shortage is flagged. Checkout was closed once stale |
| 4 | On hand 1, two customers at once | One reserves. The other is told it is unavailable and keeps the cart |
| 5 | On hand 5. POS sells 2 and web reserves 3 at the same moment | Either order gives on hand 3, reserved 3 |
| 6 | Same event sent twice | Second is ignored through `sync_inbox` |
| 7 | Events arrive out of order | Later ones wait for the gap to fill |
| 8 | Order rejected | Reservation released once, available back up |
| 9 | Expiry and accept together | Status check lets one win. The other gets a message |
| 10 | Stock count lowers on hand | Movement syncs. Shortage flagged if needed |
| 11 | Goods received | Movement syncs. Available goes up |
| 12 | POS refund with restock | Movement syncs. On hand goes up. Reservation not touched |
| 13 | Handover retried | `finalizeSale` returns the first result |
| 14 | Backup restored | New epoch, full checkpoint, ordering closed until done |
| 15 | POS offline at handover | Sale happens locally. Sync catches up later |
| 16 | Network lost after Place Order | Retry with the same key returns the same order |

## 6. Negative stock

The prompt says no invalid negative balance may be created silently. The POS default `allow` is an owner setting and is not changed.

So: the web never reserves past available, and `reserved` can never go below 0. If the POS oversells, on hand copies what the POS really has, even below zero. It is flagged on the order and in `stock_discrepancies`. Staff then choose to reject, cancel or wait for stock.

## 7. What staff see for each order line

Product, SKU, ordered quantity, physical stock, online reserved, available, and a text label: In stock, Short by 2, Not published, Sync out of date. Colour is never the only signal.

## 8. Stock in reports and in the POS

`commerce_reserved` gives the POS a read-only reserved figure per product for the Stock report. It is labelled and never added to `stock_balances`.

Default: the Sell screen is not changed. A cashier warning when reserved stock is being sold is a possible later addition, listed in `OPEN_DECISIONS.md`.

## 9. One source for each thing

| Concept | One place |
|---|---|
| Physical movements | `stock_movements`, through `applyMovement` |
| Available | View `product_availability` |
| Reservation change | The three SQL functions |

The word "stock" is never shown online without saying which of the three numbers it means.
