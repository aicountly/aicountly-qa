-- Razorpay columns for existing PostgreSQL installs (safe to re-run)
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(64);
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_payment_razorpay_order_id ON payment_records (razorpay_order_id);
