export type AgentConfig = {
  apiKey: string
  model: string
  maxSteps: number
  minConfidence: number
  requestTimeoutMs: number
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
  return {
    configured,
    model: environment.OPENAI_MODEL?.trim() || "gpt-5.6",
    message: configured
      ? "OpenAI planning is configured server-side."
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
