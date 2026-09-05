export const DESKTOP_TOKENS_PER_STEP = 5_000
export const MIN_DESKTOP_TOKEN_BUDGET = 5_000
export const MAX_DESKTOP_TOKEN_BUDGET = 200_000

export type DesktopBudgetEnvironment = Readonly<
  Record<string, string | undefined>
>

export function readDesktopTokenBudget(
  env: DesktopBudgetEnvironment,
  maxSteps: number,
): number {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
    throw new Error("Desktop maxSteps must be a positive safe integer.")

  const explicit = env.CLEANBREAK_DESKTOP_MAX_TOKENS
  if (explicit === undefined)
    return Math.min(
      maxSteps * DESKTOP_TOKENS_PER_STEP,
      MAX_DESKTOP_TOKEN_BUDGET,
    )

  const value = explicit.trim()
  const parsed = Number(value)
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_DESKTOP_TOKEN_BUDGET ||
    parsed > MAX_DESKTOP_TOKEN_BUDGET
  )
    throw new Error(
      `CLEANBREAK_DESKTOP_MAX_TOKENS must be an integer between ${MIN_DESKTOP_TOKEN_BUDGET} and ${MAX_DESKTOP_TOKEN_BUDGET}.`,
    )
  return parsed
}
