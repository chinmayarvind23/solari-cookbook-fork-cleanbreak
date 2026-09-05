import type { Job } from "./state"

// Explicit new authorization, never recovery/retry of a possibly sent action.
const eligibleReasons = new Set([
  "FINAL_BOUNDARY_NOT_ESTABLISHED",
  "DESKTOP_NAVIGATION_MODEL_STOPPED",
  "DESKTOP_NAVIGATION_TOKEN_BUDGET",
  "DESKTOP_NAVIGATION_NO_PROGRESS",
  "DESKTOP_NAVIGATION_MAX_STEPS",
  "PROVIDER_LOADING_TIMEOUT",
])
export function canStartNewAttempt(job: Job): boolean {
  return (
    job.state === "FAILED" &&
    job.authorizationStatus === "EXPIRED" &&
    job.authorizationUses === 0 &&
    job.destructiveClicksAttempted === 0 &&
    job.destructiveClicksExecuted === 0 &&
    job.unsafeActionsExecuted === 0 &&
    job.automaticDestructiveRetries === 0 &&
    eligibleReasons.has(job.reason ?? "")
  )
}
export class NewAttemptNotAllowed extends Error {
  constructor() {
    super("NEW_ATTEMPT_NOT_ALLOWED")
  }
}
