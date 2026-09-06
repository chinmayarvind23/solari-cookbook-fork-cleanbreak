// Read only matching Miro billing responses and discard unrelated account fields.
import "server-only"
import type { Page, Response } from "playwright-core"
import { z } from "zod"

// Observed in Miro's own Billing page GET responses. Not a guessed cancellation
// endpoint: this module never sends any request. Strip all unrelated/private data.
const schema = z.object({
  trialType: z.literal("BUSINESS_TRIAL"),
  customer: z.object({
    currencyChangeScheduled: z.literal(false),
    subscription: z.object({
      status: z.enum(["trialing", "active", "canceled"]),
      cancelAtPeriodEnd: z.boolean(),
      trialExpirationDate: z.number().positive().finite(),
      periodEnd: z.number().positive().finite(),
      immediateCancellationAllowed: z.boolean(),
      plan: z.object({
        currency: z.enum(["usd", "eur", "gbp"]),
        interval: z.enum(["year", "month"]),
      }),
    }),
  }),
})
function date(value: number) {
  const milliseconds = value >= 1e12 ? value : value * 1000
  if (
    milliseconds < Date.UTC(2000, 0, 1) ||
    milliseconds > Date.UTC(2100, 0, 1)
  )
    throw new Error("INVALID_BILLING_DATE")
  return new Date(milliseconds).toISOString().slice(0, 10)
}
export function decodeMiroBillingResponse(value: unknown) {
  const raw = schema.parse(value),
    sub = raw.customer.subscription
  return {
    provider: "miro" as const,
    plan: "BUSINESS_TRIAL" as const,
    currency: sub.plan.currency.toUpperCase(),
    interval:
      sub.plan.interval === "year" ? ("YEARLY" as const) : ("MONTHLY" as const),
    status: sub.status,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    trialEnds: date(sub.trialExpirationDate),
    periodEnd: date(sub.periodEnd),
    immediateCancellationAllowed: sub.immediateCancellationAllowed,
  }
}
export type MiroBillingResponse = ReturnType<typeof decodeMiroBillingResponse>
export function watchMiroBilling(page: Page, configuredUrl: string) {
  const configured = new URL(configuredUrl)
  const company = configured.pathname.match(
    /^\/app\/settings\/company\/([^/]+)\/billing(?:\/subscription)?\/?$/,
  )?.[1]
  if (
    configured.origin !== "https://miro.com" ||
    !company ||
    configured.search ||
    configured.hash
  )
    throw new Error("MIRO_CONFIG_REQUIRED")
  let billing: MiroBillingResponse | null = null,
    failed = false
  const pending = new Set<Promise<void>>()
  const onResponse = (response: Response) => {
    const url = new URL(response.url())
    // Exact configured receiver/account. Plans catalogs and other accounts do
    // not count as subscription state, even when they contain matching values.
    if (
      url.origin !== "https://miro.com" ||
      url.username ||
      url.password ||
      url.hash ||
      response.request().method() !== "GET" ||
      !new RegExp(
        `^/api/v1/billing/receivers/${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/$`,
      ).test(url.pathname)
    )
      return
    // Miro's observed GET includes a query string. It is transport-only data:
    // never logged, persisted, followed or used to expand the exact account path.
    const task = (async () => {
      try {
        if (
          response.status() !== 200 ||
          !(response.headers()["content-type"] ?? "").includes(
            "application/json",
          )
        )
          throw new Error()
        const body = await response.body()
        if (body.byteLength > 1024 * 1024) throw new Error()
        billing = decodeMiroBillingResponse(JSON.parse(body.toString("utf8")))
      } catch {
        billing = null
        failed = true
      }
    })()
    pending.add(task)
    void task.finally(() => pending.delete(task))
  }
  page.on("response", onResponse)
  return {
    async read() {
      await Promise.all(pending)
      return failed ? null : billing
    },
    reset() {
      billing = null
      failed = false
    },
    close() {
      page.off("response", onResponse)
    },
  }
}
