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
