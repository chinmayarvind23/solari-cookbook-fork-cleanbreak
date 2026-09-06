-- Add the Browser agent's saved jobs and action history.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

ALTER TABLE agent_steps RENAME TO agent_steps_m3;
ALTER TABLE proposed_actions RENAME TO proposed_actions_m3;
ALTER TABLE cancellation_jobs RENAME TO cancellation_jobs_m3;

CREATE TABLE cancellation_jobs (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  state TEXT NOT NULL CHECK (state IN (
    'READY', 'NAVIGATING', 'AWAITING_APPROVAL', 'COMMITTING',
    'VERIFYING', 'ABORTED', 'FAILED'
  )),
  scenario TEXT NOT NULL,
  model TEXT NOT NULL,
  target_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  session_id TEXT,
  profile_id TEXT,
  recording_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    recording_status IN ('PENDING', 'AVAILABLE', 'UNAVAILABLE', 'FAILED')
  ),
  replay_url TEXT,
  latest_screenshot_path TEXT,
  steps INTEGER NOT NULL DEFAULT 0,
  retentions_encountered INTEGER NOT NULL DEFAULT 0,
  retentions_rejected INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  policy_blocks INTEGER NOT NULL DEFAULT 0,
  unsafe_actions_executed INTEGER NOT NULL DEFAULT 0 CHECK (unsafe_actions_executed = 0),
  duration_ms INTEGER,
  browser_released INTEGER NOT NULL DEFAULT 0 CHECK (browser_released IN (0, 1)),
  client_closed INTEGER NOT NULL DEFAULT 0 CHECK (client_closed IN (0, 1)),
  profile_state_saved INTEGER NOT NULL DEFAULT 0 CHECK (profile_state_saved IN (0, 1)),
  error_code TEXT,
  error_message TEXT,
  approvals_requested INTEGER NOT NULL DEFAULT 0,
  approvals_granted INTEGER NOT NULL DEFAULT 0,
  approvals_aborted INTEGER NOT NULL DEFAULT 0,
  approval_to_commit_ms INTEGER,
  commit_attempts INTEGER NOT NULL DEFAULT 0,
  duplicate_commit_requests_blocked INTEGER NOT NULL DEFAULT 0,
  stale_approvals_blocked INTEGER NOT NULL DEFAULT 0,
  changed_terms_reapproval_required INTEGER NOT NULL DEFAULT 0,
  destructive_clicks_executed INTEGER NOT NULL DEFAULT 0 CHECK (destructive_clicks_executed <= 1),
  automatic_destructive_retries INTEGER NOT NULL DEFAULT 0 CHECK (automatic_destructive_retries = 0),
  commits_with_unknown_outcome INTEGER NOT NULL DEFAULT 0
);

INSERT INTO cancellation_jobs (
  id, subscription_id, state, scenario, model, target_url, created_at,
  completed_at, session_id, profile_id, recording_status, replay_url,
  latest_screenshot_path, steps, retentions_encountered,
  retentions_rejected, model_calls, input_tokens, output_tokens,
  policy_blocks, unsafe_actions_executed, duration_ms, browser_released,
  client_closed, profile_state_saved, error_code, error_message
)
SELECT
  id, subscription_id, state, scenario, model, target_url, created_at,
  completed_at, session_id, profile_id, recording_status, replay_url,
  latest_screenshot_path, steps, retentions_encountered,
  retentions_rejected, model_calls, input_tokens, output_tokens,
  policy_blocks, unsafe_actions_executed, duration_ms, browser_released,
  client_closed, profile_state_saved, error_code, error_message
FROM cancellation_jobs_m3;

CREATE TABLE agent_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cancellation_jobs(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  observation_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  action_type TEXT,
  target_id TEXT,
  target_role TEXT,
  target_name TEXT,
  reasoning TEXT,
  confidence REAL,
  risk TEXT,
  policy_result TEXT NOT NULL,
  policy_reason TEXT NOT NULL,
  screenshot_path TEXT,
  duration_ms INTEGER NOT NULL,
  UNIQUE(job_id, step_number)
);

INSERT INTO agent_steps SELECT * FROM agent_steps_m3;

CREATE TABLE proposed_actions (
  job_id TEXT PRIMARY KEY REFERENCES cancellation_jobs(id) ON DELETE CASCADE,
  detected_at TEXT NOT NULL,
  target_role TEXT NOT NULL,
  target_name TEXT NOT NULL,
  current_url TEXT NOT NULL,
  fee_cents INTEGER,
  access_until TEXT,
  visible_terms_json TEXT NOT NULL,
  screenshot_path TEXT,
  fingerprint TEXT,
  service_name TEXT,
  service_domain TEXT,
  plan_name TEXT,
  recurring_price_cents INTEGER,
  currency TEXT,
  interval TEXT,
  annual_savings_cents INTEGER,
  current_status TEXT,
  action_text TEXT,
  observed_at TEXT,
  snapshot_json TEXT
);

INSERT INTO proposed_actions (
  job_id, detected_at, target_role, target_name, current_url, fee_cents,
  access_until, visible_terms_json, screenshot_path
)
SELECT
  job_id, detected_at, target_role, target_name, current_url, fee_cents,
  access_until, visible_terms_json, screenshot_path
FROM proposed_actions_m3;

DROP TABLE agent_steps_m3;
DROP TABLE proposed_actions_m3;
DROP TABLE cancellation_jobs_m3;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cancellation_jobs(id) ON DELETE CASCADE,
  action_fingerprint TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPROVED', 'SUPERSEDED')),
  UNIQUE(job_id, action_fingerprint)
);

CREATE TABLE commit_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES cancellation_jobs(id) ON DELETE CASCADE,
  approval_id TEXT REFERENCES approvals(id),
  action_fingerprint TEXT NOT NULL,
  armed_at TEXT NOT NULL,
  final_action_attempted_at TEXT,
  click_started_at TEXT,
  click_returned_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('CLICK_RETURNED', 'OUTCOME_UNKNOWN', 'NOT_EXECUTED')),
  session_id TEXT,
  pre_screenshot_path TEXT,
  post_screenshot_path TEXT,
  recording_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    recording_status IN ('PENDING', 'AVAILABLE', 'UNAVAILABLE', 'FAILED')
  ),
  replay_url TEXT,
  browser_released INTEGER NOT NULL DEFAULT 0 CHECK (browser_released IN (0, 1)),
  client_closed INTEGER NOT NULL DEFAULT 0 CHECK (client_closed IN (0, 1)),
  profile_state_saved INTEGER NOT NULL DEFAULT 0 CHECK (profile_state_saved IN (0, 1)),
  safe_error_code TEXT,
  safe_error_message TEXT
);

CREATE INDEX idx_cancellation_jobs_created_at
  ON cancellation_jobs(created_at DESC);
CREATE INDEX idx_agent_steps_job ON agent_steps(job_id, step_number);
CREATE INDEX idx_approvals_job ON approvals(job_id, approved_at DESC);

PRAGMA user_version = 2;
COMMIT;
PRAGMA foreign_keys = ON;
