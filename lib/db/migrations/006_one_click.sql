-- Create one-click authorization, job, and checkpoint tables.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS one_click_authorizations (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ARMED','CONSUMED','EXPIRED')),
  uses INTEGER NOT NULL DEFAULT 0 CHECK(uses BETWEEN 0 AND 1)
);
CREATE TRIGGER IF NOT EXISTS immutable_one_click_scope BEFORE UPDATE OF payload ON one_click_authorizations
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AUTHORIZATION'); END;
CREATE TABLE IF NOT EXISTS one_click_jobs (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE REFERENCES one_click_authorizations(id),
  subscription_key TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  locked INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_click_subscription_lock ON one_click_jobs(subscription_key) WHERE locked = 1;
CREATE UNIQUE INDEX IF NOT EXISTS one_click_desktop_lock ON one_click_jobs(resource_key) WHERE locked = 1;
CREATE TABLE IF NOT EXISTS one_click_checkpoints (
  job_id TEXT NOT NULL REFERENCES one_click_jobs(id),
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(job_id, version)
);
PRAGMA user_version = 6;
COMMIT;
