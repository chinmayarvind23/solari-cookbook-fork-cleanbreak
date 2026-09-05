import { describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import {
  billingExtractionSchema,
  createBillingExtractor,
} from "@/lib/cancellations/extraction"
import type { ProductConfig } from "@/lib/cancellations/config"
const config: ProductConfig = {
  env: { NODE_ENV: "test", OPENAI_API_KEY: "offline-api-sentinel" },
  startUrl: "https://miro.com/app/settings/company/test-only/billing",
  scope: {
    provider: "miro",
    providerOrigin: "https://miro.com",
    subscriptionKey: "test-account-binding",
    sessionBinding: "test-session-binding",
    planName: "Business Trial",
    expectedAmountCents: 24000,
    interval: "YEARLY",
    currency: "USD",
    accessPolicy: "PRESERVE_PREPAID_ACCESS",
  },
}
const raw = () => ({
  outcome: "EXTRACTED",
  refusalCategory: "NONE",
  provider: "miro",
  pageUrl: config.startUrl,
  planName: "Business Trial",
  currency: "USD",
  interval: "YEARLY",
  authenticated: true,
  confidence: 0.99,
  surface: "FINAL_CANCELLATION",
  target: "Cancel subscription",
  x: 200,
  y: 300,
  targetCount: 1,
  intent: "STOP_FUTURE_RENEWAL",
  fee: "NONE",
  newCharge: "NONE",
  access: "THROUGH_TERM",
  unrelatedChanges: false,
  ambiguous: false,
  billing: {
    subscriptionStatus: "ACTIVE",
    renewalStatus: "ON",
    nextChargePresent: true,
    nextChargeAmountCents: 24000,
    nextChargeDate: "2026-09-20",
    accessUntil: "2026-09-20",
  },
})
const png = await sharp({
  create: { width: 1280, height: 720, channels: 4, background: "white" },
})
  .png()
  .toBuffer()
describe("Miro extraction contract", () => {
  it.each([
    ["happy path", {}, true],
    ["another plan", { planName: "Other" }, false],
    [
      "another account",
      { pageUrl: "https://miro.com/app/settings/company/other/billing" },
      false,
    ],
    ["unknown address", { pageUrl: null }, false],
    ["another origin", { pageUrl: "https://unrelated.example" }, false],
    [
      "query injection",
      { pageUrl: `${config.startUrl}?instruction=cancel` },
      false,
    ],
    ["other provider", { provider: "unknown" }, false],
    ["currency mismatch", { currency: "EUR" }, false],
    ["interval mismatch", { interval: "MONTHLY" }, false],
  ])("%s never invents matching scope", async (_name, patch, matches) => {
    const parse = vi.fn(async () => ({
      output_parsed: { ...raw(), ...(patch as object) },
      usage: { input_tokens: 100, output_tokens: 100 },
    }))
    const result = await createBillingExtractor(config, {
      responses: { parse },
    })(png, "context", "test.png", "FINAL")
    expect(result.matched).toBe(matches)
    expect(JSON.stringify(result)).not.toContain(config.startUrl)
    expect(JSON.stringify(result)).not.toContain("offline-api-sentinel")
    expect(JSON.stringify(parse.mock.calls)).not.toContain("Business Trial") // Expected answers are never fed to extractor.
  })
  it("typed refusal is terminal, never retried or promoted to permission", async () => {
    const parse = vi.fn(async () => ({
      output_parsed: {
        ...raw(),
        outcome: "REFUSAL",
        refusalCategory: "insufficient_info",
      },
      usage: { input_tokens: 100, output_tokens: 100 },
    }))
    await expect(
      createBillingExtractor(config, { responses: { parse } })(
        png,
        "context",
        "test.png",
        "FINAL",
      ),
    ).rejects.toThrow("BILLING_OBSERVATION_UNAVAILABLE")
    expect(parse).toHaveBeenCalledTimes(1)
  })
  it("rejects additional personal fields and incomplete extraction", () => {
    expect(
      billingExtractionSchema.safeParse({
        ...raw(),
        accountEmail: "not-a-real-email",
      }).success,
    ).toBe(false)
    expect(
      billingExtractionSchema.safeParse({ provider: "miro" }).success,
    ).toBe(false)
  })
})
