// Keep real receipt totals separate from samples, retries, and damaged evidence.
import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createDatabase } from "@/lib/db"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { dashboardMetrics, verifiedReceipt } from "@/lib/cancellations/metrics"
import { digest, productConfig } from "@/lib/cancellations/config"
import { publicJob } from "@/lib/cancellations/public"
import { CancellationCard } from "@/components/cancellation-card"
import type { Job, Observation } from "@/lib/cancellations/state"

function savedJob(
  key = "subscription-one",
  amount = 24000,
  interval: "YEARLY" | "MONTHLY" = "YEARLY",
  currency = "USD",
): Job {
  const db = createDatabase(":memory:")
  try {
    const scope = {
      ...productConfig("streammax").scope,
      provider: "miro" as const,
      providerOrigin: "https://miro.com",
      subscriptionKey: key,
      expectedAmountCents: amount,
      interval,
      currency,
    }
    const job = cancellationRepository(db).create(scope, "metrics-request")
    const observation = {
      scope,
      matched: true,
      authenticated: true,
      confidence: 1,
      surface: "BILLING_PAGE",
      ambiguous: false,
      billing: {
        subscriptionStatus: "SCHEDULED",
        renewalStatus: "OFF",
        nextChargePresent: false,
        nextChargeAmountCents: null,
        nextChargeDate: null,
        accessUntil: "2026-09-18",
      },
    } as Observation
    Object.assign(job, {
      state: "VERIFIED",
      authorizationStatus: "CONSUMED",
      authorizationUses: 1,
      destructiveClicksAttempted: 1,
      destructiveClicksExecuted: 1,
      verification: {
        result: "VERIFIED",
        observation,
        contextId: "fresh-read",
        fresh: true,
        at: job.updatedAt,
      },
    })
    const payload = {
      jobId: job.id,
      authorization: job.authorization,
      after: job.verification,
      annualizedSavingsCents: amount * (interval === "MONTHLY" ? 12 : 1),
      destructiveClicksExecuted: 1,
      authorizationUses: 1,
      automaticDestructiveRetries: 0,
      unsafeActionsExecuted: 0,
    }
    job.receipt = { payload, digest: digest(payload) }
    return job
  } finally {
    db.close()
  }
}

describe("real cancellation dashboard totals", () => {
  it("counts the verified Miro yearly renewal once", () => {
    const job = savedJob()
    expect(verifiedReceipt(job)).toBe(true)
    const m = dashboardMetrics([job, structuredClone(job)], {
      subscriptionKey: job.authorization.subscriptionKey,
      amountCents: 24000,
      currency: "USD",
      interval: "YEARLY",
    })
    expect(m.totals).toEqual([{ currency: "USD", annualCents: 24000 }])
    expect(m.potentialCents).toBe(0)
    expect(m.activeCount).toBe(0)
  })
  it("annualizes monthly amounts and keeps currencies separate", () => {
    expect(
      dashboardMetrics([
        savedJob("a", 2000, "MONTHLY"),
        savedJob("b", 12000, "YEARLY", "EUR"),
      ]).totals,
    ).toEqual([
      { currency: "EUR", annualCents: 12000 },
      { currency: "USD", annualCents: 24000 },
    ])
  })
  it("excludes fixture jobs even when they have a receipt", () => {
    const job = savedJob()
    job.authorization.provider = "streammax"
    expect(dashboardMetrics([job]).totals).toEqual([])
  })
  it.each(["FAILED", "INCONCLUSIVE", "NOT_VERIFIED", "VERIFYING"] as const)(
    "excludes %s jobs",
    (state) => {
      const job = savedJob()
      job.state = state
      expect(dashboardMetrics([job]).totals).toEqual([])
    },
  )
  it("rejects a tampered receipt and a missing receipt", () => {
    const job = savedJob()
    job.receipt!.payload.annualizedSavingsCents = 999999
    expect(verifiedReceipt(job)).toBe(false)
    job.receipt = null
    expect(verifiedReceipt(job)).toBe(false)
  })
  it("rejects stale or active billing evidence", () => {
    const job = savedJob()
    job.verification!.fresh = false
    expect(verifiedReceipt(job)).toBe(false)
    job.verification!.fresh = true
    job.verification!.observation!.billing.renewalStatus = "ON"
    expect(verifiedReceipt(job)).toBe(false)
  })
  it("lets a newer outcome supersede an older receipt", () => {
    const old = savedJob(),
      fresh = structuredClone(old)
    old.updatedAt = "2026-09-01T00:00:00Z"
    fresh.updatedAt = "2026-09-02T00:00:00Z"
    fresh.state = "INCONCLUSIVE"
    expect(dashboardMetrics([old, fresh]).totals).toEqual([])
  })
  it("uses the configured real renewal for potential savings", () => {
    expect(
      dashboardMetrics([], {
        subscriptionKey: "new",
        amountCents: 24000,
        currency: "USD",
        interval: "YEARLY",
      }).potentialCents,
    ).toBe(24000)
  })
  it("shows the completed Miro outcome without an authorization prompt", () => {
    const job = savedJob()
    const html = renderToStaticMarkup(
      createElement(CancellationCard, {
        provider: "miro",
        planName: "Business Trial",
        amountCents: 24000,
        currency: "USD",
        interval: "YEARLY",
        enabled: false,
        initialJob: publicJob(job),
      }),
    )
    expect(html).toContain("Cancellation verified")
    expect(html).toContain("Avoided renewal")
    expect(html).not.toContain("Recorded autonomous cancellation")
    expect(html).not.toContain("Authorize one cancellation attempt")
  })
  it("reads stored jobs without changing their state", () => {
    const db = createDatabase(":memory:")
    try {
      const repo = cancellationRepository(db)
      const job = repo.create(productConfig("streammax").scope, "read")
      expect(repo.dashboardJobs()).toEqual([job])
      expect(repo.load(job.id)?.version).toBe(0)
    } finally {
      db.close()
    }
  })
})
