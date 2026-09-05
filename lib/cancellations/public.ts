import type { Job, State } from "./state"
export const progressText: Record<State, string> = {
  AUTHORIZED: "Cancellation authorized.",
  CONNECTING: "Connecting to authenticated session...",
  NAVIGATING: "Navigating billing settings...",
  CANCELLATION_FLOW: "Entering cancellation flow and reviewing terms...",
  COMMIT_ARMED: "Cancellation action identified...",
  COMMITTING: "Executing authorized cancellation...",
  VERIFYING: "Verifying future billing state...",
  VERIFIED: "Cancellation verified. Future renewal is off.",
  NOT_VERIFIED:
    "Cancellation was not completed. No additional destructive action was attempted.",
  INCONCLUSIVE:
    "Cancellation outcome could not be verified. CleanBreak will not retry the cancellation action.",
  FAILED:
    "Cancellation was not completed. No additional destructive action was attempted.",
}
export function publicJob(job: Job) {
  return {
    id: job.id,
    state: job.state,
    message: progressText[job.state],
    reason: job.reason,
    provider: job.authorization.provider,
    planName: job.authorization.planName,
    updatedAt: job.updatedAt,
    destructiveClicksAttempted: job.destructiveClicksAttempted,
    destructiveClicksExecuted: job.destructiveClicksExecuted,
    automaticDestructiveRetries: job.automaticDestructiveRetries,
    unsafeActionsExecuted: job.unsafeActionsExecuted,
    authorizationUses: job.authorizationUses,
    receiptUrl:
      job.state === "VERIFIED" && job.receipt
        ? `/cancellations/${job.id}/receipt`
        : null,
  }
}
export type PublicCancellation = ReturnType<typeof publicJob>
