import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConfig } from "./config"
import {
  desktopDecisionSchema,
  desktopPolicy,
  safeDesktopDecision,
  type DesktopDecision,
} from "./decision"
import { createDesktopPlanner } from "./planner"
import { desktopEvidence } from "./evidence"
import { startDesktopViewer } from "./viewer"
import { screenStability, type ScreenStability } from "./screen-stability"

export type DesktopHandle = Pick<
  Desktop,
  | "connect"
  | "health"
  | "screenshot"
  | "display"
  | "mouse"
  | "keyboard"
  | "stream"
  | "record"
  | "downloadUrl"
  | "pause"
  | "close"
>
export type DesktopRun = {
  id: string
  desktopId: string
  executor: "desktop"
  state: "FAILED" | "AWAITING_APPROVAL"
  stopReason: string
  steps: Array<{
    step: number
    screenshotPath: string
    screenshotHash: string
    screenStability: ScreenStability | null
    width: number
    height: number
    decision: ReturnType<typeof safeDesktopDecision> | null
    policy: string
    execution: string
  }>
  proposedAction: {
    x: number
    y: number
    confidence: number
    screenshotPath: string
    action: "REVIEW_CANCELLATION_CONTROL"
  } | null
  liveViewReference: string | null
  recordingStatus: "PENDING" | "AVAILABLE" | "FAILED"
  recordingReference: string | null
  recordingGuestPath: string | null
  paused: boolean
  controlClosed: boolean
  destructiveClicksExecuted: 0
  unsafeActionsExecuted: 0
}
type Dependencies = {
  client: Pick<DesktopClient, "connect" | "pause">
  planner: ReturnType<typeof createDesktopPlanner>
  evidence: ReturnType<typeof desktopEvidence>
  viewer: typeof startDesktopViewer
  prepare(viewUrl: string): Promise<boolean>
  confirm(
    step: number,
    decision: ReturnType<typeof safeDesktopDecision>,
    screenshotHash: string,
  ): Promise<boolean>
  reviewRecording(viewUrl: string): Promise<void>
  sleep(ms: number): Promise<void>
  signal: AbortSignal
  id: string
}

export function screenshotDimensions(bytes: Uint8Array) {
  const b = Buffer.from(bytes)
  if (
    b.length < 24 ||
    b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    b.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("INVALID_SCREENSHOT")
  const width = b.readUInt32BE(16),
    height = b.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 8192 || height > 8192)
    throw new Error("INVALID_SCREEN_DIMENSIONS")
  return { width, height }
}
function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

// Only these dispatchers are reachable. No code execution, browser/profile APIs,
// clipboard, shell, lifecycle destroy, Return, or final-action dispatcher exists.
async function executeNavigation(
  vm: DesktopHandle,
  d: DesktopDecision,
): Promise<string> {
  try {
    if (d.type === "click") await vm.mouse.click(d.x!, d.y!)
    else if (d.type === "type") await vm.keyboard.type(d.text!)
    else if (d.type === "key") await vm.keyboard.press(d.keys!)
    else return "ACTION_NOT_DISPATCHED"
    return "NAVIGATION_RETURNED"
  } catch {
    return "ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY"
  }
}

export async function runDesktopDryRun(
  environment: NodeJS.ProcessEnv,
  supplied: Partial<Dependencies> = {},
): Promise<DesktopRun> {
  // Read/validate before constructing a client or doing any external work.
  const config = readDesktopConfig(environment)
  const id = supplied.id ?? randomUUID()
  const evidence = supplied.evidence ?? desktopEvidence(id)
  const client =
    supplied.client ??
    new DesktopClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      callTimeoutMs: 10_000,
    })
  const planner = supplied.planner ?? createDesktopPlanner(config.agent)
  const signal = supplied.signal ?? new AbortController().signal
  const sleep =
    supplied.sleep ??
    ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
  const run: DesktopRun = {
    id,
    desktopId: config.desktopId,
    executor: "desktop",
    state: "FAILED",
    stopReason: "DESKTOP_NOT_CONNECTED",
    steps: [],
    proposedAction: null,
    liveViewReference: null,
    recordingStatus: "PENDING",
    recordingReference: null,
    recordingGuestPath: null,
    paused: false,
    controlClosed: false,
    destructiveClicksExecuted: 0,
    unsafeActionsExecuted: 0,
  }
  let vm: DesktopHandle | undefined
  let viewer: Awaited<ReturnType<typeof startDesktopViewer>> | undefined
  let recordingAttempted = false
  let tokens = 0
  let phase = "DESKTOP_CONNECT_FAILED"
  try {
    signal.throwIfAborted()
    vm = await client.connect(config.desktopId)
    await vm.connect()
    phase = "DESKTOP_HEALTH_TIMEOUT"
    let ready = false
    for (let attempt = 0; attempt < config.healthAttempts; attempt++) {
      signal.throwIfAborted()
      if ((await vm.health()).ready) {
        ready = true
        break
      }
      await sleep(500)
    }
    if (!ready) throw new Error("not ready")
    phase = "DESKTOP_VIEW_FAILED"
    const stream = await vm.stream.start()
    viewer = await (supplied.viewer ?? startDesktopViewer)(
      stream.streamUrl,
      true,
    )
    run.liveViewReference = `desktop-live:${id}`
    phase = "PREPARATION_NOT_CONFIRMED"
    if (!(await supplied.prepare?.(viewer.url)))
      throw new Error("not confirmed")
    signal.throwIfAborted()
    // Manual authentication occurs before this command. No recording of login.
    phase = "RECORDING_START_FAILED"
    recordingAttempted = true
    const recordingPath = `/tmp/cleanbreak-${id}.mp4`
    await vm.record.start({ fps: 10, format: "mp4", path: recordingPath })
    run.recordingGuestPath = recordingPath
    const history: string[] = []
    run.stopReason = "MAX_STEPS"
    for (let step = 1; step <= config.agent.maxSteps; step++) {
      signal.throwIfAborted()
      phase = "SCREENSHOT_FAILED"
      const screenshot = await vm.screenshot({ format: "png" })
      const { width, height } = screenshotDimensions(screenshot)
      const display = await vm.display.size()
      if (width !== display.w || height !== display.h) {
        run.stopReason = "DISPLAY_MISMATCH"
        break
      }
      const screenshotPath = evidence.screenshot(step, screenshot)
      const entry: DesktopRun["steps"][number] = {
        step,
        screenshotPath,
        screenshotHash: digest(screenshot),
        screenStability: null,
        width,
        height,
        decision: null,
        policy: "PENDING",
        execution: "NOT_EXECUTED",
      }
      run.steps.push(entry)
      evidence.job(run)
      phase = "PLANNER_FAILED"
      const planned = await planner({
        screenshot,
        width,
        height,
        allowedOrigin: new URL(config.provider.startUrl).origin,
        history: history.slice(-6),
      })
      signal.throwIfAborted()
      const decision = desktopDecisionSchema.parse(planned.decision)
      entry.decision = safeDesktopDecision(decision)
      tokens += planned.tokens
      if (!Number.isFinite(tokens) || tokens > config.maxTokens) {
        run.stopReason = "TOKEN_BUDGET"
        entry.policy = run.stopReason
        break
      }
      const policy = desktopPolicy(
        decision,
        new URL(config.provider.startUrl).origin,
        width,
        height,
        config.agent.minConfidence,
      )
      entry.policy = policy.code
      if (policy.result === "BLOCK") {
        run.stopReason = policy.code
        break
      }
      if (policy.result === "INTERCEPT") {
        run.state = "AWAITING_APPROVAL"
        run.stopReason = "FINAL_ACTION_BOUNDARY"
        run.proposedAction = {
          x: decision.x!,
          y: decision.y!,
          confidence: decision.confidence,
          screenshotPath,
          action: "REVIEW_CANCELLATION_CONTROL",
        }
        break
      }
      phase = "NAVIGATION_NOT_CONFIRMED"
      if (
        !(await supplied.confirm?.(
          step,
          entry.decision,
          entry.screenshotHash.slice(0, 12),
        ))
      ) {
        run.stopReason = phase
        break
      }
      signal.throwIfAborted()
      // Fresh visual check after human review. Tiny drift is allowed only away
      // from click targets; no automatic retry of any coordinate action.
      phase = "SCREENSHOT_FAILED"
      entry.screenStability = await screenStability(
        screenshot,
        await vm.screenshot({ format: "png" }),
        decision.type === "click"
          ? { x: decision.x!, y: decision.y! }
          : undefined,
      )
      evidence.job(run)
      if (!entry.screenStability.stable) {
        run.stopReason = "SCREEN_CHANGED"
        break
      }
      signal.throwIfAborted()
      entry.execution = "DISPATCH_PENDING"
      evidence.job(run)
      entry.execution = await executeNavigation(vm, decision)
      history.push(`step ${step}: ${decision.type} -> ${entry.execution}`)
      evidence.job(run)
      if (entry.execution !== "NAVIGATION_RETURNED") {
        run.stopReason = entry.execution
        break
      }
      await sleep(500)
    }
  } catch {
    run.state = "FAILED"
    run.stopReason = signal.aborted ? "INTERRUPTED" : phase
  } finally {
    if (vm && recordingAttempted) {
      try {
        const recording = await vm.record.stop()
        if (recording.sizeBytes > 0) {
          const download = await vm.downloadUrl(recording.path)
          viewer?.setRecording(download.url)
          run.recordingStatus = "AVAILABLE"
          run.recordingReference = `desktop-recording:${id}`
        } else run.recordingStatus = "FAILED"
      } catch {
        run.recordingStatus = "FAILED"
      }
    } else run.recordingStatus = "FAILED"
    try {
      if (vm) await vm.pause()
      else await client.pause(config.desktopId)
      run.paused = true
    } catch {
      try {
        await client.pause(config.desktopId)
        run.paused = true
      } catch {
        run.paused = false
      }
    }
    try {
      vm?.close()
      run.controlClosed = true
    } catch {
      run.controlClosed = false
    }
    if (!run.paused || !run.controlClosed) {
      run.state = "FAILED"
      run.stopReason = "DESKTOP_CLEANUP_FAILED"
    }
    // Pause first; optional local recording review must never keep compute alive.
    try {
      if (!signal.aborted && viewer && run.recordingStatus === "AVAILABLE")
        await supplied.reviewRecording?.(viewer.url)
    } catch {
      /* Recording review is not browser action or success evidence. */
    }
    try {
      await viewer?.close()
    } catch {
      /* No remote lifecycle operation here. */
    }
    evidence.job(run)
    evidence.validation(run)
  }
  return run
}
