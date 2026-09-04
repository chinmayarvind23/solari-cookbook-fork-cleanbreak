import { readAgentConfig } from "@/lib/agent/config"
import { readRealProviderConfig } from "@/lib/real-provider/config"

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

export function readDesktopConnection(env: Environment = process.env) {
  const apiKey = env.SOLARI_API_KEY?.trim()
  const desktopId = env.SOLARI_DESKTOP_ID?.trim()
  if (!apiKey) throw new Error("SOLARI_API_KEY is required.")
  if (!desktopId)
    throw new Error(
      "SOLARI_DESKTOP_ID is required; create and authenticate a dedicated VM first.",
    )
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
  return { apiKey, desktopId, baseUrl: parsed.origin }
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
