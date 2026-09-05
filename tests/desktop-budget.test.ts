import { describe, expect, it } from "vitest"
import {
  DESKTOP_TOKENS_PER_STEP,
  MAX_DESKTOP_TOKEN_BUDGET,
  MIN_DESKTOP_TOKEN_BUDGET,
  readDesktopTokenBudget,
  type DesktopBudgetEnvironment,
} from "@/lib/desktop/budget"
import { readDesktopConfig } from "@/lib/desktop/config"

const env: DesktopBudgetEnvironment = {
  SOLARI_API_KEY: "offline-solari-key",
  OPENAI_API_KEY: "offline-openai-key",
  SOLARI_DESKTOP_SESSION_ID: "pool:vm:org.offline-session",
  CLEANBREAK_REAL_PROVIDER_EXECUTOR: "desktop",
  CLEANBREAK_DRY_RUN: "true",
  CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
  CLEANBREAK_REAL_PROVIDER_NAME: "Test Provider",
  CLEANBREAK_REAL_PROVIDER_PLAN_NAME: "Test trial",
  CLEANBREAK_REAL_PROVIDER_URL: "https://provider.example/billing",
  CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS: "100",
  CLEANBREAK_REAL_PROVIDER_CURRENCY: "USD",
  CLEANBREAK_REAL_PROVIDER_INTERVAL: "MONTHLY",
}

describe("bounded Desktop token configuration", () => {
  it("defaults a 20-step run to 100,000 tokens", () => {
    expect(readDesktopTokenBudget({}, 20)).toBe(100_000)
    expect(readDesktopConfig(env)).toMatchObject({
      agent: { maxSteps: 20 },
      maxTokens: 100_000,
    })
  })

  it.each([1, 5, 10, 30])("scales the default with %i steps", (maxSteps) => {
    expect(readDesktopTokenBudget({}, maxSteps)).toBe(
      maxSteps * DESKTOP_TOKENS_PER_STEP,
    )
    expect(
      readDesktopConfig({
        ...env,
        CLEANBREAK_AGENT_MAX_STEPS: String(maxSteps),
      }).maxTokens,
    ).toBe(maxSteps * DESKTOP_TOKENS_PER_STEP)
  })

  it("caps even a larger step-derived default at 200,000 tokens", () => {
    expect(readDesktopTokenBudget({}, 100)).toBe(MAX_DESKTOP_TOKEN_BUDGET)
    expect(readDesktopTokenBudget({}, 1)).toBe(MIN_DESKTOP_TOKEN_BUDGET)
  })

  it("honors an explicit 20,000-token budget", () => {
    const configured = { ...env, CLEANBREAK_DESKTOP_MAX_TOKENS: " 20000 " }
    expect(readDesktopTokenBudget(configured, 20)).toBe(20_000)
    expect(readDesktopConfig(configured).maxTokens).toBe(20_000)
  })

  it.each([5_000, 200_000])("accepts the inclusive %i-token bound", (value) => {
    expect(
      readDesktopTokenBudget(
        { CLEANBREAK_DESKTOP_MAX_TOKENS: String(value) },
        20,
      ),
    ).toBe(value)
  })

  it.each([
    "NaN",
    "0",
    "-1",
    "4999",
    "20000.5",
    "unbounded",
    "unlimited",
    "Infinity",
    "200001",
    "9007199254740992",
    "",
    " ",
    "private-invalid-budget",
  ])("rejects invalid explicit budget %j without echoing it", (value) => {
    const configured = { ...env, CLEANBREAK_DESKTOP_MAX_TOKENS: value }
    const message =
      "CLEANBREAK_DESKTOP_MAX_TOKENS must be an integer between 5000 and 200000."
    expect(() => readDesktopTokenBudget(configured, 20)).toThrow(message)
    expect(() => readDesktopConfig(configured)).toThrow(message)
  })

  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid maxSteps %j instead of deriving an unlimited budget",
    (maxSteps) => {
      expect(() => readDesktopTokenBudget({}, maxSteps)).toThrow(
        "Desktop maxSteps must be a positive safe integer.",
      )
    },
  )
})
