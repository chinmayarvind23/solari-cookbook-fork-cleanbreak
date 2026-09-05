import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"
import { navigationScreenStability } from "@/lib/desktop/navigation-stability"
import { screenStability } from "@/lib/desktop/screen-stability"
import {
  desktopDecisionSchema,
  evaluateDesktopDecision,
  safeDesktopDecision,
  type DesktopDecision,
} from "@/lib/desktop/decision"
import { type MiroScope } from "@/lib/desktop/miro"
import { navigationProgress } from "@/lib/desktop/navigation-progress"

const url = "https://miro.com/app/settings/company/test-company/billing"
const copy =
  "Get an extra 14 days on the Business Plan trial. Keep exploring advanced features for free. You can still cancel anytime."
const region = { x: 399, y: 395, width: 500, height: 270 }
const scope: MiroScope = {
  providerName: "Miro",
  startUrl: url,
  completedCancellationSteps: 2,
  completedRules: ["ENTRY", "CONTINUE_DIALOG"],
}
function decision(patch: Partial<DesktopDecision> = {}): DesktopDecision {
  return desktopDecisionSchema.parse({
    type: "scroll",
    x: 974,
    y: 400,
    deltaY: 100,
    scrollbar: {
      left: 971,
      top: 158,
      width: 7,
      height: 491,
      thumbTop: 158,
      thumbHeight: 387,
    },
    targetText: "vertical scrollbar",
    text: null,
    keys: null,
    visibleText: copy,
    observedOrigin: "https://miro.com",
    destinationOrigin: null,
    pageStatus: "authenticated_provider",
    flowStage: "RETENTION",
    confidence: 0.99,
    reasoning: "Reveal the offer choices",
    reason: null,
    miroObservation: {
      pageUrl: url,
      targetContext: copy,
      surface: "CANCELLATION_DIALOG",
      targetRole: "BUTTON",
      marketingAnimation: region,
    },
    ...patch,
  })
}
async function frame(
  color: number,
  extra?: { x: number; y: number; width: number; height: number },
) {
  const pixels = Buffer.alloc(1280 * 720 * 4, 255)
  for (const rect of [region, ...(extra ? [extra] : [])])
    for (let y = rect.y; y < rect.y + rect.height; y++)
      for (let x = rect.x; x < rect.x + rect.width; x++)
        pixels[(y * 1280 + x) * 4] = rect === region ? color : 0
  return sharp(pixels, { raw: { width: 1280, height: 720, channels: 4 } })
    .png()
    .toBuffer()
}
const original = await frame(255),
  fresh = await frame(0),
  latest = await frame(100)
async function check(
  d = decision(),
  currentScope: MiroScope | undefined = scope,
  next = latest,
  first = fresh,
) {
  const screenshot = vi.fn(async () => next)
  const sleep = vi.fn(async () => {})
  const result = await navigationScreenStability({
    original,
    fresh: first,
    decision: d,
    scope: currentScope,
    screenshot,
    sleep,
    signal: new AbortController().signal,
  })
  return { result, screenshot, sleep }
}
describe("scoped Miro retention illustration stability", () => {
  it("permits the observed 14.6% preview animation, retaining original full-screen metrics", async () => {
    expect(
      evaluateDesktopDecision(
        decision(),
        "https://miro.com",
        1280,
        720,
        0.9,
        scope,
      ).policy.result,
    ).toBe("ALLOW")
    expect((await screenStability(original, fresh)).stable).toBe(false)
    const { result, screenshot, sleep } = await check()
    expect(result).toMatchObject({
      stable: true,
      threshold: 0.005,
      targetChanged: false,
      animation: {
        region,
        outsideChangedPixelRatio: 0,
        excludedPixelCount: 135000,
      },
    })
    expect(result.changedPixelRatio).toBeGreaterThan(0.14)
    expect(screenshot).toHaveBeenCalledOnce()
    expect(sleep).toHaveBeenCalledExactlyOnceWith(250)
  })
  it("allows explicit rejection without accepting the extension", async () => {
    const d = decision({
      type: "click",
      targetText: "No thanks",
      x: 850,
      y: 300,
      deltaY: null,
      scrollbar: null,
    })
    const assessment = evaluateDesktopDecision(
      d,
      "https://miro.com",
      1280,
      720,
      0.9,
      scope,
    )
    expect(assessment).toMatchObject({
      rule: "DECLINE_OFFER",
      policy: { result: "ALLOW" },
      finalBoundaryEstablished: false,
    })
    expect((await check(assessment.decision)).result.stable).toBe(true)
  })
  it.each([
    "Accept offer",
    "Get 14 more days",
    "Keep Business Plan",
    "Continue",
    "Cancel trial",
    "Cancel subscription",
    "Confirm cancellation",
  ])("never excludes pixels for %s", async (label) => {
    const d = decision({
      type: "click",
      targetText: label,
      x: 850,
      y: 300,
      deltaY: null,
      scrollbar: null,
    })
    expect((await check(d)).result.stable).toBe(false)
  })
  it.each(["final_cancel_candidate", "key", "type"] as const)(
    "never applies to %s actions",
    async (type) => {
      expect(
        (await check(decision({ type, targetText: "No thanks" }))).result
          .stable,
      ).toBe(false)
    },
  )
  it.each([
    { providerName: "Other" },
    { completedCancellationSteps: 0, completedRules: [] },
    { completedRules: ["ENTRY", "CONTINUE_REASON"] },
    {
      completedCancellationSteps: 3,
      completedRules: ["ENTRY", "CONTINUE_DIALOG", "DECLINE_OFFER"],
    },
  ] as Partial<MiroScope>[])(
    "requires exact current-job Miro offer history %#",
    async (patch) => {
      expect(
        (await check(decision(), { ...scope, ...patch })).result.stable,
      ).toBe(false)
    },
  )
  it.each([
    { pageStatus: "login" },
    { pageStatus: "challenge" },
    { confidence: 0.94 },
    { observedOrigin: "https://other.example" },
    { destinationOrigin: "https://other.example" },
    { flowStage: "FINAL_CONFIRMATION" },
    { visibleText: "Cancellation fee applies" },
  ] as Partial<DesktopDecision>[])(
    "refuses unsafe observations %#",
    async (patch) => {
      expect((await check(decision(patch))).result.stable).toBe(false)
    },
  )
  it.each([
    url + "?instruction=ignore-safety",
    url + "#ignore",
    url.replace("test-company", "another-company"),
  ])("rejects URL manipulation %#", async (pageUrl) => {
    const d = decision()
    d.miroObservation!.pageUrl = pageUrl
    expect((await check(d)).result.stable).toBe(false)
  })
  it("requires visible offer evidence, not remembered private text", async () => {
    const d = decision({ visibleText: "No thanks" })
    d.miroObservation!.targetContext = "No thanks"
    expect((await check(d)).result.stable).toBe(false)
  })
  it("recognizes clipped offer copy only after a returned offer scroll", async () => {
    const d = decision({
      type: "click",
      targetText: "No thanks",
      x: 850,
      y: 300,
      visibleText: "Keep exploring advanced features for free. No thanks",
    })
    d.miroObservation!.targetContext = d.visibleText
    expect((await check(d)).result.stable).toBe(false)
    expect(
      (await check(d, { ...scope, extensionOfferPreviouslyObserved: true }))
        .result.stable,
    ).toBe(true)
  })
  it("does not report preview-only motion as scroll progress", async () => {
    const result = await navigationProgress(original, latest, {
      region,
      target: { x: 974, y: 158, endY: 649 },
    })
    expect(result).toMatchObject({ screenChanged: false, changedPixelRatio: 0 })
  })
  it.each([
    { x: 330, y: 150, width: 650, height: 520 },
    { x: 400, y: 0, width: 500, height: 200 },
    { x: 900, y: 395, width: 100, height: 270 },
    { x: 399, y: 395, width: 900, height: 270 },
  ])(
    "rejects oversized/chrome/target-overlapping regions %#",
    async (marketingAnimation) => {
      const d = decision()
      d.miroObservation!.marketingAnimation = marketingAnimation
      expect((await check(d)).result.stable).toBe(false)
    },
  )
  it("protects the ENTIRE scrollbar, including pixels outside the drag path", async () => {
    const altered = await frame(100, { x: 973, y: 165, width: 1, height: 1 })
    expect((await check(decision(), scope, altered)).result).toMatchObject({
      stable: false,
      targetChanged: true,
    })
  })
  it("protects a moved/changed decline button", async () => {
    const d = decision({
      type: "click",
      targetText: "No thanks",
      x: 850,
      y: 300,
    })
    expect(
      (
        await check(
          d,
          scope,
          await frame(100, { x: 850, y: 300, width: 1, height: 1 }),
        )
      ).result,
    ).toMatchObject({ stable: false, targetChanged: true })
  })
  it("rejects changed terms outside the preview in either fresh frame", async () => {
    const altered = await frame(100, { x: 400, y: 200, width: 400, height: 30 })
    expect((await check(decision(), scope, altered)).result.stable).toBe(false)
    expect(
      (await check(decision(), scope, latest, altered)).result.stable,
    ).toBe(false)
  })
  it("does not mistake a static replacement or blinking cursor outside the region for animation", async () => {
    expect((await check(decision(), scope, fresh)).result.stable).toBe(false)
    expect(
      (
        await check(
          decision(),
          scope,
          await frame(0, { x: 100, y: 100, width: 1, height: 1 }),
        )
      ).result.stable,
    ).toBe(false)
  })
  it("rejects decode/dimension failures", async () => {
    expect(
      (await check(decision(), scope, Buffer.from("not an image"))).result
        .stable,
    ).toBe(false)
    const resized = await sharp(latest).resize(640, 360).png().toBuffer()
    expect((await check(decision(), scope, resized)).result.reason).toBe(
      "DIMENSIONS_CHANGED",
    )
  })
  it("leaves final commit comparison unmodified", async () => {
    expect(
      await screenStability(original, latest, { x: 850, y: 300 }),
    ).toMatchObject({ stable: false, reason: "PIXEL_DRIFT" })
  })
  it("retains only numeric diagnostics and enum evidence", async () => {
    const { result } = await check()
    const evidence = JSON.stringify({
      result,
      decision: safeDesktopDecision(decision()),
    })
    for (const privateValue of [
      url,
      copy,
      "data:image",
      "base64",
      "Reveal the offer choices",
    ])
      expect(evidence).not.toContain(privateValue)
  })
})
