import "server-only"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConnection } from "@/lib/desktop/config"
import { runDesktopDryRun } from "@/lib/desktop/runtime"
import { desktopEvidence } from "@/lib/desktop/evidence"
import { screenStability } from "@/lib/desktop/screen-stability"
import { launchDesktopBrowser } from "@/lib/desktop/browser-launch"
import { createBillingExtractor } from "./extraction"
import { verifyMiroDOM } from "./miro-dom-verification"
import { liveEnabled, type ProductConfig } from "./config"
import type { CancellationDriver } from "./service"
import type { Observation, Job } from "./state"
import { consumeFinalDispatch } from "./dispatch"
import { CancellationFailure, navigationFailure } from "./failure"

export function desktopCancellationDriver(
  config: ProductConfig,
  id: string,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): CancellationDriver {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const connection = readDesktopConnection(config.env)
  const client = new DesktopClient({
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    callTimeoutMs: 10_000,
  })
  const directory = resolve(process.cwd(), "artifacts", "cancellations", id)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  let vm: Desktop | undefined,
    contextId = randomUUID(),
    shot = 0
  let recordingVm: Desktop | undefined
  let extract: ReturnType<typeof createBillingExtractor> | undefined
  const recordingPath = `/tmp/cleanbreak-full-${id}.mp4`
  let recordingStarted = false
  const finishRecording = async (): Promise<Job["recording"]> => {
    const recorder = recordingVm
    recordingVm = undefined
    if (!recorder) return undefined
    try {
      if (!recordingStarted)
        return { status: "FAILED", filename: null, sizeBytes: 0 }
      recordingStarted = false
      const stopped = await recorder.record.stop()
      if (
        stopped.path !== recordingPath ||
        stopped.sizeBytes <= 0 ||
        stopped.sizeBytes > 128 * 1024 * 1024
      )
        throw new Error("INVALID_RECORDING")
      const bytes = await recorder.fs.read(recordingPath)
      if (
        bytes.byteLength !== stopped.sizeBytes ||
        Buffer.from(bytes.subarray(4, 8)).toString("ascii") !== "ftyp"
      )
        throw new Error("INVALID_RECORDING")
      writeFileSync(resolve(directory, "cancellation.mp4"), bytes, {
        mode: 0o600,
      })
      return {
        status: "AVAILABLE",
        filename: "cancellation.mp4",
        sizeBytes: bytes.byteLength,
      }
    } catch {
      return { status: "FAILED", filename: null, sizeBytes: 0 }
    } finally {
      try {
        recorder.close()
      } catch {
        /* Local handle only. */
      }
    }
  }
  const close = async () => {
    const current = vm
    vm = undefined
    // Disconnect this worker, not the user's shared Desktop/console viewer.
    current?.close()
  }
  const connect = async () => {
    if (vm) return
    contextId = randomUUID()
    vm = await client.connect(connection.desktopId)
    await vm.connect()
    if (!(await vm.health()).ready) throw new Error("DESKTOP_NOT_READY")
  }
  const capture = async (mode: "FINAL") => {
    if (config.env.CLEANBREAK_ALLOW_SCREENSHOT_MODEL_UPLOADS !== "true")
      throw new CancellationFailure("SCREENSHOT_UPLOADS_DISABLED")
    extract ??= createBillingExtractor(config)
    if (!vm) throw new Error("DESKTOP_NOT_READY")
    const image = await vm.screenshot({ format: "png" })
    const name = `${mode.toLowerCase()}-${++shot}-${randomUUID()}.png`
    writeFileSync(resolve(directory, name), image, { mode: 0o600 })
    let observation: Observation
    try {
      observation = await extract(image, contextId, name, mode)
    } catch {
      throw new CancellationFailure("BILLING_OBSERVATION_UNAVAILABLE")
    }
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
    finishRecording,
    async navigate(progress) {
      if (config.env.CLEANBREAK_ALLOW_SCREENSHOT_MODEL_UPLOADS !== "true")
        throw new CancellationFailure("SCREENSHOT_UPLOADS_DISABLED")
      await connect()
      // Start from the configured Billing page using the existing VM-only Chrome
      // profile. No viewer, credential typing, extension acceptance or reset.
      await launchDesktopBrowser(
        vm!,
        config.startUrl,
        AbortSignal.timeout(15_000),
        { browser: "chrome", wait: sleep },
      )
      recordingVm = await client.connect(connection.desktopId)
      await recordingVm.connect()
      recordingStarted = true
      await recordingVm.record.start({
        fps: 10,
        format: "mp4",
        path: recordingPath,
      })
      // Dry-run navigation owns its own control handle, never a destructive one.
      await close()
      const evidence = desktopEvidence(id, resolve(directory, "navigation"))
      const run = await runDesktopDryRun(
        { ...config.env, CLEANBREAK_DRY_RUN: "true" },
        {
          auto: true,
          privateWorker: true,
          recordingManagedExternally: true,
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
        throw navigationFailure(run.stopReason)
      await connect()
      const final = await capture("FINAL")
      if (
        final.x !== run.proposedAction?.x ||
        final.y !== run.proposedAction?.y
      )
        throw new CancellationFailure("FINAL_TARGET_CHANGED")
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
        // Independent read-only DOM page + reload. No screenshot/model fallback.
        const second = await verifyMiroDOM(vm!, config, verificationContext, {
          sleep,
        })
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
