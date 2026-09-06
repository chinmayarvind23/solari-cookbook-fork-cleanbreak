// Application-owned codes only. Never pass raw provider/SDK error strings here.
export class CancellationFailure extends Error {
  constructor(
    public readonly code:
      | "DESKTOP_NAVIGATION_MODEL_STOPPED"
      | "DESKTOP_NAVIGATION_TOKEN_BUDGET"
      | "DESKTOP_NAVIGATION_NO_PROGRESS"
      | "DESKTOP_NAVIGATION_MAX_STEPS"
      | "PROVIDER_LOADING_TIMEOUT"
      | "FINAL_BOUNDARY_NOT_ESTABLISHED"
      | "FINAL_TARGET_CHANGED"
      | "BILLING_OBSERVATION_UNAVAILABLE"
      | "SCREENSHOT_UPLOADS_DISABLED",
  ) {
    super(code)
  }
}

export function navigationFailure(reason: string) {
  switch (reason) {
    case "MODEL_STOPPED":
      return new CancellationFailure("DESKTOP_NAVIGATION_MODEL_STOPPED")
    case "TOKEN_BUDGET":
      return new CancellationFailure("DESKTOP_NAVIGATION_TOKEN_BUDGET")
    case "NAVIGATION_NO_PROGRESS":
      return new CancellationFailure("DESKTOP_NAVIGATION_NO_PROGRESS")
    case "MAX_STEPS":
      return new CancellationFailure("DESKTOP_NAVIGATION_MAX_STEPS")
    case "PROVIDER_LOADING_TIMEOUT":
      return new CancellationFailure("PROVIDER_LOADING_TIMEOUT")
    default:
      return new CancellationFailure("FINAL_BOUNDARY_NOT_ESTABLISHED")
  }
}
