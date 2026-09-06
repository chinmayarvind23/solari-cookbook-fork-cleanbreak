// Allow a fresh authorization only for eligible failures with no destructive claim.
import type { Job, Scope } from "./state"

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

// Only a fresh authorization can bind a replacement Desktop. All subscription
// and financial terms must still match; the predecessor remains immutable.
export function canStartNewAttemptForScope(job: Job, scope: Scope): boolean {
  return (
    canStartNewAttempt(job) &&
    (Object.keys(scope) as Array<keyof Scope>).every(
      (key) =>
        key === "sessionBinding" || job.authorization[key] === scope[key],
    )
  )
}
