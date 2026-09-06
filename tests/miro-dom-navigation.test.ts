// Checks Miro stage order and the handoff of the final control.
import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type BrowserContext } from "playwright-core"
import { chromium as installedChromium } from "patchright-core"
import { connectMiroDOMNavigation } from "@/lib/cancellations/miro-dom-navigation"
import {
  readMiroTrialDOM,
  nextMiroDOMStage,
} from "@/lib/cancellations/miro-dom-flow"
import { decodeMiroBillingResponse } from "@/lib/cancellations/miro-billing-response"
import { validFinal } from "@/lib/cancellations/policy"
import type { ProductConfig } from "@/lib/cancellations/config"
vi.mock("@/lib/desktop/private-cdp", () => ({
  privateDesktopCDP: vi.fn(async () => ({
    endpoint: "offline",
    headers: {},
    close: async () => {},
  })),
}))
const url = "https://miro.com/app/settings/company/offline/billing"
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
  vi.restoreAllMocks()
  await context?.close()
})
const billing = `<div data-testid="billing-container"><div data-testid="billing-overview__next-events">Your Business Plan trial ends on September 18, 2027, after which you'll be charged $240.</div><div data-testid="billing-overview__plan-details"><span data-testid="settings__billing-overview__plan-summary__without-flp-link">Your team is on Business Plan (yearly).</span></div><div data-testid="settings__billing-overview__cancel-subscription-section"><button onclick="show('benefits')">Cancel trial</button></div></div><div id="dialog"></div>`
const fixture = String.raw`<html><head><style>body{font-family:Arial}button{padding:12px;margin:12px}label{display:block;padding:20px}[role=dialog]{background:white;position:fixed;left:50px;top:50px;border:1px solid black;padding:20px;width:600px}textarea{width:400px;height:100px}</style></head><body>${billing}<script>
window.commits=0;window.choices=[];
fetch('/api/v1/billing/receivers/offline/?cache=offline');
function show(stage){let text='';if(stage==='benefits')text='<div data-testid="cancel-subscrition-dialog__confirm-page-text">You can enjoy all Business Plan benefits until the trial ends. Your account will expire at the end of the trial period.</div><button data-testid="cancel-subscription-dialog__submit-btn" onclick="show(\'offer\')">Continue</button>';
if(stage==='offer')text='<div data-testid="cancel-subscription-dialog__extend-trial-body">Get an extra 14 days on the Business Plan trial. Keep exploring advanced features for free.</div><button onclick="throw Error(\'offer must not be accepted\')">Extend trial</button><button data-testid="cancel-subscription-dialog__extend-trial-cancel-btn" onclick="show(\'choice\')">Continue to cancel</button>';
if(stage==='choice')text='<label data-testid="cancel-subscription-dialog__downgrade-radio"><input type="radio" name="option" checked>Downgrade</label><label data-testid="cancel-subscription-dialog__cancel-radio"><input type="radio" name="option" onchange="document.getElementById(\'next\').textContent=\'Cancel subscription\'">Cancel trial</label><button id="next" data-testid="cancel-subscription-dialog__confirm-btn" onclick="show(\'reason\')">Continue</button>';
if(stage==='reason')text='<p>Why are you canceling?</p><textarea data-testid="open-format-feedback__textarea" oninput="document.getElementById(\'final\').disabled=!this.value"></textarea><button id="final" data-testid="open-format-feedback__submit-btn" disabled onclick="window.commits++">Cancel subscription</button>';
document.getElementById('dialog').innerHTML='<section role="dialog">'+text+'</section>';window.choices.push(stage)}
</script></body></html>`
async function setup(html = fixture) {
  context = await browser.newContext()
  await context.route("**/*", (r) =>
    r.request().url().includes("/api/v1/billing/receivers/offline/")
      ? r.fulfill({
          json: {
            trialType: "BUSINESS_TRIAL",
            customer: {
              currencyChangeScheduled: false,
              subscription: {
                status: "trialing",
                cancelAtPeriodEnd: false,
                trialExpirationDate: Date.UTC(2027, 8, 18) / 1000,
                periodEnd: Date.UTC(2027, 8, 18) / 1000,
                immediateCancellationAllowed: false,
                plan: { currency: "usd", interval: "year" },
              },
            },
          },
        })
      : r.fulfill({ body: html, contentType: "text/html" }),
  )
  vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({
    contexts: () => [context],
  } as Browser)
}
it("traverses the observed trial flow, rejects downgrade/extension, and stops BEFORE final dispatch", async () => {
  await setup()
  const directory = mkdtempSync(join(tmpdir(), "cleanbreak-dom-"))
  const nav = await connectMiroDOMNavigation(
      {} as never,
      config,
      "offline-context",
      directory,
      async () => {},
    ),
    progress = vi.fn()
  const final = await nav.navigate(progress)
  expect(final).toMatchObject({
    surface: "FINAL_CANCELLATION",
    target: "Cancel subscription",
    fee: "NONE",
    newCharge: "NONE",
    access: "THROUGH_TERM",
    billing: { nextChargeAmountCents: 24000 },
    evidenceKind: "DOM",
  })
  expect(
    validFinal(
      {
        ...config.scope,
        id: "auth",
        intent: "CANCEL_SUBSCRIPTION",
        authorizedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        maxDestructiveActions: 1,
      },
      final,
      Date.now(),
    ),
  ).toBe(true)
  const page = context.pages()[0]
  expect(
    await page.evaluate(() => ({
      commits: (window as any).commits,
      choices: (window as any).choices,
    })),
  ).toEqual({ commits: 0, choices: ["benefits", "offer", "choice", "reason"] })
  expect(progress.mock.calls.at(-1)![1].map((s: any) => s.stage)).toEqual([
    "MIRO_DOM_ENTRY",
    "MIRO_DOM_BENEFITS",
    "MIRO_DOM_DECLINE_OFFER",
    "MIRO_DOM_CANCEL_CHOICE",
    "MIRO_DOM_REASON_NEXT",
    "MIRO_DOM_REASON_INPUT",
  ])
  await nav.revalidate(final)
  await page.locator("textarea").fill("different reason")
  await expect(nav.assertStable(final)).rejects.toThrow("FINAL_TARGET_CHANGED")
  expect(await page.evaluate(() => (window as any).commits)).toBe(0)
  await nav.close()
}, 30000)
it("unknown final controls and changed fees fail closed without an input", async () => {
  await setup(
    `<main>${billing}<section role="dialog">Cancellation fee $100<button>Cancel subscription</button></section></main>`,
  )
  const page = await context.newPage()
  await page.goto(url)
  const f = await readMiroTrialDOM(page, url)
  expect(f.unsafeTerms).toBe(true)
  expect(nextMiroDOMStage(f, [])).toBe(null)
})
it("a later identical entry label is not automatically allowed", async () => {
  await setup()
  const page = await context.newPage()
  await page.goto(url)
  const f = await readMiroTrialDOM(page, url)
  expect(nextMiroDOMStage(f, [])).toBe("ENTRY")
  expect(nextMiroDOMStage(f, ["ENTRY"])).toBe(null)
})
it("strips all personal/payment fields from observed provider response facts", () => {
  const safe = decodeMiroBillingResponse({
    trialType: "BUSINESS_TRIAL",
    customer: {
      currencyChangeScheduled: false,
      paymentMethod: { private: "not returned" },
      subscription: {
        status: "trialing",
        cancelAtPeriodEnd: true,
        trialExpirationDate: Date.UTC(2027, 8, 18),
        periodEnd: Date.UTC(2027, 8, 18),
        immediateCancellationAllowed: false,
        plan: { currency: "usd", interval: "year" },
        private: "not returned",
      },
    },
  })
  expect(safe).toMatchObject({
    cancelAtPeriodEnd: true,
    currency: "USD",
    periodEnd: "2027-09-18",
  })
  expect(JSON.stringify(safe)).not.toMatch(/private|paymentMethod|not returned/)
  expect(() => decodeMiroBillingResponse({})).toThrow()
})
it("has no destructive dispatcher or model call in the navigation loop", () => {
  const code = readFileSync("lib/cancellations/miro-dom-navigation.ts", "utf8")
  expect(code).toContain('if (stage === "FINAL") return snapshot()')
  expect(code).not.toMatch(/OpenAI|responses\.parse|page\.evaluate.*click/)
})
