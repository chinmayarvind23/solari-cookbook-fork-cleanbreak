import { approveCancellation } from "@/lib/agent/commit"
import { runCancellationAgent } from "@/lib/agent/runtime"
import { getDemoState, resetDemo } from "@/lib/db"
import { runIndependentVerification } from "@/lib/verification/runtime"

resetDemo("dark-pattern")
const before = getDemoState()
const navigation = await runCancellationAgent()
const proposal = navigation.proposedAction
if (navigation.state !== "AWAITING_APPROVAL" || !proposal) {
  throw new Error(
    `Verification smoke did not reach approval: ${navigation.errorCode ?? "UNKNOWN"}`,
  )
}
const committed = await approveCancellation(navigation.id, proposal.fingerprint)
if (committed.state !== "VERIFYING") {
  throw new Error(
    `Verification smoke did not reach VERIFYING: ${committed.state}`,
  )
}
const verified = await runIndependentVerification(committed.id)
const after = getDemoState()
if (
  verified.state !== "VERIFIED" ||
  verified.verification?.status !== "VERIFIED"
) {
  throw new Error(
    `Fresh verification failed: ${verified.verification?.status ?? verified.state}`,
  )
}
if (
  verified.commitAttempt?.sessionId ===
  verified.verification.verificationSessionId
) {
  throw new Error(
    "Fresh-session invariant failed: execution and verification IDs match.",
  )
}
if (
  after.status !== "CANCELED" ||
  after.autoRenew ||
  after.nextChargeDate !== null
) {
  throw new Error(
    "Authoritative fixture truth does not show stopped future billing.",
  )
}

console.log(
  JSON.stringify(
    {
      scenario: before.scenario,
      model: verified.model,
      jobId: verified.id,
      navigationSteps: verified.steps,
      destructiveClicksExecuted: verified.destructiveClicksExecuted,
      automaticDestructiveRetries: verified.automaticDestructiveRetries,
      executionSessionId: verified.commitAttempt?.sessionId,
      verificationSessionId: verified.verification.verificationSessionId,
      sessionsDiffer:
        verified.commitAttempt?.sessionId !==
        verified.verification.verificationSessionId,
      sameProfileId: verified.profileId,
      result: verified.verification.status,
      authoritativeStatus: after.status,
      autoRenew: after.autoRenew,
      nextChargeDate: after.nextChargeDate,
      accessUntil: after.accessUntil,
      screenshotUrl: verified.verification.screenshotUrl,
      replayUrl: verified.verification.replayUrl,
      recordingStatus: verified.verification.recordingStatus,
      cleanup: {
        browserReleased: verified.verification.browserReleased,
        clientClosed: verified.verification.clientClosed,
      },
      falseVerified: verified.falseVerified,
    },
    null,
    2,
  ),
)
