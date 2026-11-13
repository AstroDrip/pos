-- Least privilege. Roles are created by the migrate script, which holds their passwords.
-- The web role cannot write anything copied from the POS, cannot change stock numbers, and cannot rewrite history.
GRANT USAGE ON SCHEMA commerce TO store_app, store_device;

GRANT SELECT ON commerce.catalog_categories, commerce.catalog_products, commerce.catalog_barcodes TO store_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON commerce.product_images TO store_app;
GRANT SELECT, INSERT, UPDATE ON commerce.web_categories, commerce.web_products, commerce.product_requests, commerce.banners TO store_app;
GRANT SELECT ON commerce.inventory_positions, commerce.reservations TO store_app;
GRANT SELECT, UPDATE ON commerce.stock_discrepancies TO store_app;
GRANT SELECT, INSERT, UPDATE ON commerce.delivery_areas, commerce.orders, commerce.payments, commerce.refunds TO store_app;
GRANT SELECT, UPDATE ON commerce.store_settings TO store_app;
GRANT SELECT, INSERT ON commerce.order_lines, commerce.order_status_history TO store_app;
GRANT SELECT, INSERT, UPDATE ON commerce.payment_events, commerce.idempotency_keys TO store_app;
GRANT SELECT ON commerce.staff_roles, commerce.permissions, commerce.staff_role_permissions, commerce.staff_users TO store_app;
GRANT SELECT, INSERT, UPDATE ON commerce.staff_sessions TO store_app;
GRANT SELECT, INSERT ON commerce.login_attempts, commerce.audit_log TO store_app;
GRANT SELECT, INSERT, DELETE ON commerce.rate_limits TO store_app;
GRANT SELECT ON commerce.devices, commerce.sync_inbox TO store_app;
GRANT SELECT, INSERT ON commerce.pos_commands TO store_app;
GRANT USAGE, SELECT ON SEQUENCE commerce.order_status_history_id_seq, commerce.login_attempts_id_seq, commerce.audit_log_id_seq, commerce.rate_limits_id_seq, commerce.pos_commands_id_seq TO store_app;

GRANT SELECT, INSERT, UPDATE ON commerce.catalog_categories, commerce.catalog_products, commerce.inventory_positions TO store_device;
GRANT SELECT, INSERT, DELETE ON commerce.catalog_barcodes TO store_device;
GRANT SELECT, UPDATE ON commerce.enrollment_codes, commerce.pos_commands TO store_device;
GRANT SELECT, INSERT, UPDATE ON commerce.devices, commerce.sync_inbox TO store_device;
GRANT SELECT ON commerce.store_settings TO store_device;
GRANT INSERT ON commerce.audit_log TO store_device;
GRANT SELECT, INSERT, DELETE ON commerce.rate_limits TO store_device;
GRANT USAGE, SELECT ON SEQUENCE commerce.audit_log_id_seq, commerce.rate_limits_id_seq TO store_device;
