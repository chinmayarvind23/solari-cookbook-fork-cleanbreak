export class SolariConfigurationError extends Error {
  readonly code = "SOLARI_CONFIGURATION_ERROR"
}

export type SolariConfig = {
  apiKey: string
  publicBaseUrl: string
  targetUrl: string
  profileId?: string
  profileName: string
  stealth: boolean
  persistProfileState: boolean
  navigationTimeoutMs: number
}

export type SolariReadiness = {
  apiKeyConfigured: boolean
  publicTargetConfigured: boolean
  publicTargetValid: boolean
  targetHost: string | null
  message: string
}

type Environment = Readonly<Record<string, string | undefined>>

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback
  return value.trim().toLowerCase() === "true"
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  )
}

export function parsePublicBaseUrl(value: string | undefined): URL {
  if (!value?.trim()) {
    throw new SolariConfigurationError(
      "CLEANBREAK_PUBLIC_BASE_URL is required for a remote Solari session.",
    )
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SolariConfigurationError(
      "CLEANBREAK_PUBLIC_BASE_URL must be a valid absolute URL.",
    )
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  const localNames =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")

  if (
    !["http:", "https:"].includes(url.protocol) ||
    localNames ||
    isPrivateIpv4(host) ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    throw new SolariConfigurationError(
      "CLEANBREAK_PUBLIC_BASE_URL must be a publicly reachable HTTP(S) URL, not localhost or a private address.",
    )
  }

  url.pathname = url.pathname.replace(/\/$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url
}

export function readSolariConfig(
  env: Environment = process.env,
  targetUrlOverride?: string,
): SolariConfig {
  const apiKey = env.SOLARI_API_KEY?.trim()
  if (!apiKey) {
    throw new SolariConfigurationError(
      "SOLARI_API_KEY is required and must remain server-side.",
    )
  }

  if (env.SOLARI_RECORDING?.trim().toLowerCase() === "false") {
    throw new SolariConfigurationError(
      "SOLARI_RECORDING must be enabled for recorded browser runs.",
    )
  }

  const base = parsePublicBaseUrl(
    targetUrlOverride ?? env.CLEANBREAK_PUBLIC_BASE_URL,
  )
  const timeout = Number(env.SOLARI_NAVIGATION_TIMEOUT_MS ?? "30000")
  if (!Number.isFinite(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new SolariConfigurationError(
      "SOLARI_NAVIGATION_TIMEOUT_MS must be between 1000 and 120000.",
    )
  }

  return {
    apiKey,
    publicBaseUrl: base.toString().replace(/\/$/, ""),
    targetUrl: targetUrlOverride
      ? base.toString()
      : new URL("/demo/streammax/account", base).toString(),
    profileId: env.SOLARI_PROFILE_ID?.trim() || undefined,
    profileName: env.SOLARI_PROFILE_NAME?.trim() || "cleanbreak-demo",
    stealth: asBoolean(env.SOLARI_STEALTH, false),
    persistProfileState: asBoolean(
      env.SOLARI_PERSIST_PROFILE_STATE,
      targetUrlOverride === undefined,
    ),
    navigationTimeoutMs: timeout,
  }
}

export function getSolariReadiness(
  env: Environment = process.env,
): SolariReadiness {
  const apiKeyConfigured = Boolean(env.SOLARI_API_KEY?.trim())
  const publicTargetConfigured = Boolean(env.CLEANBREAK_PUBLIC_BASE_URL?.trim())

  try {
    const target = parsePublicBaseUrl(env.CLEANBREAK_PUBLIC_BASE_URL)
    return {
      apiKeyConfigured,
      publicTargetConfigured,
      publicTargetValid: true,
      targetHost: target.hostname,
      message: apiKeyConfigured
        ? "Ready to start a recorded Solari browser session."
        : "Add SOLARI_API_KEY on the server to enable the run control.",
    }
  } catch (error) {
    return {
      apiKeyConfigured,
      publicTargetConfigured,
      publicTargetValid: false,
      targetHost: null,
      message:
        error instanceof Error
          ? error.message
          : "The public target configuration is invalid.",
    }
  }
}
