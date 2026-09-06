// Require explicit eligibility before replacing saved authentication state.
import type { PageObservation } from "@/lib/agent/types"

export type ProfileStateSaveSkippedReason =
  | "ANTI_BOT_CHALLENGE"
  | "LOGIN_REQUIRED"
  | "PROVIDER_NOT_REACHED"
  | "PERSISTENCE_DISABLED"
  | "AUTHENTICATION_NOT_ESTABLISHED"
  | "RUN_NOT_SUCCESSFUL"
  | "SAVE_NOT_CONFIRMED"
  | "STATE_EMPTY"
  | "PROFILE_SAVE_FAILED"

// Trusted server code only: never derive these callbacks or the allowlist from
// planner output or provider page instructions. No production adapter is enabled.
export type ProfileStateRefreshFlow = {
  allowedPageUrls: readonly string[]
  verifyAuthenticatedPage(observation: PageObservation): boolean
  confirmSave(): Promise<boolean>
}

export function providerPageBlocker(
  observation: PageObservation | null,
  allowedOrigin: string,
): ProfileStateSaveSkippedReason | null {
  if (!observation) return "PROVIDER_NOT_REACHED"
  let url: URL
  try {
    url = new URL(observation.url)
  } catch {
    return "PROVIDER_NOT_REACHED"
  }
  if (url.origin !== allowedOrigin || url.username || url.password)
    return "PROVIDER_NOT_REACHED"
  const text = [
    observation.title,
    ...observation.headings,
    observation.visibleText,
    ...observation.actions.map((action) => action.name),
    url.pathname,
  ].join(" ")
  if (
    /cloudflare|just a moment|captcha|challenge|access denied|bot protection|verify (?:you are|you're|that you are) human|checking your browser|security check|unusual traffic|temporarily blocked|designing again soon/i.test(
      text,
    )
  )
    return "ANTI_BOT_CHALLENGE"
  if (
    /\blog[ -]?in\b|\bsign[ -]?in\b|\bauthenticate\b|\bpassword\b|\bmfa\b|two[ -]factor|verification code/i.test(
      text,
    ) ||
    observation.actions.some((action) => action.kind === "password")
  )
    return "LOGIN_REQUIRED"
  return null
}

export function profileStateSaveEligibility(options: {
  observation: PageObservation | null
  allowedOrigin: string
  persistenceEnabled: boolean
  runSuccessful: boolean
  refreshFlow?: ProfileStateRefreshFlow
}): {
  profileStateEligibleForSave: boolean
  skippedReason: ProfileStateSaveSkippedReason | null
} {
  const {
    observation,
    allowedOrigin,
    persistenceEnabled,
    runSuccessful,
    refreshFlow,
  } = options
  let skippedReason = providerPageBlocker(observation, allowedOrigin)
  if (!skippedReason && (!persistenceEnabled || !refreshFlow))
    skippedReason = "PERSISTENCE_DISABLED"
  if (!skippedReason && !runSuccessful) skippedReason = "RUN_NOT_SUCCESSFUL"
  if (!skippedReason) {
    // A plausible title, a nonempty state, or the planner reaching approval is
    // not proof of authentication. Require an exact page allowlist AND a trusted
    // provider-specific positive check. Unknown/error always fails closed.
    try {
      if (
        !refreshFlow!.allowedPageUrls.includes(observation!.url) ||
        refreshFlow!.verifyAuthenticatedPage(observation!) !== true
      )
        skippedReason = "AUTHENTICATION_NOT_ESTABLISHED"
    } catch {
      skippedReason = "AUTHENTICATION_NOT_ESTABLISHED"
    }
  }
  return { profileStateEligibleForSave: skippedReason === null, skippedReason }
}

export function hasNonEmptyProfileState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false
  const candidate = state as { cookies?: unknown; origins?: unknown }
  return (
    Array.isArray(candidate.cookies) &&
    Array.isArray(candidate.origins) &&
    (candidate.cookies.length > 0 ||
      candidate.origins.some(
        (origin) =>
          origin &&
          Array.isArray(origin.localStorage) &&
          origin.localStorage.length > 0,
      ))
  )
}
