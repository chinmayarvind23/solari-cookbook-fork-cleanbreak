import { mkdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  cancellationOutcome,
  resetStateForScenario,
  type DemoScenario,
  type DemoState,
} from "@/lib/demo"
import type { Subscription } from "@/lib/subscriptions"

const DEFAULT_DATABASE_PATH = "./data/cleanbreak.db"
const initialMigrationPath = join(
  process.cwd(),
  "lib",
  "db",
  "migrations",
  "001_initial.sql",
)
const milestone4MigrationPath = join(
  process.cwd(),
  "lib",
  "db",
  "migrations",
  "002_milestone4.sql",
)
const milestone5MigrationPath = join(
  process.cwd(),
  "lib",
  "db",
  "migrations",
  "003_milestone5.sql",
)
const milestone6MigrationPath = join(
  process.cwd(),
  "lib",
  "db",
  "migrations",
  "004_milestone6.sql",
)

type SubscriptionRow = {
  id: string
  name: string
  slug: string
  url: string
  domain: string
  amount_cents: number
  currency: string
  interval: "MONTHLY" | "YEARLY"
  next_renewal_date: string | null
  status: "ACTIVE" | "CANCELED"
  created_at: string
  updated_at: string
}

type DemoRow = {
  scenario: DemoScenario
  status: "ACTIVE" | "CANCELED"
  auto_renew: number
  next_charge_date: string | null
  access_until: string
  last_message: string | null
  updated_at: string
}

function databasePath(): string {
  const configured =
    process.env.CLEANBREAK_DATABASE_PATH ?? DEFAULT_DATABASE_PATH
  return isAbsolute(configured)
    ? configured
    : resolve(/* turbopackIgnore: true */ process.cwd(), configured)
}

export function createDatabase(path = databasePath()): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true })
  }

  const database = new DatabaseSync(path)
  database.exec("PRAGMA foreign_keys = ON;")
  database.exec(readFileSync(initialMigrationPath, "utf8"))
  const version = Number(
    (database.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  )
  if (version < 2) {
    database.exec(readFileSync(milestone4MigrationPath, "utf8"))
  }
  if (version < 3) {
    database.exec(readFileSync(milestone5MigrationPath, "utf8"))
  }
  if (version < 4) {
    database.exec(readFileSync(milestone6MigrationPath, "utf8"))
  }
  seedDatabase(database)
  return database
}

function seedDatabase(database: DatabaseSync): void {
  const now = "2026-09-02T12:00:00.000Z"
  const insert = database.prepare(`
    INSERT OR IGNORE INTO subscriptions (
      id, name, slug, url, domain, amount_cents, currency, interval,
      next_renewal_date, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const subscriptions = [
    [
      "sub_streammax",
      "StreamMax",
      "streammax",
      "/demo/streammax/account",
      "streammax.example",
      2999,
      "USD",
      "MONTHLY",
      "2026-09-28",
      "ACTIVE",
      now,
      now,
    ],
    [
      "sub_designpro",
      "DesignPro",
      "designpro",
      "https://designpro.example/account",
      "designpro.example",
      2400,
      "USD",
      "MONTHLY",
      "2026-09-19",
      "ACTIVE",
      now,
      now,
    ],
    [
      "sub_newsplus",
      "NewsPlus",
      "newsplus",
      "https://newsplus.example/account",
      "newsplus.example",
      1600,
      "USD",
      "MONTHLY",
      "2026-09-14",
      "ACTIVE",
      now,
      now,
    ],
  ] as const

  database.exec("BEGIN")
  try {
    for (const subscription of subscriptions) {
      insert.run(...subscription)
    }

    database
      .prepare(
        `INSERT OR IGNORE INTO demo_fixture (
          id, subscription_id, scenario, auto_renew, next_charge_date,
          access_until, last_message, updated_at
        ) VALUES ('streammax', 'sub_streammax', 'dark-pattern', 1, ?, ?, NULL, ?)`,
      )
      .run("2026-09-28", "2026-09-28", now)
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    domain: row.domain,
    amount: row.amount_cents / 100,
    currency: row.currency,
    interval: row.interval,
    nextRenewalDate: row.next_renewal_date ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listSubscriptions(database = getDatabase()): Subscription[] {
  const rows = database
    .prepare("SELECT * FROM subscriptions ORDER BY amount_cents DESC")
    .all() as SubscriptionRow[]

  return rows.map(toSubscription)
}

export function getStreamMaxSubscription(
  database = getDatabase(),
): Subscription {
  const row = database
    .prepare("SELECT * FROM subscriptions WHERE id = 'sub_streammax'")
    .get() as SubscriptionRow | undefined

  if (!row) {
    throw new Error("StreamMax demo subscription is missing")
  }

  return toSubscription(row)
}

export function upsertSubscription(
  subscription: Subscription,
  database = getDatabase(),
): void {
  database
    .prepare(
      `INSERT INTO subscriptions (
        id, name, slug, url, domain, amount_cents, currency, interval,
        next_renewal_date, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        slug = excluded.slug,
        url = excluded.url,
        domain = excluded.domain,
        amount_cents = excluded.amount_cents,
        currency = excluded.currency,
        interval = excluded.interval,
        next_renewal_date = excluded.next_renewal_date,
        status = excluded.status,
        updated_at = excluded.updated_at`,
    )
    .run(
      subscription.id,
      subscription.name,
      subscription.slug,
      subscription.url,
      subscription.domain,
      Math.round(subscription.amount * 100),
      subscription.currency,
      subscription.interval,
      subscription.nextRenewalDate ?? null,
      subscription.status,
      subscription.createdAt,
      subscription.updatedAt,
    )
}

export function getDemoState(database = getDatabase()): DemoState {
  const row = database
    .prepare(
      `SELECT demo_fixture.*, subscriptions.status
       FROM demo_fixture
       JOIN subscriptions ON subscriptions.id = demo_fixture.subscription_id
       WHERE demo_fixture.id = 'streammax'`,
    )
    .get() as DemoRow | undefined

  if (!row) {
    throw new Error("StreamMax demo fixture is missing")
  }

  return {
    scenario: row.scenario,
    status: row.status,
    autoRenew: Boolean(row.auto_renew),
    nextChargeDate: row.next_charge_date,
    accessUntil: row.access_until,
    lastMessage: row.last_message,
    updatedAt: row.updated_at,
  }
}

export function resetDemo(
  scenario: DemoScenario,
  database = getDatabase(),
): DemoState {
  const next = resetStateForScenario(scenario)

  database.exec("BEGIN")
  try {
    database
      .prepare(
        `UPDATE subscriptions
         SET status = ?, next_renewal_date = ?, updated_at = ?
         WHERE id = 'sub_streammax'`,
      )
      .run(next.status, next.nextChargeDate, next.updatedAt)
    database
      .prepare(
        `UPDATE demo_fixture
         SET scenario = ?, auto_renew = ?, next_charge_date = ?,
             access_until = ?, last_message = ?, updated_at = ?
         WHERE id = 'streammax'`,
      )
      .run(
        next.scenario,
        Number(next.autoRenew),
        next.nextChargeDate,
        next.accessUntil,
        next.lastMessage,
        next.updatedAt,
      )
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }

  return next
}

export function confirmDemoCancellation(database = getDatabase()): DemoState {
  const current = getDemoState(database)

  if (current.status === "CANCELED") {
    return current
  }

  const outcome = cancellationOutcome(current.scenario)
  const updatedAt = new Date().toISOString()

  database.exec("BEGIN")
  try {
    database
      .prepare(
        `UPDATE subscriptions
         SET status = ?, next_renewal_date = ?, updated_at = ?
         WHERE id = 'sub_streammax'`,
      )
      .run(outcome.status, outcome.nextChargeDate, updatedAt)
    database
      .prepare(
        `UPDATE demo_fixture
         SET auto_renew = ?, next_charge_date = ?, last_message = ?, updated_at = ?
         WHERE id = 'streammax'`,
      )
      .run(
        Number(outcome.autoRenew),
        outcome.nextChargeDate,
        outcome.lastMessage,
        updatedAt,
      )
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }

  return getDemoState(database)
}

const globalForDatabase = globalThis as typeof globalThis & {
  cleanBreakDatabase?: DatabaseSync
}

export function getDatabase(): DatabaseSync {
  globalForDatabase.cleanBreakDatabase ??= createDatabase()
  return globalForDatabase.cleanBreakDatabase
}
