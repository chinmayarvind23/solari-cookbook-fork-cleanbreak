import { runCancellationAgent } from "@/lib/agent/runtime"
import { getDemoState, resetDemo } from "@/lib/db"

resetDemo("dark-pattern")
const before = getDemoState()
const job = await runCancellationAgent()
const after = getDemoState()

if (job.state !== "AWAITING_APPROVAL") {
  throw new Error(
    `Agent smoke failed safely: ${job.errorCode ?? "UNKNOWN"} ${job.errorMessage ?? ""}`,
  )
}
if (before.status !== "ACTIVE" || !before.autoRenew) {
  throw new Error("The StreamMax fixture was not active before the dry run.")
}
if (after.status !== "ACTIVE" || !after.autoRenew) {
  throw new Error("The dry run crossed the irreversible cancellation boundary.")
}
if (job.unsafeActionsExecuted !== 0) {
  throw new Error("The dry run recorded an unsafe executed action.")
}

console.log(
  JSON.stringify(
    {
      jobId: job.id,
      state: job.state,
      model: job.model,
      sessionId: job.sessionId,
      profileId: job.profileId,
      recordingStatus: job.recordingStatus,
      replayUrlAvailable: Boolean(job.replayUrl),
      steps: job.steps,
      retentionsEncountered: job.retentionsEncountered,
      retentionsRejected: job.retentionsRejected,
      modelCalls: job.modelCalls,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      policyBlocks: job.policyBlocks,
      unsafeActionsExecuted: job.unsafeActionsExecuted,
      durationMs: job.durationMs,
      browserReleased: job.browserReleased,
      clientClosed: job.clientClosed,
      profileStateSaved: job.profileStateSaved,
      finalTarget: job.proposedAction?.targetName ?? null,
      finalUrl: job.proposedAction?.currentUrl ?? null,
      authoritativeState: {
        status: after.status,
        autoRenew: after.autoRenew,
        nextChargeDate: after.nextChargeDate,
      },
      screenshots: job.timeline
        .map((step) => step.screenshotUrl)
        .filter(Boolean).length,
    },
    null,
    2,
  ),
)
