# Data ownership and synchronisation

Status: proposal, waiting for approval. Written 2026-11-10.

## 1. Ownership matrix

| Data | Owner | Edited in | Online use |
|---|---|---|---|
| Product identity (`products.id`) | POS | POS | Web uses the same id |
| SKU, barcode, PLU | POS | POS | Read-only copy, used for search |
| English and Arabic names | POS | POS | Read-only copy |
| Selling price | POS | POS | Read-only copy, copied onto each order line |
| VAT rate | POS | POS | Read-only copy |
| Cost, weighted-average cost | POS | POS | **Never leaves the POS** |
| Unit, sell mode, scale settings | POS | POS | Read-only copy. Scale settings are not sent |
| Product category | POS | POS, new picker | Read-only copy |
| Stock on hand | POS movements | POS only | Read-only copy |
| Reservations | Web | Automatic only | Sent to POS as a read-only total per product |
| Available stock | Calculated | Nobody | One SQL view |
| Safety stock | Web | Admin | Per product, used only online |
| Website description | Web | Admin | Shop |
| Photographs | Web | Admin | Files in R2, details in Postgres |
| Published, Unpublished, Archived | Web | Admin | Controls shop visibility |
| Category photo, order, visibility | Web | Admin | Shop |
| Online orders | Web | Admin, shop | Accepted orders copied to POS |
| Customer contact details | Web | Checkout | Kept online. Copied to POS only as needed for the handover screen |
| Payments | Web, verified with provider | Automatic only | Reference copied to POS sale |
| Delivery and pickup status | Web | Admin | Separate from payment |
| Invoice, sale, journal entry | POS | POS only | Web keeps the invoice number as a reference |

POS customer records are not filled from the website. This keeps personal data on fewer systems and avoids a second source for the same person.

## 2. Conflict rule

Each field has exactly one owner. There is no merging. If a POS-owned field differs online, the POS value replaces it. The admin product page shows POS fields as read-only, with the note "Change this in the POS".

## 3. New product created from the website

The web cannot create a real product, because it cannot give a valid SKU or accounting setup.

1. Admin fills in a **product request**: name, suggested category, barcode if known, note.
2. The POS shows it under Online orders, Product requests.
3. A user with `product.manage` completes it through normal `createProduct`. The POS gives it its id and SKU.
4. The sync sends the new product. The request is closed and linked.
5. It starts as Unpublished.

A request cannot be sold and has no SKU of its own.

## 4. Why a new sync channel

`dashboard-sync.ts` sends latest-wins snapshots, and `compactOutbox` throws old ones away. Stock needs every event, in order, exactly once. Using the old outbox would break both jobs. The two channels share no tables.

## 5. How the POS captures changes

SQLite triggers write to one new table, `commerce_outbox`, in the same transaction as the change.

| Source table | Trigger | Event |
|---|---|---|
| `stock_movements` | AFTER INSERT | `stock.movement` |
| `products` | AFTER INSERT, UPDATE | `catalog.product` |
| `product_barcodes` | AFTER INSERT, DELETE | `catalog.product` |
| `categories` | AFTER INSERT, UPDATE | `catalog.category` |

Why triggers:
- `inventory.ts` and its rules are not touched.
- A change cannot commit without its event.
- Barcode changes and imports are not missed.

Each trigger has `WHEN commerce_enabled = 1`, so nothing is written until commerce is switched on. Triggers store only the type and row id. The sender reads the row when sending, and never reads cost fields.

## 6. Event format

```json
{
  "eventId": "device-uuid:epoch:seq",
  "type": "stock.movement",
  "version": 1,
  "occurredAt": "2026-11-10T09:30:00.000Z",
  "payload": {}
}
```

| Rule | Detail |
|---|---|
| `seq` | Rises by one per event, from the outbox id |
| Order | Server applies in `seq` order for each epoch, and holds back any gap |
| Duplicate | `eventId` is unique in `sync_inbox`. A repeat is answered as already done |
| Version | Unknown version is parked and shown in sync health. It does not stop older events being read |
| Ack | Server replies with the highest continuous `seq` applied |
| Retry | POS resends from the last ack, with growing delays up to 5 minutes |

## 7. POS to web events

| Type | Effect online |
|---|---|
| `stock.movement` | Changes on hand. If linked to an order, also uses up its reservation |
| `stock.checkpoint` | Compares POS balances to online values for a given `seq` |
| `catalog.product`, `catalog.category` | Updates the read-only copy |
| `order.handed_over` | Records invoice number, moves the order on |
| `order.refund_posted` | Records the POS credit note |
| An empty batch | The POS is still there. Updates last-seen time |

## 8. Web to POS commands

The POS fetches these by cursor and acknowledges each. They are stored in `commerce_inbox`, unique by command id.

| Command | Effect in POS |
|---|---|
| `order.accepted` | Saves a local copy, ready for handover offline |
| `order.cancelled` | Marks the local copy so it cannot be handed over |
| `reserved.totals` | Refreshes read-only reserved quantities |
| `refund.instructed` | Waits for staff to post the credit note |
| `product.request` | Shows in Product requests |

## 9. Freshness

Last-seen time updates on each heartbeat, roughly every 20 s while the POS is online.

| Setting | Default |
|---|---|
| Stale after | 15 minutes |
| Effect | Browsing stays on. Availability shows as "Check with store". New orders are closed. Accept is blocked. |
| Staff see | Banner: "The POS last synced at 14:02. Online ordering is paused until it reconnects." |
| Expiry timers | Paused while stale, for at most 4 hours |

## 10. Reconciliation

| When | Check |
|---|---|
| Every night, and after every reconnect | POS sends `stock.checkpoint` for all products |
| Result equal | Nothing |
| Result different | POS value replaces the online value, a row is written to `stock_discrepancies`, and staff see it |
| Reservations | Nightly check that `reserved` equals the sum of active reservations. A mismatch is reported, and is never silently fixed |

## 11. Long outage

Outbox rows are not compacted or deleted until acknowledged. On reconnect the POS sends everything in order, then a checkpoint. Ordering reopens only after the checkpoint matches or is resolved, so a shop that was offline all day does not reopen on old numbers.

## 12. Backup restore

A restore rewinds SQLite, including the outbox and sequence numbers. A marker in the database would rewind too, so the epoch lives in a small file beside the device credential. The restore step in `main.ts` raises it.

After a raised epoch:
1. The server treats the POS as a new stream.
2. Ordering stays closed until a full checkpoint is done.
3. Any order the server shows as handed over, but the restored POS has no sale for, is listed for staff. It is never re-sold automatically.

## 13. Sync health page

Shown in admin and in the POS Online orders tab: last contact, events waiting, oldest waiting event, last error, last checkpoint result, open discrepancies, parked events.

## 14. Device credential

Same enrolment idea as the owner dashboard, with a separate credential in Windows `safeStorage`, file `commerce-device.bin`. A leak of one does not open the other.
