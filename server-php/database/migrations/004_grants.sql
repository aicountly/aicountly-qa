-- Grant app user access to tables and sequences (required for INSERT with BIGSERIAL)
-- Run as database owner / superuser. Replace sisplorg_user with DB_USER from api/.env

GRANT SELECT, INSERT, UPDATE ON payment_records TO sisplorg_user;
GRANT SELECT, INSERT ON payment_audit_log TO sisplorg_user;

GRANT USAGE, SELECT ON SEQUENCE payment_records_id_seq TO sisplorg_user;
GRANT USAGE, SELECT ON SEQUENCE payment_audit_log_id_seq TO sisplorg_user;

-- Future objects in public schema (optional, run as object owner)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO sisplorg_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sisplorg_user;
