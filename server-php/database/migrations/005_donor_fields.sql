-- Donor identity fields for cross-domain donation flows (e.g. positivetree.ngo)
-- The Razorpay merchant account lives on sispl.org, but donations may originate
-- from partner NGO sites. We store the donor's contact details so receipts and
-- compliance reports can be reconciled against the upstream cause/project.
-- Run once on existing databases.

ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS donor_name  VARCHAR(200);
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS donor_email VARCHAR(254);
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS donor_phone VARCHAR(32);
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS donor_pan   VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_payment_donor_email_created
  ON payment_records (donor_email, created_at DESC);
