import "server-only"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConnection } from "@/lib/desktop/config"
import { runDesktopDryRun } from "@/lib/desktop/runtime"
import { desktopEvidence } from "@/lib/desktop/evidence"
import { screenStability } from "@/lib/desktop/screen-stability"
import { createBillingExtractor } from "./extraction"
import { liveEnabled, type ProductConfig } from "./config"
import type { CancellationDriver } from "./service"
import type { Observation } from "./state"
import { consumeFinalDispatch } from "./dispatch"

export function desktopCancellationDriver(
  config: ProductConfig,
  id: string,
): CancellationDriver {
  const connection = readDesktopConnection(config.env)
  const client = new DesktopClient({
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    callTimeoutMs: 10_000,
  })
  const directory = resolve(process.cwd(), "artifacts", "cancellations", id)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const extract = createBillingExtractor(config)
  let vm: Desktop | undefined,
    contextId = randomUUID(),
    shot = 0
  const close = async () => {
    const current = vm
    vm = undefined
    if (current)
      try {
        await current.pause()
      } finally {
        current.close()
      }
  }
  const connect = async () => {
    if (vm) return
    contextId = randomUUID()
    vm = await client.connect(connection.desktopId)
    await vm.connect()
    if (!(await vm.health()).ready) throw new Error("DESKTOP_NOT_READY")
  }
  const capture = async (mode: "FINAL" | "VERIFY") => {
    if (!vm) throw new Error("DESKTOP_NOT_READY")
    const image = await vm.screenshot({ format: "png" })
    const name = `${mode.toLowerCase()}-${++shot}-${randomUUID()}.png`
    writeFileSync(resolve(directory, name), image, { mode: 0o600 })
    const observation = await extract(image, contextId, name, mode)
    const display = await vm.display.size()
    if (display.w !== observation.width || display.h !== observation.height)
      throw new Error("DISPLAY_MISMATCH")
    return observation
  }
  const stable = async (o: Observation) => {
    if (!/^[a-z0-9-]+\.png$/.test(o.screenshot))
      throw new Error("INVALID_EVIDENCE")
    const old = readFileSync(
      /* turbopackIgnore: true */ resolve(directory, o.screenshot),
    )
    const fresh = await vm!.screenshot({ format: "png" })
    if (!(await screenStability(old, fresh, { x: o.x, y: o.y })).stable)
      throw new Error("SCREEN_CHANGED")
  }
  return {
    scope: config.scope,
    assertEnabled() {
      if (!liveEnabled(process.env) || !liveEnabled(config.env))
        throw new Error("LIVE_CANCELLATION_DISABLED")
    },
    connect,
    async navigate(progress) {
      // Dry-run navigation owns its own control handle, never a destructive one.
      await close()
      const evidence = desktopEvidence(id, resolve(directory, "navigation"))
      const run = await runDesktopDryRun(
        { ...config.env, CLEANBREAK_DRY_RUN: "true" },
        {
          auto: true,
          privateWorker: true,
          id,
          evidence: {
            ...evidence,
            job(run) {
              evidence.job({ ...run, desktopId: config.scope.sessionBinding })
              if (
                run.steps.some(
                  (s) =>
                    s.execution === "NAVIGATION_RETURNED" &&
                    s.decision?.type === "cancel_flow_navigation",
                )
              )
                progress(
                  "CANCELLATION_FLOW",
                  run.steps.map((s) => ({
                    step: s.step,
                    stage: s.flowStage ?? "UNKNOWN",
                    screenshotHash: s.screenshotHash,
                  })),
                )
            },
          },
          signal: AbortSignal.timeout(10 * 60_000),
        },
      )
      if (
        !run.finalBoundaryEstablished ||
        run.state !== "AWAITING_APPROVAL" ||
        run.stopReason !== "FINAL_ACTION_BOUNDARY" ||
        !run.steps.some(
          (s) =>
            s.adapterRule === "ENTRY" && s.execution === "NAVIGATION_RETURNED",
        )
      )
        throw new Error("FINAL_BOUNDARY_NOT_ESTABLISHED")
      await connect()
      const final = await capture("FINAL")
      if (
        final.x !== run.proposedAction?.x ||
        final.y !== run.proposedAction?.y
      )
        throw new Error("FINAL_TARGET_CHANGED")
      return final
    },
    async revalidate(previous) {
      await connect()
      await stable(previous)
      return capture("FINAL")
    },
    async clickFinal(observation, grant) {
      consumeFinalDispatch(grant, id, observation)
      if (
        !liveEnabled(process.env) ||
        Date.now() - Date.parse(observation.observedAt) > 30_000
      )
        throw new Error("STALE_COMMIT")
      await stable(observation)
      // No locator retry, no planner route, exactly one SDK mouse call.
      await vm!.mouse.click(observation.x, observation.y)
    },
    close,
    async verify() {
      await close()
      await connect() // New SDK handle and independent extractor input.
      const verificationContext = contextId
      try {
        // Separate new window in the authenticated VM browser profile. Not an
        // isolated browser process: Chrome may reuse it. Provenance says so.
        const detected = await vm!.exec("test", {
          args: ["-x", "/usr/bin/google-chrome"],
          timeoutMs: 5000,
        })
        if (detected.exitCode !== 0)
          throw new Error("VERIFICATION_BROWSER_UNAVAILABLE")
        await vm!.open("/usr/bin/google-chrome", [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--user-data-dir=/tmp/cleanbreak-chrome",
          "--new-window",
          config.startUrl,
        ])
        await new Promise((done) => setTimeout(done, 1500))
        // Only screenshots/health thereafter. No click, keyboard or planner.
        const first = await capture("VERIFY")
        await new Promise((done) => setTimeout(done, 1000))
        const second = await capture("VERIFY")
        if (JSON.stringify(first.billing) !== JSON.stringify(second.billing))
          second.ambiguous = true
        return {
          observation: second,
          contextId: verificationContext,
          fresh: true,
        }
      } finally {
        await close()
      }
    },
  }
}
