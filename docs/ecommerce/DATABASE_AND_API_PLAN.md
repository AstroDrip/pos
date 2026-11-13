# Database and API plan

Status: proposal, waiting for approval. Written 2026-11-10. Nothing here has been created.

Conventions: money in integer halalas, quantity in milli-units, as in the POS. Timestamps are UTC. One store only (see `OPEN_DECISIONS.md`).

## 1. PostgreSQL: catalogue

| Table | Key fields | Notes |
|---|---|---|
| `catalog_products` | `pos_product_id` PK, `sku`, `name_en`, `name_ar`, `category_id`, `unit`, `sell_mode`, `price_incl`, `vat_rate_bp`, `pos_active`, `pos_seq` | Read-only copy. Only the sync writes it. No cost field exists |
| `catalog_barcodes` | `barcode` PK, `pos_product_id` | Read-only copy, for search |
| `catalog_categories` | `pos_category_id` PK, `name_en`, `name_ar` | Read-only copy |
| `web_categories` | `pos_category_id` PK, `sort`, `image_id`, `visible` | Web presentation only |
| `web_products` | `pos_product_id` PK, `description`, `status` (`unpublished`, `published`, `archived`), `featured`, `safety_stock`, `updated_by`, `updated_at` | Default `unpublished` |
| `product_images` | `id`, `pos_product_id`, `object_key`, `width`, `height`, `size_bytes`, `sort`, `is_primary` | Files are in R2 |
| `product_requests` | `id`, `name`, `barcode`, `note`, `state`, `linked_pos_product_id` | Not sellable |
| `banners` | `id`, `title`, `body`, `image_id`, `link`, `active`, `sort` | Home page, admin managed |

Archived products keep every row, so old orders still read correctly. Order lines copy the name and price at the time of order.

## 2. PostgreSQL: stock

| Table | Key fields | Notes |
|---|---|---|
| `inventory_positions` | `pos_product_id` PK, `on_hand`, `reserved`, `applied_seq`, `updated_at` | `CHECK (reserved >= 0)`. `on_hand` is written only by the sync. It may be negative if the POS is |
| `reservations` | `id`, `order_id`, `pos_product_id`, `qty`, `state` (`active`, `consumed`, `released`), `expires_at`, `release_reason` | `UNIQUE (order_id, pos_product_id)` |
| `stock_discrepancies` | `id`, `pos_product_id`, `expected`, `actual`, `seq`, `state`, `resolved_by` | Written by reconciliation and shortage checks |

## 3. PostgreSQL: orders and payments

| Table | Key fields | Notes |
|---|---|---|
| `orders` | `id` uuid, `public_ref` random, `status`, `fulfilment` (`delivery`, `pickup`), `customer_name`, `phone`, `address_*`, `area_id`, `location_note`, `lat`, `lng`, `pickup_slot`, `subtotal_*`, `delivery_fee`, `vat`, `total`, `assigned_staff`, `pos_invoice_no`, `access_token_hash`, `idempotency_key` UNIQUE, `version` | `version` is checked on every change |
| `order_lines` | `order_id`, `line_no`, `pos_product_id`, `sku`, `name`, `qty`, `unit_price_incl`, `vat_rate_bp`, `line_incl`, `line_vat`, `is_estimate` | Copied at order time |
| `order_status_history` | `order_id`, `from_status`, `to_status`, `staff_id`, `reason`, `at` | Append only |
| `payments` | `id`, `order_id`, `method`, `status`, `amount`, `amount_captured`, `provider`, `provider_ref` UNIQUE, `idempotency_key` UNIQUE | |
| `payment_events` | `provider`, `provider_event_id` UNIQUE, `payload`, `verified_at`, `applied_at` | Webhook inbox |
| `refunds` | `id`, `order_id`, `payment_id`, `amount`, `reason`, `status`, `provider_ref`, `approved_by`, `pos_refund_no` | |

## 4. PostgreSQL: settings, staff, sync

| Table | Purpose |
|---|---|
| `store_settings` | Delivery fee, free delivery threshold (5000 halalas), stale minutes, opening hours, reservation minutes, payment methods |
| `delivery_areas` | Allowed areas, each with an optional fee |
| `staff_users`, `staff_sessions` | Web staff login |
| `staff_roles`, `staff_role_permissions` | Web permissions |
| `audit_log` | Every staff action and payment change. Append only |
| `devices` | POS credential, hashed |
| `sync_inbox` | `event_id` PK, for duplicate detection, `status`, `error` |
| `pos_commands` | Web to POS queue, with `acked_at` |
| `idempotency_keys` | Key, request hash, stored response |
| `rate_limits` | Same idea as `dashboard/` |

## 5. Key database functions

Written as one SQL function each, so each is one atomic call over the HTTP driver.

| Function | Job |
|---|---|
| View `product_availability` | The only place availability is worked out. NULL means the POS has not reported the product yet |
| `place_order_reserve(...)` | Locks products in id order, checks all, reserves all, or raises and changes nothing |
| `apply_events(device, events)` | Applies a whole POS batch in order, each event once, in one transaction |
| `release_reservation(order, reason)` | Releases once, returns stock to available |

## 6. SQLite: new POS tables

| Migration | Contents |
|---|---|
| `018_commerce_sync.ts` (built, Phase E1) | `commerce_outbox`, the triggers, setting `commerce_enabled` = 0 |
| Next, Phase D | `commerce_inbox`, `commerce_orders`, `commerce_order_lines`, `commerce_order_links` (`sale_id` UNIQUE, `order_id` UNIQUE, `fulfilment`, `payment_method`), `commerce_reserved`, new permissions |
| `019_online_tender.ts` | Rebuilds `payments` and `refunds` to allow tender `online`, following migration 010 |
| `020_service_items.ts` | Adds `products.item_kind` (`stock`, `service`), default `stock` |

`products.category_id` already exists, so no migration is needed for categories. `rollBackToV1` in `phase1b.test.ts` is extended for each.

Accounting for tender `online`: debit existing account `1020` card clearing, so cash and bank totals stay correct with no change in `financials.ts`. Shift card totals filter by tender, so online money stays out of the shift count. The accountant may ask for a separate account. That is a one-line change.

## 7. API boundaries

All bodies are checked with zod. Each operation has exactly one endpoint.

### Public shop, no login

| Method and path | Job |
|---|---|
| `GET /api/store/products` | Filter, search, sort, load more. Published only |
| `GET /api/store/suggest` | Search suggestions |
| `POST /api/store/quote` | Server prices the cart: lines, VAT, delivery fee, free delivery progress |
| `POST /api/store/orders` | Place order. Needs `Idempotency-Key` |
| `GET /api/store/orders/[ref]` | Tracking. The secret token goes in the `x-order-token` header, never in the address |
| `POST /api/store/orders/[ref]/cancel` | Customer cancel, when allowed |
| `POST /api/store/orders/[ref]/pay` | Starts provider payment |

Public responses never include cost, other customers, or staff data.

### Staff admin, session and permission on every call

| Method and path | Permission |
|---|---|
| `GET /api/admin/summary` | `orders.view` |
| `GET /api/admin/orders`, `GET /api/admin/orders/[id]` | `orders.view` |
| `POST /api/admin/orders/[id]/transition` | Depends on target status |
| `POST /api/admin/orders/[id]/refund` | `refunds.approve` |
| `GET, PATCH /api/admin/products` | `products.edit` |
| `POST /api/admin/products/[id]/status` | `products.publish` |
| `POST /api/admin/images/upload-url`, `POST /api/admin/images/complete` | `products.edit` |
| `GET, PATCH /api/admin/settings` | `settings.manage` |
| `GET /api/admin/sync` | `stock.view` |
| `GET, POST /api/admin/discrepancies` | `stock.override` |

### POS device, bearer device credential

| Method and path | Job |
|---|---|
| `POST /api/device/commerce/enroll` | One-time code to credential |
| `POST /api/device/commerce/events` | Batch, at most 200, returns ack. An empty batch is the heartbeat |
| `GET /api/device/commerce/commands?after=` | Pull commands |
| `POST /api/device/commerce/commands/ack` | Acknowledge |

### Payment provider

| Method and path | Job |
|---|---|
| `POST /api/webhooks/payments/[provider]` | Verified, stored once, then applied |

## 8. Idempotency summary

| Operation | Key |
|---|---|
| Place order | Client key, stored with a hash of the request. Same key with a different body is refused |
| Reservation | `UNIQUE (order_id, pos_product_id)` |
| Payment start | Order and attempt number |
| Webhook | Provider event id |
| Stock event | `eventId` |
| POS sale at handover | `finalizeSale` idempotency key `order:<order id>` |
| Release | Only `active` reservations can change |
| Status change | Checks `version` and current status |
| Journal | Existing UNIQUE source rule |
