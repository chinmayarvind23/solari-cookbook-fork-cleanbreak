// Application-owned codes only. Never pass raw provider/SDK error strings here.
export class CancellationFailure extends Error {
  constructor(
    public readonly code:
      | "DESKTOP_NAVIGATION_MODEL_STOPPED"
      | "PROVIDER_LOADING_TIMEOUT"
      | "FINAL_BOUNDARY_NOT_ESTABLISHED"
      | "FINAL_TARGET_CHANGED"
      | "BILLING_OBSERVATION_UNAVAILABLE",
  ) {
    super(code)
  }
}
