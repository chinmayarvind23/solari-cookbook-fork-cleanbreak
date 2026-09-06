import "server-only"
import { randomUUID, createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium, type Page } from "playwright-core"
import { privateDesktopCDP } from "@/lib/desktop/private-cdp"
import { screenStability } from "@/lib/desktop/screen-stability"
import { isMiroProvider } from "@/lib/desktop/miro"
import {
  readMiroTrialDOM,
  nextMiroDOMStage,
  DOM_NEUTRAL_REASON,
  type MiroDOMStage,
  type MiroTrialDOM,
} from "./miro-dom-flow"
import type { ProductConfig } from "./config"
import type { Job, Observation } from "./state"
import { CancellationFailure } from "./failure"
import {
  watchMiroBilling,
  type MiroBillingResponse,
} from "./miro-billing-response"

export async function connectMiroDOMNavigation(
  vm: Parameters<typeof privateDesktopCDP>[0],
  config: ProductConfig,
  contextId: string,
  directory: string,
  sleep: (ms: number) => Promise<void>,
) {
  if (
    !isMiroProvider("Miro", config.startUrl) ||
    config.scope.provider !== "miro"
  )
    throw new Error("MIRO_CONFIG_REQUIRED")
  const bridge = await privateDesktopCDP(vm)
  try {
    const browser = await chromium.connectOverCDP(bridge.endpoint, {
      headers: bridge.headers,
      noDefaults: true,
      timeout: 10000,
    })
    const context = browser.contexts()[0]
    let page: Page | undefined
    const history: MiroDOMStage[] = []
    const evidence: Job["navigation"] = []
    let providerBilling: MiroBillingResponse | null = null
    let watcher: ReturnType<typeof watchMiroBilling> | undefined
    const identity = (f: MiroTrialDOM) =>
      f.matched &&
      f.authenticated &&
      f.trial &&
      !f.noCharge &&
      !f.canceled &&
      /^Business(?: Plan)? Trial$/i.test(config.scope.planName) &&
      f.interval === config.scope.interval &&
      f.currency === config.scope.currency &&
      f.amount === config.scope.expectedAmountCents &&
      !!f.accessUntil &&
      Date.parse(f.accessUntil + "T23:59:59Z") > Date.now() &&
      !f.unsafeTerms &&
      !f.ambiguous &&
      providerBilling?.status === "trialing" &&
      providerBilling.cancelAtPeriodEnd === false &&
      providerBilling.currency === config.scope.currency &&
      providerBilling.interval === config.scope.interval &&
      providerBilling.periodEnd === f.accessUntil &&
      providerBilling.immediateCancellationAllowed === false
    const locateFinal = async () => {
      if (page) return page
      // Crash recovery may revalidate only a unique, already-established final
      // surface; it never starts/replays navigation or retypes the reason.
      const matches: Page[] = []
      for (const candidate of context.pages()) {
        if (
          candidate.url().replace(/\/$/, "") !==
          config.startUrl.replace(/\/$/, "")
        )
          continue
        const f = await readMiroTrialDOM(candidate, config.startUrl)
        if (
          identity(f) &&
          f.reasonReady &&
          f.targets.some((t) => t.stage === "FINAL")
        )
          matches.push(candidate)
      }
      if (matches.length !== 1)
        throw new CancellationFailure("FINAL_BOUNDARY_NOT_ESTABLISHED")
      page = matches[0]
      return page
    }
    const snapshot = async () => {
      const p = await locateFinal(),
        f = await readMiroTrialDOM(p, config.startUrl)
      const targets = f.targets.filter((t) => t.stage === "FINAL" && t.hit)
      if (!identity(f) || !f.reasonReady || targets.length !== 1)
        throw new CancellationFailure("FINAL_BOUNDARY_NOT_ESTABLISHED")
      const image = await p.screenshot({
        type: "png",
        scale: "css",
        timeout: 10000,
      })
      const screenshot = `dom-final-${randomUUID()}.png`
      writeFileSync(resolve(directory, screenshot), image, { mode: 0o600 })
      const target = targets[0]
      return {
        version: 1,
        observedAt: new Date().toISOString(),
        contextId,
        scope: config.scope,
        matched: true,
        identityChecks: {
          provider: true,
          page: true,
          plan: true,
          currency: true,
          interval: true,
        },
        authenticated: true,
        confidence: 1,
        surface: "FINAL_CANCELLATION",
        target: target.label as Observation["target"],
        x: target.x,
        y: target.y,
        width: f.width,
        height: f.height,
        targetCount: 1,
        intent: "STOP_FUTURE_RENEWAL",
        fee: "NONE",
        newCharge: "NONE",
        access: "THROUGH_TERM",
        unrelatedChanges: false,
        ambiguous: false,
        billing: {
          subscriptionStatus: "ACTIVE",
          renewalStatus: "ON",
          nextChargePresent: true,
          nextChargeAmountCents: f.amount,
          nextChargeDate: f.accessUntil,
          accessUntil: f.accessUntil,
        },
        screenshot,
        screenshotHash: createHash("sha256").update(image).digest("hex"),
        evidenceKind: "DOM",
        evidenceHash: f.evidenceHash,
        termsBasis: "MIRO_FREE_TRIAL_CANCELLATION_DOCUMENTATION",
      } satisfies Observation
    }
    const assertStable = async (o: Observation) => {
      const p = await locateFinal(),
        f = await readMiroTrialDOM(p, config.startUrl)
      if (
        !identity(f) ||
        f.evidenceHash !== o.evidenceHash ||
        !f.targets.some(
          (t) => t.stage === "FINAL" && t.hit && t.x === o.x && t.y === o.y,
        )
      )
        throw new CancellationFailure("FINAL_TARGET_CHANGED")
      if (!/^dom-final-[a-f0-9-]+\.png$/.test(o.screenshot))
        throw new Error("INVALID_EVIDENCE")
      const old = readFileSync(
        /* turbopackIgnore: true */ resolve(directory, o.screenshot),
      )
      const fresh = await p.screenshot({
        type: "png",
        scale: "css",
        timeout: 10000,
      })
      if (!(await screenStability(old, fresh, { x: o.x, y: o.y })).stable)
        throw new CancellationFailure("FINAL_TARGET_CHANGED")
    }
    return {
      async navigate(
        progress: (
          stage: "CANCELLATION_FLOW",
          evidence: Job["navigation"],
        ) => void,
      ) {
        page = await context.newPage()
        watcher = watchMiroBilling(page, config.startUrl)
        await page.goto(config.startUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        })
        await page.bringToFront()
        await page
          .locator('[data-testid="billing-overview__next-events"]')
          .waitFor({ state: "visible", timeout: 30000 })
        for (let poll = 0; poll < 20; poll++) {
          providerBilling = await watcher.read()
          if (providerBilling) break
          await sleep(250)
        }
        if (!providerBilling)
          throw new CancellationFailure("BILLING_OBSERVATION_UNAVAILABLE")
        // At most seven input stages. Poll reads only; never replay a click.
        for (let turn = 0; turn < 8; turn++) {
          let f: MiroTrialDOM | undefined,
            stage: MiroDOMStage | null = null
          for (let poll = 0; poll < 20; poll++) {
            f = await readMiroTrialDOM(page, config.startUrl, true)
            stage = nextMiroDOMStage(f, history)
            if (stage) break
            if (!f.matched || f.unsafeTerms || f.ambiguous) break
            await sleep(500)
          }
          if (!f || !stage || !identity(f))
            throw new CancellationFailure("FINAL_BOUNDARY_NOT_ESTABLISHED")
          if (stage === "FINAL") return snapshot() // NO final dispatch in this loop.
          if (history.includes(stage))
            throw new CancellationFailure("DESKTOP_NAVIGATION_NO_PROGRESS")
          const fresh = await readMiroTrialDOM(page, config.startUrl)
          if (
            f.evidenceHash !== fresh.evidenceHash ||
            nextMiroDOMStage(fresh, history) !== stage
          )
            throw new CancellationFailure("FINAL_TARGET_CHANGED")
          if (stage === "REASON_INPUT") {
            // Fixed neutral reason, scoped exact textarea; never secret entry.
            await page
              .locator('textarea[data-testid="open-format-feedback__textarea"]')
              .fill(DOM_NEUTRAL_REASON, { timeout: 5000 })
          } else {
            const target = fresh.targets.filter(
              (t) => t.stage === stage && t.hit,
            )
            if (target.length !== 1)
              throw new CancellationFailure("FINAL_TARGET_CHANGED")
            // One call, no action retry. DOM hit target and local pixels must agree.
            const before = await page.screenshot({
              type: "png",
              scale: "css",
              timeout: 10000,
            })
            const after = await page.screenshot({
              type: "png",
              scale: "css",
              timeout: 10000,
            })
            if (!(await screenStability(before, after, target[0])).stable)
              throw new CancellationFailure("FINAL_TARGET_CHANGED")
            const last = await readMiroTrialDOM(page, config.startUrl)
            if (last.evidenceHash !== fresh.evidenceHash)
              throw new CancellationFailure("FINAL_TARGET_CHANGED")
            await page.mouse.click(target[0].x, target[0].y)
          }
          history.push(stage)
          evidence.push({
            step: evidence.length + 1,
            stage: `MIRO_DOM_${stage}`,
            screenshotHash: f.evidenceHash,
          })
          progress("CANCELLATION_FLOW", [...evidence])
        }
        throw new CancellationFailure("DESKTOP_NAVIGATION_MAX_STEPS")
      },
      async revalidate(o: Observation) {
        await assertStable(o)
        return snapshot()
      },
      assertStable,
      // Invoked ONLY by the existing one-use final-dispatch grant consumer.
      async click(o: Observation) {
        await (await locateFinal()).mouse.click(o.x, o.y)
      },
      close: async () => {
        watcher?.close()
        await bridge.close()
      },
    }
  } catch {
    await bridge.close()
    throw new CancellationFailure("BILLING_OBSERVATION_UNAVAILABLE")
  }
}
