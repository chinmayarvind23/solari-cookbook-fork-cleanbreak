import { readAgentConfig } from "@/lib/agent/config"
import { readRealProviderConfig } from "@/lib/real-provider/config"
import { readDesktopSessionState, resolveDesktopSessionId } from "./session"

type Environment = Readonly<Record<string, string | undefined>>

export function realProviderExecutor(
  env: Environment = process.env,
): "browser" | "desktop" {
  const value = env.CLEANBREAK_REAL_PROVIDER_EXECUTOR?.trim() || "browser"
  if (value !== "browser" && value !== "desktop")
    throw new Error(
      "CLEANBREAK_REAL_PROVIDER_EXECUTOR must be browser or desktop.",
    )
  return value
}

export function readDesktopClientConfig(env: Environment = process.env) {
  const apiKey = env.SOLARI_API_KEY?.trim()
  if (!apiKey) throw new Error("SOLARI_API_KEY is required.")
  const baseUrl =
    env.SOLARI_DESKTOP_BASE_URL?.trim() || "https://api.getsolari.com"
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error("Invalid SOLARI_DESKTOP_BASE_URL.")
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error(
      "SOLARI_DESKTOP_BASE_URL must be an HTTPS origin without credentials.",
    )
  return { apiKey, baseUrl: parsed.origin }
}

export function readDesktopConnection(
  env: Environment = process.env,
  loadState = readDesktopSessionState,
) {
  const client = readDesktopClientConfig(env)
  const desktopId = resolveDesktopSessionId(env, loadState)
  if (desktopId.includes(client.apiKey))
    throw new Error("Desktop session ID must not contain SOLARI_API_KEY.")
  return { ...client, desktopId }
}

export function readDesktopConfig(env: Environment = process.env) {
  if (realProviderExecutor(env) !== "desktop")
    throw new Error("Set CLEANBREAK_REAL_PROVIDER_EXECUTOR=desktop.")
  if (env.CLEANBREAK_DRY_RUN?.trim().toLowerCase() !== "true")
    throw new Error(
      "CLEANBREAK_DRY_RUN=true is explicitly required for Desktop validation.",
    )
  const provider = readRealProviderConfig(env)
  return {
    ...readDesktopConnection(env),
    provider,
    agent: readAgentConfig(env as NodeJS.ProcessEnv),
    maxTokens: 20_000,
    healthAttempts: 30,
  }
}
export type DesktopConfig = ReturnType<typeof readDesktopConfig>
