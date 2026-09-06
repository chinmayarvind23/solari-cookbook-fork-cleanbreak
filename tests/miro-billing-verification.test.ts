// Checks account-bound billing responses and independent verdicts.
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"
import { chromium, type Browser, type BrowserContext } from "playwright-core"
import { chromium as installedChromium } from "patchright-core"
import { verifyMiroDOM } from "@/lib/cancellations/miro-dom-verification"
import { verificationVerdict } from "@/lib/cancellations/policy"
import type { ProductConfig } from "@/lib/cancellations/config"

const bridgeClose = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/desktop/private-cdp", () => ({
  privateDesktopCDP: vi.fn(async () => ({
    endpoint: "offline",
    headers: {},
    close: bridgeClose,
  })),
}))
const url = "https://miro.com/app/settings/company/offline-verification/billing"
const config: ProductConfig = {
  env: { NODE_ENV: "test" },
  startUrl: url,
  scope: {
    provider: "miro",
    providerOrigin: "https://miro.com",
    subscriptionKey: "offline",
    sessionBinding: "offline",
    planName: "Business Trial",
    expectedAmountCents: 24000,
    currency: "USD",
    interval: "YEARLY",
    accessPolicy: "PRESERVE_PREPAID_ACCESS",
  },
}
let browser: Browser, context: BrowserContext
beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: installedChromium.executablePath(),
  })
})
afterAll(async () => {
  await browser?.close()
})
afterEach(async () => {
  await context?.close()
  vi.restoreAllMocks()
  bridgeClose.mockClear()
})
const providerState = (stopped: boolean, interval = "year") => ({
  trialType: "BUSINESS_TRIAL",
  customer: {
    currencyChangeScheduled: false,
    privateField: "private-response-sentinel",
    subscription: {
      status: "trialing",
      cancelAtPeriodEnd: stopped,
      trialExpirationDate: Date.UTC(2027, 8, 18) / 1000,
      periodEnd: Date.UTC(2027, 8, 18) / 1000,
      immediateCancellationAllowed: false,
      plan: { currency: "usd", interval },
    },
  },
})
const markup = `<main><div data-testid="billing-container"><div data-testid="billing-overview__next-events">Your Business Plan trial ends on September 18, 2027, after which you'll be charged $240.</div><div data-testid="billing-overview__plan-details"><span data-testid="settings__billing-overview__plan-summary__without-flp-link">Your team is on Business Plan (yearly).</span></div></div><div>private-dom-sentinel</div></main>`
const loginWithStaleBilling = `<input type="password"><main><h1>Billing</h1><dl><dt>Plan</dt><dd>Business Trial</dd><dt>Subscription status</dt><dd>Cancellation scheduled</dd><dt>Auto-renewal</dt><dd>Off</dd><dt>Next charge</dt><dd>None</dd><dt>Currency</dt><dd>USD</dd><dt>Billing period</dt><dd>Yearly</dd><dt>Access until</dt><dd>2027-09-18</dd></dl></main>`

async function run(
  options: {
    first?: unknown
    second?: unknown
    account?: string
    login?: boolean
  } = {},
) {
  context = await browser.newContext()
  let reads = 0
  const methods: string[] = []
  const clicks = vi.fn(),
    screenshots = vi.fn()
  context.on("page", (page) => {
    vi.spyOn(page.mouse, "click").mockImplementation(clicks)
    vi.spyOn(page, "screenshot").mockImplementation(screenshots)
  })
  const account = options.account ?? "offline-verification"
  await context.route("**/*", (route) => {
    methods.push(route.request().method())
    if (new URL(route.request().url()).pathname.startsWith("/api/")) {
      reads++
      return route.fulfill({
        json:
          reads === 1
            ? (options.first ?? providerState(true))
            : (options.second ?? options.first ?? providerState(true)),
      })
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<html><body><script>
        fetch('/api/v1/billing/receivers/${account}/?cache=offline').then(r=>r.json()).then(()=>{
          document.body.innerHTML=${JSON.stringify(options.login ? markup.replace("</main>", loginWithStaleBilling + "</main>") : markup)};
        });
      </script></body></html>`,
    })
  })
  vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({
    contexts: () => [context],
  } as Browser)
  const result = await verifyMiroDOM({} as never, config, "fresh-offline", {
    sleep: async () => {},
  })
  expect(reads).toBe(2)
  expect(methods.every((method) => method === "GET")).toBe(true)
  expect(clicks).not.toHaveBeenCalled()
  expect(screenshots).not.toHaveBeenCalled()
  expect(bridgeClose).toHaveBeenCalledOnce()
  expect(context.pages()).toHaveLength(0)
  expect(JSON.stringify(result)).not.toMatch(
    /private-response-sentinel|private-dom-sentinel|receivers|cache=/,
  )
  return result
}

it("verifies two agreeing account-bound non-renewal responses without images or inputs", async () => {
  const observed = await run()
  expect(observed.evidenceKind).toBe("DOM_AND_PROVIDER_BILLING")
  expect(verificationVerdict(config.scope, observed, true)).toBe("VERIFIED")
  expect(observed.billing).toMatchObject({
    subscriptionStatus: "SCHEDULED",
    renewalStatus: "OFF",
    nextChargePresent: false,
    accessUntil: "2027-09-18",
  })
  expect(observed.screenshot).toBe("")
})
it("still-active response is NOT_VERIFIED, not a successful dialog/toast", async () => {
  expect(
    verificationVerdict(
      config.scope,
      await run({ first: providerState(false) }),
      true,
    ),
  ).toBe("NOT_VERIFIED")
})
it.each([
  [
    "conflicting reload",
    { first: providerState(false), second: providerState(true) },
  ],
  ["different account", { account: "another-offline-account" }],
  ["unsupported response", { first: {} }],
  ["changed interval", { first: providerState(true, "month") }],
  ["login surface", { login: true }],
] as const)("%s cannot produce a VERIFIED result", async (_, options) => {
  const observed = await run(options)
  expect(verificationVerdict(config.scope, observed, true)).toBe("INCONCLUSIVE")
})
