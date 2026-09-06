// Check the rendered homepage without connecting a browser or scheduling a job.
import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
const state = vi.hoisted(() => ({ verified: true }))
vi.mock("@/lib/cancellations/config", () => ({
  miroProductSummary: () => null,
}))
vi.mock("@/lib/cancellations/repository", () => ({
  cancellationRepository: () => ({ dashboardJobs: () => [] }),
}))
vi.mock("@/lib/cancellations/card-state", () => ({
  cancellationCardState: () => ({
    initialJob: null,
    requestScopeKey: "fixture",
  }),
}))
vi.mock("@/lib/cancellations/metrics", () => ({
  dashboardMetrics: () => ({
    verified: [],
    totals: state.verified ? [{ currency: "USD", annualCents: 24000 }] : [],
    potentialCents: 0,
    activeCount: 0,
    currency: "USD",
  }),
}))
vi.mock("@/lib/db", () => ({
  getDemoState: () => ({ status: "ACTIVE", scenario: "dark-pattern" }),
  listSubscriptions: () => [
    {
      id: "fixture",
      slug: "streammax",
      name: "StreamMax",
      amount: 29.99,
      interval: "MONTHLY",
      status: "ACTIVE",
    },
  ],
}))
vi.mock("@/app/actions", () => ({ resetDemoAction: () => undefined }))
vi.mock("@/lib/agent/repository", () => ({
  createAgentRepository: () => {
    throw Error("LEGACY_TOTAL_ACCESSED")
  },
}))
import DashboardPage from "@/app/page"
describe("dashboard presentation", () => {
  it("shows the real receipt total and labels the sample section separately", () => {
    state.verified = true
    const html = renderToStaticMarkup(createElement(DashboardPage))
    expect(html).toContain("$240.00")
    expect(html).toContain("Practice with sample subscriptions")
    expect(html).toContain("RECEIPT VERIFIED")
    expect(html).not.toContain("Available in the StreamMax demo")
    expect(html).not.toContain("$359.88")
  })
  it("starts at zero without real receipts", () => {
    state.verified = false
    const html = renderToStaticMarkup(createElement(DashboardPage))
    expect(html).toContain("No verified cancellations yet")
    expect(html).not.toContain("$240.00")
  })
})
