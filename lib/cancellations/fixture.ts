// Drive the fictional StreamMax provider in local Chromium.
import "server-only"
import { mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { chromium, type Browser, type Page } from "patchright-core"
import { runAgentLoop } from "@/lib/agent/loop"
import {
  observePage,
  executeDecision,
  type AgentPageLike,
} from "@/lib/agent/observer"
import { normalizeVerificationObservation } from "@/lib/verification/policy"
import { screenStability } from "@/lib/desktop/screen-stability"
import type { ProductConfig } from "./config"
import type { CancellationDriver } from "./service"
import type { Billing, Observation } from "./state"
import { consumeFinalDispatch } from "./dispatch"

export function fixtureCancellationDriver(
  config: ProductConfig,
  id: string,
): CancellationDriver {
  const directory = resolve(process.cwd(), "artifacts", "cancellations", id)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  let browser: Browser | undefined,
    page: Page | undefined,
    contextId = randomUUID(),
    before: Billing
  const connect = async () => {
    if (browser) return
    contextId = randomUUID()
    browser = await chromium.launch({
      headless: true,
      executablePath: chromium.executablePath(),
    })
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(10_000)
  }
  const close = async () => {
    const b = browser
    browser = undefined
    page = undefined
    await b?.close()
  }
  const fields = async () =>
    page!.evaluate(() => ({
      visibleText: document.body.innerText,
      fields: Array.from(document.querySelectorAll(".settings-row")).map(
        (row) => ({
          label: row.querySelector("span")?.textContent || "",
          value: row.querySelector("strong")?.textContent || "",
        }),
      ),
    }))
  const billing = async (): Promise<Billing> => {
    const raw = await fields()
    const normalized = normalizeVerificationObservation({
      ...raw,
      url: page!.url(),
      title: await page!.title(),
    })
    return {
      subscriptionStatus:
        normalized.status === "CANCELS_AT_PERIOD_END"
          ? "SCHEDULED"
          : normalized.status,
      renewalStatus:
        normalized.autoRenew === true
          ? "ON"
          : normalized.autoRenew === false
            ? "OFF"
            : "UNKNOWN",
      nextChargePresent:
        raw.fields.find((f) => f.label === "Next charge")?.value === "None"
          ? false
          : normalized.nextChargeDate !== null
            ? true
            : null,
      nextChargeAmountCents: normalized.nextChargeDate ? 2999 : null,
      nextChargeDate: normalized.nextChargeDate,
      accessUntil: normalized.accessUntil,
    }
  }
  const capture = async (verify = false): Promise<Observation> => {
    const raw = await fields(),
      get = (name: string) => raw.fields.find((f) => f.label === name)?.value
    const target = page!.getByRole("button", {
      name: "Confirm cancellation",
      exact: true,
    })
    const count = await target.count(),
      box = count === 1 ? await target.boundingBox() : null
    const name = `${randomUUID()}.png`
    const bytes = await page!.screenshot({ path: resolve(directory, name) })
    const accessDate = new Date(get("Access until") ?? "").valueOf()
    const state = verify
      ? await billing()
      : {
          ...before,
          accessUntil: Number.isFinite(accessDate)
            ? new Date(accessDate).toISOString().slice(0, 10)
            : null,
        }
    return {
      version: 1,
      observedAt: new Date().toISOString(),
      contextId,
      scope: config.scope,
      matched:
        page!
          .url()
          .startsWith(`${config.scope.providerOrigin}/demo/streammax/`) &&
        get(verify ? "Plan" : "Current plan") === "Premium" &&
        get(verify ? "Price" : "Current price") === "$29.99 / month",
      authenticated: true,
      confidence: 1,
      surface: verify ? "BILLING_PAGE" : "FINAL_CANCELLATION",
      target: count === 1 ? "Confirm cancellation" : "UNKNOWN",
      x: Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2),
      y: Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2),
      width: 1280,
      height: 900,
      targetCount: count,
      intent:
        get("Auto-renewal") === "Will be disabled"
          ? "STOP_FUTURE_RENEWAL"
          : "UNKNOWN",
      fee:
        get("Cancellation fee") === "None"
          ? "NONE"
          : get("Cancellation fee")
            ? "PRESENT"
            : "UNKNOWN",
      newCharge: get("Cancellation fee") === "None" ? "NONE" : "UNKNOWN",
      access: state.accessUntil ? "THROUGH_TERM" : "UNKNOWN",
      unrelatedChanges: false,
      ambiguous: false,
      billing: state,
      screenshot: name,
      screenshotHash: createHash("sha256").update(bytes).digest("hex"),
    }
  }
  const stable = async (previous: Observation) => {
    if (!/^[a-f0-9-]+\.png$/.test(previous.screenshot))
      throw new Error("INVALID_EVIDENCE")
    if (
      !(
        await screenStability(
          readFileSync(
            /* turbopackIgnore: true */ resolve(directory, previous.screenshot),
          ),
          await page!.screenshot(),
          { x: previous.x, y: previous.y },
        )
      ).stable
    )
      throw new Error("SCREEN_CHANGED")
  }
  return {
    scope: config.scope,
    assertEnabled() {
      if (
        !["localhost", "127.0.0.1"].includes(
          new URL(config.scope.providerOrigin).hostname,
        )
      )
        throw new Error("FIXTURE_REQUIRES_LOOPBACK")
    },
    connect,
    close,
    async navigate(progress) {
      await page!.goto(`${config.scope.providerOrigin}/demo/streammax/billing`)
      before = await billing()
      await page!.goto(config.startUrl)
      const evidence: {
        step: number
        stage: string
        screenshotHash: string
      }[] = []
      const loop = await runAgentLoop({
        jobId: id,
        config: { maxSteps: 20, minConfidence: 0.95 },
        allowedOrigin: config.scope.providerOrigin,
        repository: {
          addStep(step) {
            evidence.push({
              step: step.stepNumber,
              stage: step.policyResult,
              screenshotHash: step.screenshotPath ?? "",
            })
            progress("CANCELLATION_FLOW", evidence)
          },
          saveProposedAction() {},
        },
        // Match observePage's document.querySelectorAll ordering exactly:
        // Next's developer toolbar lives in a shadow root, not that node list.
        observe: () =>
          observePage(
            new Proxy(page!, {
              get(target, key) {
                if (key === "locator")
                  return (selector: string) =>
                    target.locator(`css:light=${selector}`)
                const value = Reflect.get(target, key)
                return typeof value === "function" ? value.bind(target) : value
              },
            }) as unknown as AgentPageLike,
          ),
        async capture(step) {
          const name = `navigation-${step}.png`
          const bytes = await page!.screenshot({
            path: resolve(directory, name),
          })
          return createHash("sha256").update(bytes).digest("hex")
        },
        async plan(observation) {
          const screen = new URL(observation.url).pathname.split("/").at(-1)!
          const labels: Record<string, string> = {
            billing: "Manage subscription",
            manage: "Start cancellation",
            cancel: "Continue cancellation",
            "pause-offer": "No thanks, continue cancellation",
            "discount-offer": "Reject offer and continue",
            reason: "Continue cancellation",
            terms: "Confirm cancellation",
          }
          const target = observation.actions.find((a) =>
            screen === "account"
              ? a.href === "/demo/streammax/billing"
              : a.name === labels[screen],
          )
          return {
            decision: {
              type:
                target?.name === "Confirm cancellation"
                  ? "final_cancel_candidate"
                  : target
                    ? "click"
                    : "needs_human",
              observationId: observation.id,
              targetId: target?.id ?? null,
              value: null,
              url: null,
              reasoning: "Deterministic first-party fixture navigation",
              confidence: 1,
              reason: null,
            },
            usage: { inputTokens: 0, outputTokens: 0 },
          }
        },
        execute: (observed, decision) =>
          executeDecision(
            page! as unknown as AgentPageLike,
            observed,
            decision,
            10_000,
          ),
      })
      if (loop.state !== "AWAITING_APPROVAL")
        throw new Error("FIXTURE_NAVIGATION_FAILED")
      return capture()
    },
    async revalidate(previous) {
      await connect()
      // After a pre-claim crash, first-party terms can be re-opened read-only.
      if (page!.url() === "about:blank") {
        before = previous.billing
        await page!.goto(`${config.scope.providerOrigin}/demo/streammax/terms`)
      }
      await stable(previous)
      return capture()
    },
    async clickFinal(observation, grant) {
      consumeFinalDispatch(grant, id, observation)
      await stable(observation)
      await page!.mouse.click(observation.x, observation.y)
      await page!.waitForURL("**/demo/streammax/result")
    },
    async verify() {
      await close()
      await connect() // Genuinely fresh browser process/context.
      try {
        await page!.goto(
          `${config.scope.providerOrigin}/demo/streammax/billing`,
        )
        return { observation: await capture(true), contextId, fresh: true }
      } finally {
        await close()
      }
    },
  }
}
