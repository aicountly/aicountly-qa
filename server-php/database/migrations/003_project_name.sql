-- Add project name to payment records (run once on existing databases)
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS project_name VARCHAR(200);

UPDATE payment_records
SET project_name = client_name
WHERE project_name IS NULL OR TRIM(project_name) = '';

ALTER TABLE payment_records ALTER COLUMN project_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_project_created ON payment_records (project_name, created_at DESC);
