import "server-only"
import { createHash } from "node:crypto"
import { chromium, type Page } from "playwright-core"
import { privateDesktopCDP } from "@/lib/desktop/private-cdp"
import { evaluateLocalDOM } from "@/lib/desktop/local-dom"
import type { ProductConfig } from "./config"
import type { Billing, Observation } from "./state"
import { watchMiroBilling } from "./miro-billing-response"
import { readMiroTrialDOM } from "./miro-dom-flow"

// This function runs inside Chrome. Only recognized billing values leave it:
// never page text, email, card data, input values, credentials, image or HTML.
export async function readMiroDOMBilling(
  page: Pick<Page, "evaluate">,
  expectedUrl: string,
) {
  return evaluateLocalDOM(
    page,
    (expectedUrl) => {
      const norm = (s: string) => s.trim().replace(/\s+/g, " ")
      const expected = new URL(expectedUrl),
        actual = new URL(location.href)
      const pageMatched =
        actual.origin === "https://miro.com" &&
        actual.origin === expected.origin &&
        !actual.search &&
        !actual.hash &&
        !actual.username &&
        !actual.password &&
        actual.pathname.replace(/\/$/, "") ===
          expected.pathname.replace(/\/$/, "")
      const visible = (el: Element) => {
        const style = getComputedStyle(el)
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          el.getClientRects().length > 0
        )
      }
      const root = document.querySelector("main") ?? document.body
      const nodes = Array.from(
        root.querySelectorAll("h1,h2,h3,h4,dt,dd,th,td,label,span,div"),
      )
        .slice(0, 10000)
        .filter(visible)
      const heading = nodes.some((n) =>
        /^billing(?: overview| & plans)?$/i.test(norm(n.textContent ?? "")),
      )
      const dialog = Array.from(
        document.querySelectorAll('[role="dialog"],dialog[open]'),
      ).some(visible)
      const labels = new Set([
        "plan",
        "current plan",
        "plan type",
        "subscription status",
        "status",
        "auto-renewal",
        "auto renewal",
        "automatic renewal",
        "next charge",
        "next payment",
        "next billing date",
        "billing period",
        "billing cycle",
        "currency",
        "access until",
        "trial ends",
      ])
      const rows: Array<{ label: string; value: string }> = []
      for (const node of nodes) {
        // Require semantic field/value pairs, not arbitrary nearby page text or
        // user-controlled billing-address lines. Unsupported layouts stay unknown.
        if (!node.matches("dt,th,td")) continue
        const label = norm(node.textContent ?? "")
          .toLowerCase()
          .replace(/:$/, "")
        if (!labels.has(label) || node.children.length > 3) continue
        const sibling = node.nextElementSibling
        if (
          sibling &&
          visible(sibling) &&
          ((node.matches("dt") && sibling.matches("dd")) ||
            (node.matches("th,td") &&
              sibling.matches("td") &&
              node.parentElement?.matches("tr")))
        ) {
          const value = norm(sibling.textContent ?? "")
          if (value.length <= 160) rows.push({ label, value })
        }
      }
      const unique = <T extends string | number>(values: Array<T | null>) => {
        const set = new Set(values.filter((v) => v !== null))
        return set.size === 1 ? [...set][0] : null
      }
      const values = (...labels: string[]) =>
        rows.filter((r) => labels.includes(r.label)).map((r) => r.value)
      const planValue = (s: string) =>
        /^business(?: plan)? trial$/i.test(s)
          ? "BUSINESS_TRIAL"
          : /^business(?: plan)?$/i.test(s)
            ? "BUSINESS"
            : null
      const plan = unique(
        values("plan", "current plan", "plan type").map(planValue),
      )
      const subscriptionStatus =
        unique<Billing["subscriptionStatus"]>(
          values("subscription status", "status").map((s) =>
            /^(active|trialing)$/i.test(s)
              ? "ACTIVE"
              : /^cancel(?:l)?ed$/i.test(s)
                ? "CANCELED"
                : /^(cancels at period end|cancellation scheduled)$/i.test(s)
                  ? "SCHEDULED"
                  : null,
          ),
        ) ?? "UNKNOWN"
      const renewalStatus =
        unique<Billing["renewalStatus"]>(
          values("auto-renewal", "auto renewal", "automatic renewal").map(
            (s) =>
              /^(off|disabled|no)$/i.test(s)
                ? "OFF"
                : /^(on|enabled|yes)$/i.test(s)
                  ? "ON"
                  : null,
          ),
        ) ?? "UNKNOWN"
      const next = values("next charge", "next payment", "next billing date")
      const isoDate = (s: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
        const time = new Date(s)
        return Number.isFinite(time.valueOf()) &&
          time.toISOString().slice(0, 10) === s
          ? s
          : null
      }
      const absent = next.some((s) =>
        /^(none|no upcoming charges|no future charges|no next payment)$/i.test(
          s,
        ),
      )
      const amounts = next
        .map((s) => s.match(/^(?:USD|US\$)\s*(\d+(?:\.\d{2})?)(?:\s|$)/)?.[1])
        .filter((s): s is string => !!s)
        .map((s) => Math.round(Number(s) * 100))
        .filter(Number.isSafeInteger)
      const dates = next.map(
        (s) =>
          isoDate(s) ?? isoDate(s.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? ""),
      )
      const nextDate = unique(dates),
        amount = unique(amounts)
      const conflicting =
        (absent &&
          next.some(
            (s) =>
              !/^(none|no upcoming charges|no future charges|no next payment)$/i.test(
                s,
              ),
          )) ||
        new Set(amounts).size > 1 ||
        new Set(dates.filter(Boolean)).size > 1 ||
        values("subscription status", "status").some(
          (s) =>
            !/^(active|trialing|cancel(?:l)?ed|cancels at period end|cancellation scheduled)$/i.test(
              s,
            ),
        ) ||
        values("auto-renewal", "auto renewal", "automatic renewal").some(
          (s) => !/^(on|off|enabled|disabled|yes|no)$/i.test(s),
        )
      const noCharge = absent && !conflicting
      const interval =
        unique(
          values("billing period", "billing cycle").map((s) =>
            /^(yearly|annual|annually)$/i.test(s)
              ? "YEARLY"
              : /^monthly$/i.test(s)
                ? "MONTHLY"
                : null,
          ),
        ) ?? "UNKNOWN"
      const currency = unique(
        values("currency").map((s) =>
          /^(USD|EUR|GBP|CAD|AUD)$/.test(s) ? s : null,
        ),
      )
      return {
        pageMatched,
        heading,
        dialog,
        authenticationRequired: !!document.querySelector(
          'input[type="password"]',
        ),
        plan,
        interval,
        currency,
        conflicting,
        billing: {
          subscriptionStatus,
          renewalStatus,
          nextChargePresent: noCharge
            ? false
            : nextDate !== null && amount !== null
              ? true
              : null,
          nextChargeAmountCents: noCharge ? null : amount,
          nextChargeDate: noCharge ? null : nextDate,
          accessUntil: unique(
            values("access until", "trial ends").map(isoDate),
          ),
        },
      }
    },
    expectedUrl,
  )
}

export async function verifyMiroDOM(
  vm: Parameters<typeof privateDesktopCDP>[0],
  config: ProductConfig,
  contextId: string,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<Observation> {
  const bridge = await privateDesktopCDP(vm)
  let page: Page | undefined
  let watcher: ReturnType<typeof watchMiroBilling> | undefined
  try {
    const browser = await chromium.connectOverCDP(bridge.endpoint, {
      headers: bridge.headers,
      noDefaults: true, // Preserve this shared Chrome context's native settings.
      timeout: 10000,
    })
    const context = browser.contexts()[0]
    if (!context) throw new Error("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
    page = await context.newPage() // Same authenticated profile, fresh page; no inputs.
    watcher = watchMiroBilling(page, config.startUrl)
    await page.goto(config.startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    })
    const sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
    await page
      .locator('[data-testid="billing-overview__plan-details"]')
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {})
    await sleep(1500)
    const serverFirst = await watcher.read()
    const uiFirst = await readMiroTrialDOM(page, config.startUrl)
    const first = await readMiroDOMBilling(page, config.startUrl)
    watcher.reset()
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 })
    await page
      .locator('[data-testid="billing-overview__plan-details"]')
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {})
    await sleep(1500)
    const serverSecond = await watcher.read()
    const uiSecond = await readMiroTrialDOM(page, config.startUrl)
    if (
      serverFirst &&
      serverSecond &&
      uiFirst.authenticated &&
      uiSecond.authenticated &&
      !uiFirst.dialog &&
      !uiSecond.dialog
    ) {
      const serverStable =
        JSON.stringify(serverFirst) === JSON.stringify(serverSecond)
      const matched =
        serverSecond.plan === "BUSINESS_TRIAL" &&
        /^business(?: plan)? trial$/i.test(config.scope.planName) &&
        serverSecond.currency === config.scope.currency &&
        serverSecond.interval === config.scope.interval &&
        uiSecond.matched &&
        uiSecond.interval === serverSecond.interval
      const scheduled =
        serverSecond.cancelAtPeriodEnd && serverSecond.status === "trialing"
      const canceled = serverSecond.status === "canceled"
      const active =
        serverSecond.status === "trialing" && !serverSecond.cancelAtPeriodEnd
      const stopped = scheduled || canceled
      // cancelAtPeriodEnd is the provider's explicit non-renewal state, not an
      // inference from a missing amount or a success toast. Trial access persists
      // until periodEnd. No outstanding purchase/payment changes are performed.
      const billing: Billing = {
        subscriptionStatus: scheduled
          ? "SCHEDULED"
          : canceled
            ? "CANCELED"
            : active
              ? "ACTIVE"
              : "UNKNOWN",
        renewalStatus: stopped ? "OFF" : active ? "ON" : "UNKNOWN",
        nextChargePresent: stopped
          ? false
          : active && uiSecond.amount !== null
            ? true
            : null,
        nextChargeAmountCents: stopped ? null : uiSecond.amount,
        nextChargeDate: stopped ? null : serverSecond.periodEnd,
        accessUntil: serverSecond.periodEnd,
      }
      return {
        version: 1,
        observedAt: new Date().toISOString(),
        contextId,
        scope: config.scope,
        matched,
        identityChecks: {
          provider: true,
          page: uiSecond.matched,
          plan:
            serverSecond.plan === "BUSINESS_TRIAL" &&
            /^business(?: plan)? trial$/i.test(config.scope.planName),
          currency: serverSecond.currency === config.scope.currency,
          interval: serverSecond.interval === config.scope.interval,
        },
        authenticated: true,
        confidence: 1,
        surface: "BILLING_PAGE",
        target: "UNKNOWN",
        targetCount: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        intent: "UNKNOWN",
        fee: "UNKNOWN",
        newCharge: "UNKNOWN",
        access: "UNKNOWN",
        unrelatedChanges: false,
        ambiguous: !serverStable || uiFirst.matched !== uiSecond.matched,
        billing,
        screenshot: "",
        screenshotHash: "",
        evidenceKind: "DOM_AND_PROVIDER_BILLING",
        evidenceHash: createHash("sha256")
          .update(JSON.stringify({ serverSecond, billing }))
          .digest("hex"),
      }
    }
    const second = await readMiroDOMBilling(page, config.startUrl)
    const plan = /^business(?: plan)? trial$/i.test(
      config.scope.planName.trim(),
    )
      ? "BUSINESS_TRIAL"
      : /^business(?: plan)?$/i.test(config.scope.planName.trim())
        ? "BUSINESS"
        : null
    const identityChecks = {
      provider: config.scope.provider === "miro",
      page: second.pageMatched,
      plan: plan !== null && second.plan === plan,
      currency: second.currency === config.scope.currency,
      interval: second.interval === config.scope.interval,
    }
    return {
      version: 1,
      observedAt: new Date().toISOString(),
      contextId,
      scope: config.scope,
      matched: Object.values(identityChecks).every(Boolean),
      identityChecks,
      authenticated:
        second.pageMatched &&
        second.heading &&
        !second.dialog &&
        !second.authenticationRequired,
      confidence: 1,
      surface:
        second.heading && !second.dialog && !second.authenticationRequired
          ? "BILLING_PAGE"
          : "UNKNOWN",
      target: "UNKNOWN",
      targetCount: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      intent: "UNKNOWN",
      fee: "UNKNOWN",
      newCharge: "UNKNOWN",
      access: "UNKNOWN",
      unrelatedChanges: false,
      ambiguous:
        second.conflicting || JSON.stringify(first) !== JSON.stringify(second),
      billing: second.billing as Billing,
      screenshot: "",
      screenshotHash: "",
      evidenceKind: "DOM",
      evidenceHash: createHash("sha256")
        .update(JSON.stringify(second))
        .digest("hex"),
    }
  } catch {
    throw new Error("DOM_VERIFICATION_UNAVAILABLE")
  } finally {
    watcher?.close()
    await page?.close().catch(() => {})
    // Disconnect the private bridge, never issue Browser.close to shared Chrome.
    await bridge.close()
  }
}
