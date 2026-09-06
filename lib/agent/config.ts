export type AgentConfig = {
  allowScreenshotUploads?: boolean
  apiKey: string
  model: string
  maxSteps: number
  minConfidence: number
  requestTimeoutMs: number
}

export function isCleanBreakDryRun(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.CLEANBREAK_DRY_RUN?.trim().toLowerCase() !== "false"
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback
}

export function agentReadiness(environment: NodeJS.ProcessEnv = process.env) {
  const configured = Boolean(environment.OPENAI_API_KEY?.trim())
  const dryRun = isCleanBreakDryRun(environment)
  return {
    configured,
    dryRun,
    model: environment.OPENAI_MODEL?.trim() || "gpt-5.6",
    message: configured
      ? dryRun
        ? "OpenAI planning is configured. Server-enforced dry-run mode blocks every final cancellation click."
        : "OpenAI planning is configured server-side."
      : "Set OPENAI_API_KEY in the server environment to run the dry run.",
  }
}

export function readAgentConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AgentConfig {
  const apiKey = environment.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    const error = new Error("OpenAI planning is not configured on the server.")
    error.name = "OPENAI_CONFIGURATION_ERROR"
    throw error
  }

  return {
    allowScreenshotUploads:
      environment.CLEANBREAK_ALLOW_SCREENSHOT_MODEL_UPLOADS === "true",
    apiKey,
    model: environment.OPENAI_MODEL?.trim() || "gpt-5.6",
    maxSteps: boundedInteger(environment.CLEANBREAK_AGENT_MAX_STEPS, 20, 1, 30),
    minConfidence: boundedNumber(
      environment.CLEANBREAK_AGENT_MIN_CONFIDENCE,
      0.7,
      0.5,
      1,
    ),
    requestTimeoutMs: boundedInteger(
      environment.CLEANBREAK_OPENAI_TIMEOUT_MS,
      30_000,
      5_000,
      90_000,
    ),
  }
}
