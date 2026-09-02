import { approveCancellation } from "@/lib/agent/commit"
import { createAgentRepository } from "@/lib/agent/repository"
import { runCancellationAgent } from "@/lib/agent/runtime"
import { getDemoState, resetDemo } from "@/lib/db"

resetDemo("dark-pattern")
const before = getDemoState()
const navigation = await runCancellationAgent()
const proposal = navigation.proposedAction

if (navigation.state !== "AWAITING_APPROVAL" || !proposal) {
  throw new Error(
    `Approved smoke did not reach approval: ${navigation.errorCode ?? "UNKNOWN"}`,
  )
}
if (proposal.feeCents !== 0) {
  throw new Error(
    "Approved smoke refused nonzero or unknown cancellation fees.",
  )
}

const result = await approveCancellation(navigation.id, proposal.fingerprint)
const after = getDemoState()
const repository = createAgentRepository()
const approval = repository.getLatestApproval(navigation.id)
const attempt = repository.getCommitAttempt(navigation.id)

if (result.state !== "VERIFYING") {
  throw new Error(`Approved smoke ended in ${result.state}, not VERIFYING.`)
}
if (
  after.status !== "CANCELED" ||
  after.autoRenew ||
  after.nextChargeDate !== null
) {
  throw new Error("The approved browser action did not change fixture truth.")
}
if (
  result.destructiveClicksExecuted !== 1 ||
  result.automaticDestructiveRetries !== 0
) {
  throw new Error("The one-click/no-retry invariant was violated.")
}

console.log(
  JSON.stringify(
    {
      scenario: before.scenario,
      jobId: result.id,
      model: result.model,
      navigation: {
        steps: result.steps,
        retentionsEncountered: result.retentionsEncountered,
        retentionsRejected: result.retentionsRejected,
        modelCalls: result.modelCalls,
      },
      approval: {
        id: approval?.id ?? null,
        status: approval?.status ?? null,
        fingerprintMatched:
          approval?.actionFingerprint === proposal.fingerprint,
      },
      finalAction: proposal.targetName,
      finalState: result.state,
      commitOutcome: attempt?.outcome ?? null,
      destructiveClicksExecuted: result.destructiveClicksExecuted,
      automaticDestructiveRetries: result.automaticDestructiveRetries,
      fixture: {
        status: after.status,
        autoRenew: after.autoRenew,
        nextChargeDate: after.nextChargeDate,
        accessUntil: after.accessUntil,
      },
      evidence: {
        preScreenshot: Boolean(attempt?.preScreenshotPath),
        postScreenshot: Boolean(attempt?.postScreenshotPath),
        recordingStatus: attempt?.recordingStatus ?? null,
        replayAvailable: Boolean(attempt?.replayUrl),
      },
      cleanup: {
        browserReleased: attempt?.browserReleased ?? false,
        clientClosed: attempt?.clientClosed ?? false,
        profileStateSaved: attempt?.profileStateSaved ?? false,
      },
    },
    null,
    2,
  ),
)
