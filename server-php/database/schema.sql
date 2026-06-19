-- Payment audit trail schema for SISPL (PostgreSQL)
-- Run once: psql -U your_user -d sispl_payments -f schema.sql

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $func$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS payment_records (
  id BIGSERIAL PRIMARY KEY,
  public_reference VARCHAR(32) NOT NULL,
  client_name VARCHAR(200) NOT NULL,
  project_name VARCHAR(200) NOT NULL,
  invoice_ref VARCHAR(100),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL CHECK (currency IN ('INR', 'USD')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'initiated', 'completed', 'failed', 'cancelled')),
  ip_hash CHAR(64) NOT NULL,
  user_agent_hash CHAR(64),
  request_id CHAR(36) NOT NULL,
  csrf_token_hash CHAR(64),
  gateway_url TEXT,
  razorpay_order_id VARCHAR(64),
  razorpay_payment_id VARCHAR(64),
  donor_name VARCHAR(200),
  donor_email VARCHAR(254),
  donor_phone VARCHAR(32),
  donor_pan VARCHAR(10),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payment_public_reference UNIQUE (public_reference),
  CONSTRAINT uq_payment_request_id UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_status_created ON payment_records (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_client_created ON payment_records (client_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_project_created ON payment_records (project_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_currency_created ON payment_records (currency, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_ip_hash_created ON payment_records (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_razorpay_order_id ON payment_records (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_donor_email_created ON payment_records (donor_email, created_at DESC);

DROP TRIGGER IF EXISTS payment_records_updated_at ON payment_records;
CREATE TRIGGER payment_records_updated_at
  BEFORE UPDATE ON payment_records
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS payment_audit_log (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payment_records (id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_payload JSONB,
  actor VARCHAR(100) NOT NULL DEFAULT 'system',
  ip_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_payment_id ON payment_audit_log (payment_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_created ON payment_audit_log (event_type, created_at DESC);

COMMENT ON TABLE payment_records IS 'Razorpay payment intents and completed transactions';
COMMENT ON TABLE payment_audit_log IS 'Immutable-style audit trail for payment lifecycle events';

-- After creating tables, grant the API user access (replace sisplorg_user with DB_USER):
-- \i database/migrations/004_grants.sql
