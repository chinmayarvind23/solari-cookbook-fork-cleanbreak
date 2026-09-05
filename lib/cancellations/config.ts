import "server-only"
import { createHash } from "node:crypto"
import { canonicalJson } from "@/lib/receipts/canonical"
import { readDesktopConfig } from "@/lib/desktop/config"
import { isMiroProvider } from "@/lib/desktop/miro"
import type { Provider, Scope } from "./state"
export const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex")
export function liveEnabled(env: Readonly<Record<string, string | undefined>>) {
  return (
    env.CLEANBREAK_DRY_RUN === "false" &&
    env.CLEANBREAK_REAL_PROVIDER_AUTHORIZED === "true" &&
    env.CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL === "true"
  )
}
export function productConfig(provider: Provider, env = process.env) {
  if (provider === "streammax") {
    const origin = new URL(env.CLEANBREAK_APP_ORIGIN || "http://localhost:3000")
      .origin
    if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
      throw new Error("FIXTURE_REQUIRES_LOOPBACK")
    const scope: Scope = {
      provider,
      providerOrigin: origin,
      subscriptionKey: digest([origin, "streammax"]),
      sessionBinding: digest([origin, "fixture"]),
      planName: "Premium",
      expectedAmountCents: 2999,
      currency: "USD",
      interval: "MONTHLY",
      accessPolicy: "PRESERVE_PREPAID_ACCESS",
    }
    return { scope, startUrl: `${origin}/demo/streammax/account`, env }
  }
  if (!liveEnabled(env)) throw new Error("LIVE_CANCELLATION_DISABLED")
  const app = new URL(env.CLEANBREAK_APP_ORIGIN || "http://localhost:3000")
  if (
    (app.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(app.hostname)) ||
    app.username ||
    app.password ||
    app.search ||
    app.hash
  )
    throw new Error("SECURE_APP_ORIGIN_REQUIRED")
  if (
    !env.CLEANBREAK_OPERATOR_PASSWORD ||
    env.CLEANBREAK_OPERATOR_PASSWORD.length < 24
  )
    throw new Error("OPERATOR_AUTH_REQUIRED")
  const config = readDesktopConfig({ ...env, CLEANBREAK_DRY_RUN: "true" }) // Read-only navigation configuration; no write authority.
  if (!isMiroProvider(config.provider.providerName, config.provider.startUrl))
    throw new Error("MIRO_CONFIG_REQUIRED")
  const p = config.provider
  const scope: Scope = {
    provider,
    providerOrigin: "https://miro.com",
    subscriptionKey: digest([provider, p.startUrl, p.planName]),
    sessionBinding: digest(config.desktopId),
    planName: p.planName,
    expectedAmountCents: Math.round(p.subscription.amount * 100),
    currency: p.subscription.currency,
    interval: p.subscription.interval,
    accessPolicy: "PRESERVE_PREPAID_ACCESS",
  }
  return { scope, startUrl: p.startUrl, env }
}
export type ProductConfig = ReturnType<typeof productConfig>
export function miroProductSummary(env = process.env) {
  try {
    const config = readDesktopConfig({ ...env, CLEANBREAK_DRY_RUN: "true" })
    if (!isMiroProvider(config.provider.providerName, config.provider.startUrl))
      return null
    let enabled = false
    try {
      productConfig("miro", env)
      enabled = true
    } catch {
      /* Disabled is the default. */
    }
    return {
      planName: config.provider.planName,
      amountCents: Math.round(config.provider.subscription.amount * 100),
      currency: config.provider.subscription.currency,
      interval: config.provider.subscription.interval,
      enabled,
    }
  } catch {
    return null
  }
}
