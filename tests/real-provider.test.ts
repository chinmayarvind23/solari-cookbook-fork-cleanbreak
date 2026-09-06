// Checks external-provider configuration and dry-run safety.
import { describe, expect, it } from "vitest"

import { isCleanBreakDryRun } from "@/lib/agent/config"
import {
  readRealProviderConfig,
  RealProviderConfigurationError,
} from "@/lib/real-provider/config"
import { readSolariConfig } from "@/lib/solari/config"

const configured = {
  CLEANBREAK_DRY_RUN: "true",
  CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
  CLEANBREAK_REAL_PROVIDER_NAME: "Owned Provider",
  CLEANBREAK_REAL_PROVIDER_URL:
    "https://billing.provider.example/account/subscription",
  CLEANBREAK_REAL_PROVIDER_PLAN_NAME: "Individual",
  CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS: "1299",
  CLEANBREAK_REAL_PROVIDER_CURRENCY: "usd",
  CLEANBREAK_REAL_PROVIDER_INTERVAL: "monthly",
  CLEANBREAK_REAL_PROVIDER_NEXT_RENEWAL: "2026-10-01",
}

describe("real-provider dry-run configuration", () => {
  it("defaults the server commit gate to dry-run mode", () => {
    expect(isCleanBreakDryRun({})).toBe(true)
    expect(isCleanBreakDryRun({ CLEANBREAK_DRY_RUN: "false" })).toBe(false)
  })

  it("requires an explicit ownership or control attestation", () => {
    expect(() =>
      readRealProviderConfig({
        ...configured,
        CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "false",
      }),
    ).toThrow(RealProviderConfigurationError)
  })

  it("refuses to run when the server dry-run gate is disabled", () => {
    expect(() =>
      readRealProviderConfig({
        ...configured,
        CLEANBREAK_DRY_RUN: "false",
      }),
    ).toThrow("CLEANBREAK_DRY_RUN=true")
  })

  it("builds an explicit, sanitized provider target", () => {
    expect(readRealProviderConfig(configured)).toMatchObject({
      providerName: "Owned Provider",
      planName: "Individual",
      startUrl: "https://billing.provider.example/account/subscription",
      subscription: {
        id: "sub_real_provider",
        domain: "billing.provider.example",
        amount: 12.99,
        currency: "USD",
        interval: "MONTHLY",
        nextRenewalDate: "2026-10-01",
      },
    })
  })

  it("uses the explicit provider URL as the Solari target", () => {
    expect(
      readSolariConfig(
        { SOLARI_API_KEY: "server-secret" },
        "https://billing.provider.example/account/subscription",
      ).targetUrl,
    ).toBe("https://billing.provider.example/account/subscription")
  })
})
