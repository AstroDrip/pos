// Who may read the audit log and the books check, indexes to search it, and an id for this till.
// The admin role only: the supervisor role does not get these by default.
export const sql = `
CREATE INDEX ix_audit_at ON audit_log(at);
CREATE INDEX ix_audit_action ON audit_log(action);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX ix_audit_user ON audit_log(user_id);
INSERT INTO permissions (code, description) VALUES
  ('audit.view',     'Read the audit log'),
  ('audit.export',   'Export the audit log'),
  ('integrity.view', 'Run and review the books check');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'admin' AND p.code IN ('audit.view', 'audit.export', 'integrity.view');
INSERT INTO settings (key, value) VALUES ('device_id', lower(hex(randomblob(16))));
`;
