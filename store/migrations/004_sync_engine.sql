-- The commerce sync engine and the reservation engine. Each runs as one atomic call.
-- Stock numbers can only change through these functions. Neither app role can write them directly.

CREATE FUNCTION commerce.apply_events(p_device uuid, p_events jsonb) RETURNS bigint
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

CREATE FUNCTION commerce.place_order_reserve(p_order uuid, p_lines jsonb, p_expires timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = commerce, pg_temp AS $$
DECLARE
  v_short text;
BEGIN
  IF EXISTS (SELECT 1 FROM reservations WHERE order_id = p_order) THEN
    RETURN;
  END IF;

  -- Lock in product order so two orders can never wait on each other. A second buyer waits here, then sees the new number.
  PERFORM 1 FROM inventory_positions
  WHERE pos_product_id IN (SELECT (value->>'productId')::bigint FROM jsonb_array_elements(p_lines))
  ORDER BY pos_product_id FOR UPDATE;

  SELECT string_agg(l.product::text, ',' ORDER BY l.product) INTO v_short
  FROM (SELECT (value->>'productId')::bigint AS product, (value->>'qty')::integer AS qty FROM jsonb_array_elements(p_lines)) l
  LEFT JOIN inventory_positions i ON i.pos_product_id = l.product
  LEFT JOIN web_products w ON w.pos_product_id = l.product
  WHERE i.pos_product_id IS NULL OR i.on_hand - i.reserved - COALESCE(w.safety_stock, 0) < l.qty;
  IF v_short IS NOT NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_short;
  END IF;

  UPDATE inventory_positions i SET reserved = i.reserved + l.qty, updated_at = now()
  FROM (SELECT (value->>'productId')::bigint AS product, (value->>'qty')::integer AS qty FROM jsonb_array_elements(p_lines)) l
  WHERE i.pos_product_id = l.product;

  INSERT INTO reservations (order_id, pos_product_id, qty, expires_at)
  SELECT p_order, (value->>'productId')::bigint, (value->>'qty')::integer, p_expires FROM jsonb_array_elements(p_lines);
END;
$$;

CREATE FUNCTION commerce.release_reservation(p_order uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = commerce, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  WITH r AS (
    UPDATE reservations SET state = 'released', release_reason = p_reason
    WHERE order_id = p_order AND state = 'active'
    RETURNING pos_product_id, qty
  )
  UPDATE inventory_positions i SET reserved = i.reserved - r.qty, updated_at = now() FROM r WHERE i.pos_product_id = r.pos_product_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION commerce.apply_events(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce.place_order_reserve(uuid, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce.release_reservation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commerce.apply_events(uuid, jsonb) TO store_device;
GRANT EXECUTE ON FUNCTION commerce.place_order_reserve(uuid, jsonb, timestamptz), commerce.release_reservation(uuid, text) TO store_app;

REVOKE INSERT, UPDATE, DELETE ON commerce.catalog_categories, commerce.catalog_products, commerce.catalog_barcodes, commerce.inventory_positions, commerce.sync_inbox FROM store_device;
