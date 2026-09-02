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
