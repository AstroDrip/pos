-- The one place availability is worked out: on hand minus reserved minus safety stock, never below zero.
-- NULL means the POS has not reported this product yet. It is not the same as zero.
CREATE VIEW commerce.product_availability AS
SELECT w.pos_product_id,
       CASE WHEN i.pos_product_id IS NULL THEN NULL ELSE GREATEST(i.on_hand - i.reserved - w.safety_stock, 0) END AS available
FROM commerce.web_products w
LEFT JOIN commerce.inventory_positions i ON i.pos_product_id = w.pos_product_id;

GRANT SELECT ON commerce.product_availability TO store_app;
