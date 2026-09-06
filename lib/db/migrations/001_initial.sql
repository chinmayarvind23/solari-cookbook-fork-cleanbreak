-- Create the initial subscription and fictional provider tables.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('MONTHLY', 'YEARLY')),
  next_renewal_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_fixture (
  id TEXT PRIMARY KEY CHECK (id = 'streammax'),
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  scenario TEXT NOT NULL,
  auto_renew INTEGER NOT NULL CHECK (auto_renew IN (0, 1)),
  next_charge_date TEXT,
  access_until TEXT NOT NULL,
  last_message TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS solari_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  session_id TEXT,
  profile_id TEXT,
  profile_created INTEGER NOT NULL DEFAULT 0 CHECK (profile_created IN (0, 1)),
  target_url TEXT NOT NULL,
  page_title TEXT,
  observed_text TEXT,
  screenshot_path TEXT,
  recording_status TEXT NOT NULL CHECK (
    recording_status IN ('PENDING', 'AVAILABLE', 'UNAVAILABLE', 'FAILED')
  ),
  replay_url TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  browser_released INTEGER NOT NULL DEFAULT 0 CHECK (browser_released IN (0, 1)),
  client_closed INTEGER NOT NULL DEFAULT 0 CHECK (client_closed IN (0, 1)),
  profile_state_saved INTEGER NOT NULL DEFAULT 0 CHECK (profile_state_saved IN (0, 1)),
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_solari_runs_created_at
  ON solari_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS cancellation_jobs (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  state TEXT NOT NULL CHECK (state IN ('READY', 'NAVIGATING', 'AWAITING_APPROVAL', 'FAILED')),
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
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS agent_steps (
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

CREATE TABLE IF NOT EXISTS proposed_actions (
  job_id TEXT PRIMARY KEY REFERENCES cancellation_jobs(id) ON DELETE CASCADE,
  detected_at TEXT NOT NULL,
  target_role TEXT NOT NULL,
  target_name TEXT NOT NULL,
  current_url TEXT NOT NULL,
  fee_cents INTEGER,
  access_until TEXT,
  visible_terms_json TEXT NOT NULL,
  screenshot_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_cancellation_jobs_created_at
  ON cancellation_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_steps_job
  ON agent_steps(job_id, step_number);
