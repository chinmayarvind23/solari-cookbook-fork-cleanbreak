// Regression checks for the animated offer fixture in a local browser.
import { chromium } from "patchright-core"
import { expect, it, vi } from "vitest"
import {
  authorizeDesktopNavigation,
  desktopDecisionSchema,
  evaluateDesktopDecision,
} from "@/lib/desktop/decision"
import { navigationScreenStability } from "@/lib/desktop/navigation-stability"
import { executeNavigation, type DesktopHandle } from "@/lib/desktop/runtime"
import type { MiroScope } from "@/lib/desktop/miro"

it("real local Chromium scrolls a changing offer preview, reveals and clicks only its decline button", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
    ignoreDefaultArgs: ["--hide-scrollbars"],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    })
    await page.route("**/*", (route) => route.abort())
    await page.setContent(`<html><style>
      body { margin:0; overflow:hidden; background:#888; }
      section { position:absolute;left:329px;top:145px;width:650px;height:520px;overflow-y:scroll;background:white; }
      section::-webkit-scrollbar { width:7px; }
      section::-webkit-scrollbar-track { background:#ddd; }
      section::-webkit-scrollbar-thumb { background:#555; }
      section::-webkit-scrollbar-button { display:none; }
      article { position:relative;height:680px; }
      h1 { position:absolute;top:30px;left:70px;width:450px;margin:0; }
      p { position:absolute;top:180px;left:70px;width:450px;margin:0; }
      #preview { position:absolute;left:70px;top:250px;width:500px;height:300px;background:white; }
      footer { position:absolute;left:70px;bottom:38px;height:32px;display:flex;gap:40px; }
      button { width:180px;height:32px; }
    </style><body data-accepted="0" data-declined="0"><section role="dialog"><article>
      <h1>Get an extra 14 days on the Business Plan trial</h1>
      <p>Keep exploring advanced features for free. You can still cancel anytime.</p>
      <div id="preview"></div><footer><button id="accept">Extend my trial</button>
      <button id="decline">No thanks</button></footer></article></section>
      <script>document.querySelector('#accept').onclick=()=>document.body.dataset.accepted='1';
      document.querySelector('#decline').onclick=()=>document.body.dataset.declined='1';</script></body></html>`)
    const url = "https://miro.com/app/settings/company/test-company/billing"
    const scope: MiroScope = {
      providerName: "Miro",
      startUrl: url,
      completedCancellationSteps: 2,
      completedRules: ["ENTRY", "CONTINUE_DIALOG"],
    }
    const geometry = await page.locator("section").evaluate((element) => {
      const e = element as HTMLElement,
        b = e.getBoundingClientRect()
      return {
        left: b.right - (e.offsetWidth - e.clientWidth),
        top: b.top,
        width: e.offsetWidth - e.clientWidth,
        height: e.clientHeight,
        thumbTop: b.top,
        thumbHeight: Math.floor(
          (e.clientHeight * e.clientHeight) / e.scrollHeight,
        ),
      }
    })
    async function visiblePreview() {
      const b = (await page.locator("#preview").boundingBox())!
      const top = Math.max(b.y, geometry.top),
        bottom = Math.min(b.y + b.height, geometry.top + geometry.height)
      return {
        x: Math.round(b.x),
        y: Math.round(top),
        width: Math.round(b.width),
        height: Math.round(bottom - top),
      }
    }
    const d = desktopDecisionSchema.parse({
      type: "scroll",
      x: geometry.left + 3,
      y: Math.floor(geometry.top + geometry.thumbHeight / 2),
      deltaY: 100,
      scrollbar: geometry,
      targetText: "vertical scrollbar",
      text: null,
      keys: null,
      visibleText:
        "Get an extra 14 days on the Business Plan trial. Keep exploring advanced features for free.",
      observedOrigin: "https://miro.com",
      destinationOrigin: null,
      pageStatus: "authenticated_provider",
      flowStage: "RETENTION",
      confidence: 0.99,
      reasoning: "Reveal the offer choices",
      reason: null,
      miroObservation: {
        pageUrl: url,
        surface: "CANCELLATION_DIALOG",
        targetRole: "UNKNOWN",
        targetContext:
          "Get an extra 14 days on the Business Plan trial. Keep exploring advanced features for free.",
        marketingAnimation: await visiblePreview(),
      },
    })
    let color = 0
    const screenshot = async () => {
      const colors = ["#aa2222", "#22aa22", "#2222aa"]
      await page.locator("#preview").evaluate(
        (el, value) => {
          ;(el as HTMLElement).style.background = value
        },
        colors[color++ % 3],
      )
      return page.screenshot()
    }
    const drag = vi.fn(
      async (from: { x: number; y: number }, to: { x: number; y: number }) => {
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 10 })
        await page.mouse.up()
      },
    )
    const click = vi.fn(async (x: number, y: number) => page.mouse.click(x, y))
    const desktop = {
      mouse: { drag, click },
      keyboard: { press: vi.fn(), type: vi.fn() },
    } as unknown as DesktopHandle
    const signal = new AbortController().signal
    const sleep = async () => {}
    const scrollCheck = await navigationScreenStability({
      original: await screenshot(),
      fresh: await screenshot(),
      decision: d,
      scope,
      screenshot,
      sleep,
      signal,
    })
    expect(scrollCheck.stable).toBe(true)
    expect(scrollCheck.animation).toBeDefined()
    const grant = authorizeDesktopNavigation(
      d,
      "https://miro.com",
      1280,
      720,
      0.9,
      scope,
    )
    expect(grant).not.toBeNull()
    expect(await executeNavigation(desktop, grant!)).toBe("NAVIGATION_RETURNED")
    expect(
      await page.locator("section").evaluate((e) => e.scrollTop),
    ).toBeGreaterThan(100)
    const button = (await page.locator("#decline").boundingBox())!
    expect(button.y + button.height).toBeLessThan(
      geometry.top + geometry.height,
    )
    const decline = desktopDecisionSchema.parse({
      ...d,
      type: "click",
      targetText: "No thanks",
      x: Math.round(button.x + button.width / 2),
      y: Math.round(button.y + button.height / 2),
      deltaY: null,
      scrollbar: null,
      visibleText:
        "Keep exploring advanced features for free. You can still cancel anytime. No thanks",
      miroObservation: {
        ...d.miroObservation,
        targetRole: "BUTTON",
        targetContext: "Keep exploring advanced features for free. No thanks",
        marketingAnimation: await visiblePreview(),
      },
    })
    const afterScroll = { ...scope, extensionOfferPreviouslyObserved: true }
    const assessed = evaluateDesktopDecision(
      decline,
      "https://miro.com",
      1280,
      720,
      0.9,
      afterScroll,
    )
    expect(assessed.rule).toBe("DECLINE_OFFER")
    const clickCheck = await navigationScreenStability({
      original: await screenshot(),
      fresh: await screenshot(),
      decision: assessed.decision,
      scope: afterScroll,
      screenshot,
      sleep,
      signal,
    })
    expect(clickCheck.stable).toBe(true)
    const declineGrant = authorizeDesktopNavigation(
      decline,
      "https://miro.com",
      1280,
      720,
      0.9,
      afterScroll,
    )
    expect(declineGrant).not.toBeNull()
    expect(await executeNavigation(desktop, declineGrant!)).toBe(
      "NAVIGATION_RETURNED",
    )
    expect(await page.locator("body").getAttribute("data-declined")).toBe("1")
    expect(await page.locator("body").getAttribute("data-accepted")).toBe("0")
    expect(await executeNavigation(desktop, declineGrant!)).toBe(
      "ACTION_NOT_DISPATCHED",
    )
    expect(click).toHaveBeenCalledOnce()
    expect(drag).toHaveBeenCalledOnce()
  } finally {
    await browser.close()
  }
}, 30_000)
