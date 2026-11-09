-- Least privilege. Roles are created by the migrate script, which holds their passwords.
GRANT USAGE ON SCHEMA dash_auth, readmodel TO dashboard_app;
GRANT SELECT ON readmodel.snapshots, readmodel.status TO dashboard_app;
GRANT USAGE ON SCHEMA dash_auth, demo TO dashboard_demo;
GRANT SELECT ON demo.snapshots, demo.status TO dashboard_demo;

GRANT SELECT ON dash_auth.users TO dashboard_app, dashboard_demo;
GRANT SELECT, INSERT, UPDATE ON dash_auth.sessions TO dashboard_app, dashboard_demo;
GRANT SELECT, INSERT ON dash_auth.login_attempts TO dashboard_app, dashboard_demo;
GRANT USAGE, SELECT ON SEQUENCE dash_auth.login_attempts_id_seq TO dashboard_app, dashboard_demo;

-- A role sees only its own users and sessions.
ALTER TABLE dash_auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE dash_auth.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_real ON dash_auth.users FOR SELECT TO dashboard_app USING (scope = 'real');
CREATE POLICY users_demo ON dash_auth.users FOR SELECT TO dashboard_demo USING (scope = 'demo');
CREATE POLICY sessions_real ON dash_auth.sessions FOR ALL TO dashboard_app USING (scope = 'real') WITH CHECK (scope = 'real');
CREATE POLICY sessions_demo ON dash_auth.sessions FOR ALL TO dashboard_demo USING (scope = 'demo') WITH CHECK (scope = 'demo');

GRANT USAGE ON SCHEMA cloud, backup, sync, readmodel TO device_api;
GRANT SELECT ON cloud.stores TO device_api;
GRANT UPDATE (recovery_verifier) ON cloud.stores TO device_api;
GRANT SELECT, UPDATE ON cloud.enrollment_codes TO device_api;
GRANT SELECT, INSERT, UPDATE ON cloud.devices TO device_api;
GRANT INSERT ON cloud.audit_log TO device_api;
GRANT SELECT, INSERT, DELETE ON cloud.rate_limits TO device_api;
GRANT USAGE, SELECT ON SEQUENCE cloud.audit_log_id_seq, cloud.rate_limits_id_seq TO device_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON backup.manifests, backup.upload_sessions, backup.chunks TO device_api;
GRANT SELECT, INSERT ON backup.verifications, backup.retention_log, backup.restore_history TO device_api;
GRANT USAGE, SELECT ON SEQUENCE backup.verifications_id_seq, backup.retention_log_id_seq, backup.restore_history_id_seq TO device_api;
GRANT SELECT, INSERT, DELETE ON sync.events TO device_api;
GRANT SELECT, INSERT, UPDATE ON readmodel.snapshots, readmodel.status TO device_api;
