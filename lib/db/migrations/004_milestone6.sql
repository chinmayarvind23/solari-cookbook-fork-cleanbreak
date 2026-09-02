BEGIN IMMEDIATE;

CREATE TABLE receipt_before_evidence (
  job_id TEXT PRIMARY KEY REFERENCES cancellation_jobs(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  subscription_status TEXT NOT NULL,
  auto_renew INTEGER CHECK (auto_renew IN (0, 1)),
  recurring_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  recurring_interval TEXT NOT NULL,
  next_charge_date TEXT,
  observed_url TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE TABLE cleanbreak_receipts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES cancellation_jobs(id),
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  created_at TEXT NOT NULL,
  canonical_version TEXT NOT NULL CHECK (canonical_version = '1'),
  canonical_json TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
);

CREATE TABLE receipt_generation_failures (
  job_id TEXT PRIMARY KEY REFERENCES cancellation_jobs(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 1,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  failed_at TEXT NOT NULL
);

CREATE INDEX idx_cleanbreak_receipts_subscription_created
  ON cleanbreak_receipts(subscription_id, created_at DESC);

CREATE TRIGGER cleanbreak_receipts_immutable_update
BEFORE UPDATE ON cleanbreak_receipts
BEGIN
  SELECT RAISE(ABORT, 'CleanBreak receipts are immutable');
END;

CREATE TRIGGER cleanbreak_receipts_immutable_delete
BEFORE DELETE ON cleanbreak_receipts
BEGIN
  SELECT RAISE(ABORT, 'CleanBreak receipts are immutable');
END;

PRAGMA user_version = 4;
COMMIT;
