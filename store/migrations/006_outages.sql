-- Sync after outages and backup restores, shortage flags and held-total checks.
-- "Fresh" now means the POS has sent everything and its last full stock check is current, not just that it made contact.

ALTER TABLE commerce.devices ADD COLUMN needs_checkpoint boolean NOT NULL DEFAULT false;
ALTER TABLE commerce.devices ADD COLUMN last_contact_at timestamptz;

CREATE FUNCTION commerce.order_accepted_payload(p_order uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = commerce, pg_temp AS $$
  SELECT jsonb_build_object('orderId', o.id, 'publicRef', o.public_ref, 'fulfilment', o.fulfilment, 'paymentMethod', p.method,
           'customerName', o.customer_name, 'phone', o.phone, 'deliveryFeeIncl', o.delivery_fee_incl,
           'lines', (SELECT jsonb_agg(jsonb_build_object('productId', l.pos_product_id, 'qty', l.qty, 'unitPriceIncl', l.unit_price_incl, 'discount', l.discount, 'isEstimate', l.is_estimate) ORDER BY l.line_no)
                     FROM order_lines l WHERE l.order_id = o.id))
  FROM orders o JOIN LATERAL (SELECT method FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) p ON true
  WHERE o.id = p_order
$$;

CREATE FUNCTION commerce.resync_pos_orders() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = commerce, pg_temp AS $$
  INSERT INTO pos_commands (type, payload)
  SELECT 'order.accepted', order_accepted_payload(id) FROM orders WHERE status IN ('accepted', 'preparing', 'ready_for_pickup');
  INSERT INTO pos_commands (type, payload)
  SELECT 'order.cancelled', jsonb_build_object('orderId', o.id, 'reason', 'Already finished online. Do not hand it over.')
  FROM orders o
  WHERE o.status IN ('completed', 'out_for_delivery', 'cancelled', 'rejected') AND o.created_at > now() - interval '30 days'
    AND EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'accepted');
$$;

DROP FUNCTION commerce.apply_events(uuid, jsonb);

CREATE FUNCTION commerce.apply_events(p_device uuid, p_events jsonb, p_pending integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = commerce, pg_temp AS $$
DECLARE
  v_acked   bigint;
  v_epoch   bigint;
  e         jsonb;
  p         jsonb;
  b         jsonb;
  v_id      text;
  v_seq     bigint;
  v_type    text;
  v_version integer;
  v_status  text;
  v_error   text;
  v_product bigint;
  v_cat     bigint;
  v_qty     integer;
  v_held    integer;
  v_current integer;
  v_order   record;
  v_target  text;
  v_last    timestamptz;
  v_stale   integer;
  v_needs   boolean;
  v_gap     boolean := false;
  v_ep      bigint;
BEGIN
  -- One batch at a time per device, so the order is safe.
  SELECT acked_seq, epoch, last_seen_at, needs_checkpoint INTO v_acked, v_epoch, v_last, v_needs FROM devices WHERE id = p_device FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BAD_EVENT_ID: unknown device';
  END IF;
  -- After a silence longer than the stale limit, stock is not trusted again until a full stock check arrives.
  SELECT stale_minutes INTO v_stale FROM store_settings WHERE id = 1;
  IF v_last IS NULL OR v_last < now() - make_interval(mins => v_stale) THEN
    v_needs := true;
  END IF;

  FOR e IN SELECT value FROM jsonb_array_elements(p_events) ORDER BY (split_part(value->>'eventId', ':', 3))::bigint LOOP
    v_id := e->>'eventId';
    v_seq := split_part(v_id, ':', 3)::bigint;
    v_ep := split_part(v_id, ':', 2)::bigint;
    IF split_part(v_id, ':', 1)::uuid <> p_device OR v_ep < v_epoch THEN
      RAISE EXCEPTION 'BAD_EVENT_ID: %', v_id;
    END IF;
    IF v_ep > v_epoch THEN
      -- The POS restored a backup: it numbers again from one, must send a full stock check, and gets its orders again.
      v_epoch := v_ep;
      v_acked := 0;
      v_needs := true;
      PERFORM resync_pos_orders();
    END IF;
    IF v_seq <= v_acked THEN
      CONTINUE;
    END IF;
    IF v_seq > v_acked + 1 THEN
      v_gap := true;
      EXIT;
    END IF;

    v_type := e->>'type';
    v_version := (e->>'version')::integer;
    p := e->'payload';
    v_status := 'applied';
    v_error := NULL;

    IF v_version <> 1 THEN
      v_status := 'parked';
      v_error := 'unknown version';

    ELSIF v_type = 'catalog.category' THEN
      INSERT INTO catalog_categories (pos_category_id, name_en, name_ar)
      VALUES ((p->>'categoryId')::bigint, p->>'nameEn', p->>'nameAr')
      ON CONFLICT (pos_category_id) DO UPDATE SET name_en = excluded.name_en, name_ar = excluded.name_ar, updated_at = now();
      INSERT INTO web_categories (pos_category_id) VALUES ((p->>'categoryId')::bigint) ON CONFLICT DO NOTHING;

    ELSIF v_type = 'catalog.product' THEN
      v_product := (p->>'productId')::bigint;
      -- A category not seen yet is left blank. The category's own event and the product's next event follow in order.
      SELECT pos_category_id INTO v_cat FROM catalog_categories WHERE pos_category_id = (p->>'categoryId')::bigint;
      INSERT INTO catalog_products (pos_product_id, sku, name_en, name_ar, category_id, unit, sell_mode, item_kind, price_incl, vat_rate_bp, pos_active, pos_seq)
      VALUES (v_product, p->>'sku', p->>'nameEn', p->>'nameAr', v_cat, p->>'unit', p->>'sellMode', p->>'itemKind', (p->>'priceIncl')::integer, (p->>'vatRateBp')::integer, (p->>'active')::boolean, v_seq)
      ON CONFLICT (pos_product_id) DO UPDATE SET sku = excluded.sku, name_en = excluded.name_en, name_ar = excluded.name_ar, category_id = excluded.category_id, unit = excluded.unit,
        sell_mode = excluded.sell_mode, item_kind = excluded.item_kind, price_incl = excluded.price_incl, vat_rate_bp = excluded.vat_rate_bp, pos_active = excluded.pos_active, pos_seq = excluded.pos_seq, updated_at = now();
      DELETE FROM catalog_barcodes WHERE pos_product_id = v_product;
      INSERT INTO catalog_barcodes (barcode, pos_product_id)
      SELECT value, v_product FROM jsonb_array_elements_text(p->'barcodes')
      ON CONFLICT (barcode) DO UPDATE SET pos_product_id = excluded.pos_product_id;
      -- New products are never shown online until staff publish them.
      INSERT INTO web_products (pos_product_id) VALUES (v_product) ON CONFLICT DO NOTHING;

    ELSIF v_type = 'stock.movement' THEN
      v_product := (p->>'productId')::bigint;
      v_qty := (p->>'qty')::integer;
      IF NOT EXISTS (SELECT 1 FROM catalog_products WHERE pos_product_id = v_product) THEN
        v_status := 'parked';
        v_error := 'unknown product';
      ELSE
        v_held := 0;
        IF p->>'orderId' IS NOT NULL AND p->>'reason' = 'sale' THEN
          UPDATE reservations SET state = 'consumed'
          WHERE order_id = (p->>'orderId')::uuid AND pos_product_id = v_product AND state = 'active'
          RETURNING qty INTO v_held;
          v_held := COALESCE(v_held, 0);
        END IF;
        INSERT INTO inventory_positions (pos_product_id, on_hand, applied_seq) VALUES (v_product, v_qty, v_seq)
        ON CONFLICT (pos_product_id) DO UPDATE SET on_hand = inventory_positions.on_hand + excluded.on_hand, reserved = inventory_positions.reserved - v_held, applied_seq = excluded.applied_seq, updated_at = now();
        -- The POS can sell below what is held for online orders, for example while offline. Flag it once for staff.
        IF EXISTS (SELECT 1 FROM inventory_positions WHERE pos_product_id = v_product AND on_hand < reserved)
           AND NOT EXISTS (SELECT 1 FROM stock_discrepancies WHERE pos_product_id = v_product AND kind = 'shortage' AND state = 'open') THEN
          INSERT INTO stock_discrepancies (pos_product_id, kind, expected, actual, seq)
          SELECT v_product, 'shortage', reserved, on_hand, v_seq FROM inventory_positions WHERE pos_product_id = v_product;
        END IF;
      END IF;

    ELSIF v_type = 'stock.checkpoint' THEN
      FOR b IN SELECT value FROM jsonb_array_elements(p->'balances') LOOP
        v_product := (b->>'productId')::bigint;
        v_qty := (b->>'qty')::integer;
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM catalog_products WHERE pos_product_id = v_product);
        SELECT on_hand INTO v_current FROM inventory_positions WHERE pos_product_id = v_product FOR UPDATE;
        IF NOT FOUND THEN
          INSERT INTO inventory_positions (pos_product_id, on_hand, applied_seq) VALUES (v_product, v_qty, v_seq);
        ELSIF v_current <> v_qty THEN
          INSERT INTO stock_discrepancies (pos_product_id, kind, expected, actual, seq) VALUES (v_product, 'checkpoint', v_current, v_qty, v_seq);
          UPDATE inventory_positions SET on_hand = v_qty, applied_seq = v_seq, updated_at = now() WHERE pos_product_id = v_product;
        END IF;
      END LOOP;
      IF (p->>'part')::integer >= (p->>'parts')::integer THEN
        v_needs := false;
        -- The held total for each product must equal its active holds. A mismatch is reported, never silently fixed.
        INSERT INTO stock_discrepancies (pos_product_id, kind, expected, actual, seq)
        SELECT i.pos_product_id, 'reservation_sum', COALESCE(r.held, 0), i.reserved, v_seq
        FROM inventory_positions i
        LEFT JOIN (SELECT pos_product_id, sum(qty) AS held FROM reservations WHERE state = 'active' GROUP BY pos_product_id) r ON r.pos_product_id = i.pos_product_id
        WHERE i.reserved <> COALESCE(r.held, 0)
          AND NOT EXISTS (SELECT 1 FROM stock_discrepancies d WHERE d.pos_product_id = i.pos_product_id AND d.kind = 'reservation_sum' AND d.state = 'open');
      END IF;

    ELSIF v_type = 'order.handed_over' THEN
      SELECT id, status, fulfilment INTO v_order FROM orders WHERE id = (p->>'orderId')::uuid FOR UPDATE;
      IF NOT FOUND THEN
        v_status := 'parked';
        v_error := 'unknown order';
      ELSIF v_order.status NOT IN ('accepted', 'preparing', 'ready_for_pickup') THEN
        v_status := 'parked';
        v_error := 'order not open';
      ELSE
        -- The sale happened at the till, so the order moves to where the goods now are. Steps staff did not press are not invented.
        v_target := CASE WHEN v_order.fulfilment = 'pickup' THEN 'completed' ELSE 'out_for_delivery' END;
        INSERT INTO order_status_history (order_id, from_status, to_status, actor, reason)
        VALUES (v_order.id, v_order.status, v_target, 'pos', 'Handed over at the till, invoice ' || (p->>'invoiceNo'));
        UPDATE orders SET status = v_target, pos_invoice_no = p->>'invoiceNo', version = version + 1 WHERE id = v_order.id;
        UPDATE payments SET status = 'paid', amount_captured = amount WHERE order_id = v_order.id AND status IN ('due_at_pickup', 'due_on_delivery');
        -- Anything held but not sold goes back on sale.
        PERFORM release_reservation(v_order.id, 'Not taken at handover');
      END IF;

    ELSE
      v_status := 'parked';
      v_error := 'unknown type';
    END IF;

    INSERT INTO sync_inbox (event_id, device_id, epoch, seq, type, version, payload, status, error, applied_at)
    VALUES (v_id, p_device, v_epoch, v_seq, v_type, v_version, p, v_status, v_error, CASE WHEN v_status = 'applied' THEN now() END);
    v_acked := v_seq;
  END LOOP;

  -- "Last seen" means caught up: nothing left to send and no gap. Merely making contact is recorded separately.
  UPDATE devices SET acked_seq = v_acked, epoch = v_epoch, needs_checkpoint = v_needs, last_contact_at = now(),
    last_seen_at = CASE WHEN p_pending = 0 AND NOT v_gap THEN now() ELSE last_seen_at END
  WHERE id = p_device;
  RETURN jsonb_build_object('ackedSeq', v_acked, 'needCheckpoint', v_needs);
END;
$$;

REVOKE ALL ON FUNCTION commerce.apply_events(uuid, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce.resync_pos_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commerce.apply_events(uuid, jsonb, integer) TO store_device;
GRANT EXECUTE ON FUNCTION commerce.order_accepted_payload(uuid) TO store_app;
