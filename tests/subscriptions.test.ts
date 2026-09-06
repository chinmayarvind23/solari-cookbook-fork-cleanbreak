// Checks recurring-cost calculations and currency formatting.
import { describe, expect, it } from "vitest"

import { annualCost, monthlyEquivalent } from "@/lib/subscriptions"

describe("subscription calculations", () => {
  it("annualizes a monthly subscription", () => {
    expect(annualCost(29.99, "MONTHLY")).toBeCloseTo(359.88)
  })

  it("does not annualize an annual subscription twice", () => {
    expect(annualCost(120, "YEARLY")).toBe(120)
  })

  it("calculates the monthly equivalent of an annual plan", () => {
    expect(
      monthlyEquivalent({
        id: "annual",
        name: "Annual",
        slug: "annual",
        url: "https://example.com",
        domain: "example.com",
        amount: 120,
        currency: "USD",
        interval: "YEARLY",
        status: "ACTIVE",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    ).toBe(10)
  })
})
