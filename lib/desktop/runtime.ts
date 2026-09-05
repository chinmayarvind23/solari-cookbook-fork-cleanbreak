import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConfig } from "./config"
import {
  desktopDecisionSchema,
  authorizeDesktopNavigation,
  consumeDesktopNavigationGrant,
  desktopNavigationKeys,
  evaluateDesktopDecision,
  safeDesktopDecision,
  isLoadingObservation,
  type DesktopDecision,
} from "./decision"
import { createDesktopPlanner, DesktopPlanningFailure } from "./planner"
import { desktopEvidence } from "./evidence"
import { startDesktopViewer } from "./viewer"
import { type ScreenStability } from "./screen-stability"
import { navigationScreenStability } from "./navigation-stability"
import { stabilizeDesktopPage, type TransitionStability } from "./stabilize"
import {
  isMiroProvider,
  isMiroExtensionOffer,
  type MiroRule,
  type MiroScope,
} from "./miro"
import {
  navigationProgress,
  pageNavigationKey,
  type NavigationProgress,
} from "./navigation-progress"

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
  mode: "auto" | "supervised"
  providerAdapter: "miro" | null
  finalBoundaryEstablished: boolean
  automaticDestructiveRetries: 0
  state: "FAILED" | "AWAITING_APPROVAL"
  stopReason: string
  planningBudget?: {
    maxTokens: number
    usedTokens: number
    remainingTokens: number
    maxSteps: number
  }
  steps: Array<{
    step: number
    screenshotPath: string
    screenshotHash: string
    screenStability: ScreenStability | null
    miroExtensionOffer?: boolean
    transitionStability: TransitionStability | null
    navigationProgress?: NavigationProgress | null
    planning?: {
      inputTokens: number | null
      outputTokens: number | null
      totalTokens: number
      cumulativeTokens: number
      limit: number
    }
    flowStage: DesktopDecision["flowStage"] | null
    providerAdapter: "miro" | null
    adapterRule: MiroRule | null
    adapterDiagnostic?: string | null
    width: number
    height: number
    decision: ReturnType<typeof safeDesktopDecision> | null
    policy: string
    policyResult: "ALLOW" | "BLOCK" | "INTERCEPT" | null
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
  privateWorker: boolean
  auto: boolean
  progress(message: string): void
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
export async function executeNavigation(
  vm: DesktopHandle,
  d: DesktopDecision,
): Promise<string> {
  if (!consumeDesktopNavigationGrant(d)) return "ACTION_NOT_DISPATCHED"
  try {
    if (d.type === "click" || d.type === "cancel_flow_navigation")
      await vm.mouse.click(d.x!, d.y!)
    else if (d.type === "type") await vm.keyboard.type(d.text!)
    else if (d.type === "key") {
      const keys = desktopNavigationKeys(d.keys)
      if (keys === null) return "ACTION_NOT_DISPATCHED"
      await vm.keyboard.press(keys)
    } else if (d.type === "scroll") {
      await vm.mouse.drag(
        { x: d.x!, y: d.y! },
        { x: d.x!, y: d.y! + d.deltaY! },
      )
    } else return "ACTION_NOT_DISPATCHED"
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
  const auto = supplied.auto === true
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
    mode: auto ? "auto" : "supervised",
    providerAdapter: isMiroProvider(
      config.provider.providerName,
      config.provider.startUrl,
    )
      ? "miro"
      : null,
    finalBoundaryEstablished: false,
    automaticDestructiveRetries: 0,
    state: "FAILED",
    stopReason: "DESKTOP_NOT_CONNECTED",
    planningBudget: {
      maxTokens: config.maxTokens,
      usedTokens: 0,
      remainingTokens: config.maxTokens,
      maxSteps: config.agent.maxSteps,
    },
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
  let loadingObservations = 0
  let loadingDeadline = 0
  let stalledPageImage: Uint8Array | undefined
  let stalledScrollbar = false
  let stalledFocusMoves = 0
  let noProgressReplans = 0
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
    if (!supplied.privateWorker) {
      const stream = await vm.stream.start()
      viewer = await (supplied.viewer ?? startDesktopViewer)(
        stream.streamUrl,
        true,
      )
      run.liveViewReference = `desktop-live:${id}`
    }
    phase = "PREPARATION_NOT_CONFIRMED"
    if (!auto && !(viewer && (await supplied.prepare?.(viewer.url))))
      throw new Error("not confirmed")
    signal.throwIfAborted()
    // Manual authentication occurs before this command. No recording of login.
    phase = "RECORDING_START_FAILED"
    recordingAttempted = true
    const recordingPath = `/tmp/cleanbreak-${id}.mp4`
    await vm.record.start({ fps: 10, format: "mp4", path: recordingPath })
    run.recordingGuestPath = recordingPath
    const history: string[] = []
    let settledScreenshot: Uint8Array | undefined
    run.stopReason = "MAX_STEPS"
    for (let step = 1; step <= config.agent.maxSteps; step++) {
      signal.throwIfAborted()
      phase = "SCREENSHOT_FAILED"
      const screenshot =
        settledScreenshot ?? (await vm.screenshot({ format: "png" }))
      settledScreenshot = undefined
      if (stalledPageImage) {
        phase = "NAVIGATION_OBSERVATION_FAILED"
        if (
          (await navigationProgress(stalledPageImage, screenshot)).screenChanged
        ) {
          stalledPageImage = undefined
          stalledScrollbar = false
          stalledFocusMoves = 0
        }
      }
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
        transitionStability: null,
        navigationProgress: null,
        flowStage: null,
        providerAdapter: run.providerAdapter,
        adapterRule: null,
        width,
        height,
        decision: null,
        policy: "PENDING",
        policyResult: null,
        execution: "NOT_EXECUTED",
      }
      run.steps.push(entry)
      evidence.job(run)
      phase = "PLANNER_FAILED"
      const completedSteps = run.steps.filter(
        (s) => s.execution === "NAVIGATION_RETURNED",
      )
      const miroScope: MiroScope | undefined =
        run.providerAdapter === "miro"
          ? {
              providerName: config.provider.providerName,
              startUrl: config.provider.startUrl,
              extensionOfferPreviouslyObserved:
                completedSteps.at(-1)?.decision?.type === "scroll" &&
                completedSteps.at(-1)?.miroExtensionOffer === true,
              completedCancellationSteps: completedSteps.filter(
                (s) => s.decision?.type === "cancel_flow_navigation",
              ).length,
              completedRules: completedSteps.flatMap((s) =>
                s.adapterRule ? [s.adapterRule] : [],
              ),
            }
          : undefined
      const recordUsage = (
        total: number,
        usage?: { inputTokens: number; outputTokens: number },
      ) => {
        if (!Number.isSafeInteger(total) || total < 0)
          throw new DesktopPlanningFailure("TOKEN_BUDGET")
        tokens += total
        entry.planning = {
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          totalTokens: total,
          cumulativeTokens: tokens,
          limit: config.maxTokens,
        }
        run.planningBudget!.usedTokens = tokens
        run.planningBudget!.remainingTokens = Math.max(
          0,
          config.maxTokens - tokens,
        )
        supplied.progress?.(
          `step ${step}: planning tokens ${tokens}/${config.maxTokens}`,
        )
      }
      let planned: Awaited<ReturnType<typeof planner>>
      try {
        planned = await planner({
          screenshot,
          width,
          height,
          allowedOrigin: new URL(config.provider.startUrl).origin,
          history: history.slice(-6),
          pageNavigationStalled: Boolean(stalledPageImage),
          remainingTokens: config.maxTokens - tokens,
          signal,
          providerAdapter: run.providerAdapter,
          miroCancellationEntered:
            (miroScope?.completedCancellationSteps ?? 0) > 0,
        })
      } catch (error) {
        if (error instanceof DesktopPlanningFailure) {
          recordUsage(error.usage.totalTokens, error.usage)
          entry.policy = error.code
          entry.policyResult = "BLOCK"
        }
        throw error
      }
      recordUsage(planned.tokens, planned.usage)
      signal.throwIfAborted()
      const rawDecision = desktopDecisionSchema.parse(planned.decision)
      const assessment = evaluateDesktopDecision(
        rawDecision,
        new URL(config.provider.startUrl).origin,
        width,
        height,
        config.agent.minConfidence,
        miroScope,
      )
      const decision = assessment.decision
      entry.adapterRule = assessment.rule
      entry.adapterDiagnostic = assessment.diagnostic
      entry.decision = safeDesktopDecision(decision)
      entry.flowStage = decision.flowStage
      if (!Number.isFinite(tokens) || tokens > config.maxTokens) {
        run.stopReason = "TOKEN_BUDGET"
        entry.policy = run.stopReason
        entry.policyResult = "BLOCK"
        break
      }
      if (decision.type === "wait") {
        entry.policy = "OBSERVATION_ONLY_NO_INPUT"
        // Only a bounded post-navigation observation, never an action retry.
        if (
          !isLoadingObservation(
            decision,
            new URL(config.provider.startUrl).origin,
          ) ||
          completedSteps.length === 0
        ) {
          run.stopReason = "INVALID_LOADING_OBSERVATION"
          break
        }
        if (!loadingDeadline) loadingDeadline = Date.now() + 30_000
        if (++loadingObservations > 5 || Date.now() >= loadingDeadline) {
          run.stopReason = "PROVIDER_LOADING_TIMEOUT"
          break
        }
        entry.execution = "OBSERVATION_ONLY"
        evidence.job(run)
        supplied.progress?.(
          `step ${step}: provider loading -> observation only`,
        )
        phase = "PAGE_STABILIZATION_FAILED"
        await sleep(2000)
        signal.throwIfAborted()
        history.push(`step ${step}: loading observed; no input dispatched`)
        continue
      }
      loadingDeadline = 0
      const policy = assessment.policy
      entry.policy = policy.code
      entry.policyResult = policy.result
      const summarize = (outcome?: string) => {
        if (auto)
          supplied.progress?.(
            `step ${step}: ${decision.type === "key" ? entry.decision?.keys?.join("+") || "key" : decision.type} -> ${policy.result}${outcome ? ` -> ${outcome}` : ""}`,
          )
      }
      if (policy.result === "BLOCK") {
        run.stopReason = policy.code
        summarize()
        break
      }
      if (policy.result === "INTERCEPT") {
        if (auto && assessment.diagnostic)
          supplied.progress?.(`Miro policy: ${assessment.diagnostic}`)
        run.state = "AWAITING_APPROVAL"
        run.stopReason = "FINAL_ACTION_BOUNDARY"
        run.finalBoundaryEstablished = assessment.finalBoundaryEstablished
        summarize()
        run.proposedAction =
          decision.pageStatus === "authenticated_provider" &&
          decision.observedOrigin ===
            new URL(config.provider.startUrl).origin &&
          (decision.destinationOrigin === null ||
            decision.destinationOrigin ===
              new URL(config.provider.startUrl).origin) &&
          decision.confidence >= config.agent.minConfidence &&
          decision.x !== null &&
          decision.y !== null &&
          decision.x >= 0 &&
          decision.y >= 0 &&
          decision.x < width &&
          decision.y < height
            ? {
                x: decision.x!,
                y: decision.y!,
                confidence: decision.confidence,
                screenshotPath,
                action: "REVIEW_CANCELLATION_CONTROL",
              }
            : null
        break
      }
      const focusMove =
        decision.type === "key" &&
        ["Tab", "Shift+Tab"].includes(
          desktopNavigationKeys(decision.keys)?.join("+") ?? "",
        )
      if (
        stalledPageImage &&
        (pageNavigationKey(decision) ||
          (stalledScrollbar && decision.type === "scroll") ||
          (focusMove && stalledFocusMoves >= 2))
      ) {
        // Read-only replan, not an automatic key/click retry. A stale focused
        // background must not consume the run by repeating Page_Down/Page_Up.
        entry.policy = "NAVIGATION_NO_PROGRESS"
        entry.policyResult = "BLOCK"
        entry.execution = "NOT_EXECUTED"
        history.push(
          `step ${step}: navigation blocked; NO_VISIBLE_PROGRESS. Do not repeat page keys or stalled scrollbar drags. A visible scrollbar thumb is required for scroll; at most two focus-only Tab moves are permitted while stalled. Otherwise stop.`,
        )
        evidence.job(run)
        supplied.progress?.(
          `step ${step}: navigation -> BLOCK -> no visible progress`,
        )
        if (++noProgressReplans > 1) {
          run.stopReason = "NAVIGATION_NO_PROGRESS"
          break
        }
        continue
      }
      phase = "NAVIGATION_NOT_CONFIRMED"
      if (
        !auto &&
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
      entry.miroExtensionOffer =
        !!miroScope && isMiroExtensionOffer(decision, miroScope)
      entry.screenStability = await navigationScreenStability({
        original: screenshot,
        fresh: await vm.screenshot({ format: "png" }),
        decision,
        scope: miroScope,
        screenshot: () => vm!.screenshot({ format: "png" }),
        sleep,
        signal,
      })
      evidence.job(run)
      if (!entry.screenStability.stable) {
        run.stopReason = "SCREEN_CHANGED"
        summarize("SCREEN_CHANGED")
        break
      }
      signal.throwIfAborted()
      const authorized = authorizeDesktopNavigation(
        rawDecision,
        new URL(config.provider.startUrl).origin,
        width,
        height,
        config.agent.minConfidence,
        miroScope,
      )
      if (!authorized) {
        run.stopReason = "ACTION_NOT_DISPATCHED"
        break
      }
      entry.execution = "DISPATCH_PENDING"
      evidence.job(run)
      entry.execution = await executeNavigation(vm, authorized)
      if (stalledPageImage && focusMove) stalledFocusMoves++
      summarize(
        entry.execution === "NAVIGATION_RETURNED"
          ? "dispatched"
          : "failed_no_retry",
      )
      history.push(
        `step ${step}: ${decision.flowStage} ${decision.type} -> ${entry.execution}`,
      )
      evidence.job(run)
      if (entry.execution !== "NAVIGATION_RETURNED") {
        run.stopReason = entry.execution
        break
      }
      phase = "PAGE_STABILIZATION_FAILED"
      const settled = await stabilizeDesktopPage(vm, sleep, signal)
      entry.transitionStability = settled.metrics
      settledScreenshot = settled.screenshot
      if (pageNavigationKey(decision) || decision.type === "scroll") {
        phase = "NAVIGATION_OBSERVATION_FAILED"
        entry.navigationProgress = await navigationProgress(
          screenshot,
          settled.screenshot,
          entry.screenStability.animation && decision.type === "scroll"
            ? {
                region: entry.screenStability.animation.region,
                target: {
                  x: decision.x!,
                  y: decision.scrollbar!.top,
                  endY: decision.scrollbar!.top + decision.scrollbar!.height,
                },
              }
            : undefined,
        )
        if (!entry.navigationProgress.screenChanged) {
          stalledPageImage = settled.screenshot
          stalledScrollbar = decision.type === "scroll"
          history.push(
            `step ${step}: ${decision.type === "scroll" ? "scrollbar drag" : pageNavigationKey(decision)} produced NO_VISIBLE_PROGRESS; do not repeat this input. Prefer a different visible scrollbar target if not already stalled; only two focus-only Tab moves are allowed before stopping.`,
          )
          supplied.progress?.(
            `step ${step}: page navigation -> no visible progress; fresh navigation plan required`,
          )
        } else {
          stalledPageImage = undefined
          stalledScrollbar = false
          stalledFocusMoves = 0
          history.push(
            `step ${step}: page navigation changed the screen; inspect fresh screenshot, not assumed success`,
          )
        }
      }
      evidence.job(run)
    }
  } catch (error) {
    run.state = "FAILED"
    run.stopReason = signal.aborted
      ? "INTERRUPTED"
      : error instanceof DesktopPlanningFailure
        ? error.code
        : phase
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
    // This is a shared, user-managed VM. Release only our control connection;
    // pausing here would disconnect the user's Solari console viewer.
    try {
      vm?.close()
      run.controlClosed = true
    } catch {
      run.controlClosed = false
    }
    if (!run.controlClosed) {
      run.state = "FAILED"
      run.stopReason = "DESKTOP_CLEANUP_FAILED"
    }
    supplied.progress?.(
      "No VM pause requested. Pause it in Solari when finished to stop compute billing.",
    )
    try {
      if (
        !auto &&
        !signal.aborted &&
        viewer &&
        run.recordingStatus === "AVAILABLE"
      )
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
