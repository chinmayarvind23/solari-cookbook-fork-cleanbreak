import type { Job, State } from "./state"
import { canStartNewAttempt } from "./new-attempt"
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
  const navigationMessages: Record<string, string> = {
    DESKTOP_NAVIGATION_NO_PROGRESS:
      "Desktop navigation stopped because page scrolling made no visible progress. The cancellation was not completed.",
    DESKTOP_NAVIGATION_TOKEN_BUDGET:
      "Desktop navigation reached its planner token limit before establishing the final cancellation control.",
    DESKTOP_NAVIGATION_MAX_STEPS:
      "Desktop navigation reached its step limit before establishing the final cancellation control.",
  }
  const navigationMessage =
    job.state === "FAILED" ? navigationMessages[job.reason ?? ""] : undefined
  return {
    id: job.id,
    state: job.state,
    message: navigationMessage ?? progressText[job.state],
    reason: job.reason,
    provider: job.authorization.provider,
    planName: job.authorization.planName,
    updatedAt: job.updatedAt,
    destructiveClicksAttempted: job.destructiveClicksAttempted,
    destructiveClicksExecuted: job.destructiveClicksExecuted,
    automaticDestructiveRetries: job.automaticDestructiveRetries,
    unsafeActionsExecuted: job.unsafeActionsExecuted,
    authorizationUses: job.authorizationUses,
    canStartNewAttempt: canStartNewAttempt(job),
    receiptUrl:
      job.state === "VERIFIED" && job.receipt
        ? `/cancellations/${job.id}/receipt`
        : null,
  }
}
export type PublicCancellation = ReturnType<typeof publicJob>
