-- The POS handover: the till sold the order, so the web order moves on and anything not sold is released.
-- Replaces apply_events with the same signature, so its permissions stay as they were.
CREATE OR REPLACE FUNCTION commerce.apply_events(p_device uuid, p_events jsonb) RETURNS bigint
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
BEGIN
  -- One batch at a time per device, so the order is safe.
  SELECT acked_seq, epoch INTO v_acked, v_epoch FROM devices WHERE id = p_device FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BAD_EVENT_ID: unknown device';
  END IF;

  FOR e IN SELECT value FROM jsonb_array_elements(p_events) ORDER BY (split_part(value->>'eventId', ':', 3))::bigint LOOP
    v_id := e->>'eventId';
    v_seq := split_part(v_id, ':', 3)::bigint;
    IF split_part(v_id, ':', 1)::uuid <> p_device OR split_part(v_id, ':', 2)::bigint <> v_epoch THEN
      RAISE EXCEPTION 'BAD_EVENT_ID: %', v_id;
    END IF;
    IF v_seq <= v_acked THEN
      CONTINUE;
    END IF;
    IF v_seq > v_acked + 1 THEN
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

  UPDATE devices SET acked_seq = v_acked, last_seen_at = now() WHERE id = p_device;
  RETURN v_acked;
END;
$$;
