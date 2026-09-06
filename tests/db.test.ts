// Regression checks for database migrations and fictional seed data.
import type { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  confirmDemoCancellation,
  createDatabase,
  getDemoState,
  listSubscriptions,
  resetDemo,
} from "@/lib/db"

describe("StreamMax fixture persistence", () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = createDatabase(":memory:")
  })

  afterEach(() => {
    database.close()
  })

  it("seeds the three PRD subscriptions and dashboard totals", () => {
    const subscriptions = listSubscriptions(database)

    expect(subscriptions).toHaveLength(3)
    expect(subscriptions.map((subscription) => subscription.amount)).toEqual([
      29.99, 24, 16,
    ])
  })

  it("persists cancellation truth for a later browser session", () => {
    resetDemo("dark-pattern", database)
    confirmDemoCancellation(database)

    expect(getDemoState(database)).toMatchObject({
      status: "CANCELED",
      autoRenew: false,
      nextChargeDate: null,
    })
    expect(listSubscriptions(database)[0].status).toBe("CANCELED")
  })

  it("preserves active account truth after ambiguous confirmation", () => {
    resetDemo("ambiguous-confirmation", database)
    confirmDemoCancellation(database)

    expect(getDemoState(database)).toMatchObject({
      status: "ACTIVE",
      autoRenew: true,
      nextChargeDate: "2026-09-28",
      lastMessage: "Request received.",
    })
  })

  it("does not mutate an already-canceled fixture on confirmation", () => {
    const before = resetDemo("already-canceled", database)
    const after = confirmDemoCancellation(database)

    expect(after).toEqual(before)
  })

  it("resets canceled fixture state to the selected known scenario", () => {
    resetDemo("happy-path", database)
    confirmDemoCancellation(database)
    const reset = resetDemo("cancellation-fee", database)

    expect(reset).toMatchObject({
      scenario: "cancellation-fee",
      status: "ACTIVE",
      autoRenew: true,
      nextChargeDate: "2026-09-28",
      lastMessage: null,
    })
  })
})
