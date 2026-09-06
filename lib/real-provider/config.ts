// Validate the provider URL and subscription terms used by external runs.
import { isCleanBreakDryRun } from "@/lib/agent/config"
import { parsePublicBaseUrl } from "@/lib/solari/config"
import type { Subscription, SubscriptionInterval } from "@/lib/subscriptions"

export class RealProviderConfigurationError extends Error {
  readonly code = "REAL_PROVIDER_CONFIGURATION_ERROR"
}

export type RealProviderConfig = {
  providerName: string
  planName: string
  startUrl: string
  subscription: Subscription
}

type Environment = Readonly<Record<string, string | undefined>>

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new RealProviderConfigurationError(`${name} is required.`)
  return value
}

export function readRealProviderConfig(
  environment: Environment = process.env,
): RealProviderConfig {
  if (!isCleanBreakDryRun(environment)) {
    throw new RealProviderConfigurationError(
      "CLEANBREAK_DRY_RUN=true is required for real-provider validation.",
    )
  }
  if (
    environment.CLEANBREAK_REAL_PROVIDER_AUTHORIZED?.trim().toLowerCase() !==
    "true"
  ) {
    throw new RealProviderConfigurationError(
      "CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true is required to attest that the account is owned or controlled by the developer.",
    )
  }

  const providerName = required(environment, "CLEANBREAK_REAL_PROVIDER_NAME")
  const planName = required(environment, "CLEANBREAK_REAL_PROVIDER_PLAN_NAME")
  const parsedUrl = readRealProviderUrl(environment)

  const amountCents = Number(
    required(environment, "CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS"),
  )
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RealProviderConfigurationError(
      "CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS must be a nonnegative integer.",
    )
  }
  const interval = required(
    environment,
    "CLEANBREAK_REAL_PROVIDER_INTERVAL",
  ).toUpperCase()
  if (!(["MONTHLY", "YEARLY"] as string[]).includes(interval)) {
    throw new RealProviderConfigurationError(
      "CLEANBREAK_REAL_PROVIDER_INTERVAL must be MONTHLY or YEARLY.",
    )
  }
  const currency = required(
    environment,
    "CLEANBREAK_REAL_PROVIDER_CURRENCY",
  ).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RealProviderConfigurationError(
      "CLEANBREAK_REAL_PROVIDER_CURRENCY must be a three-letter currency code.",
    )
  }

  const now = new Date().toISOString()
  const startUrl = parsedUrl.toString()
  return {
    providerName,
    planName,
    startUrl,
    subscription: {
      id: "sub_real_provider",
      name: providerName,
      slug: "real-provider-validation",
      url: startUrl,
      domain: parsedUrl.hostname,
      amount: amountCents / 100,
      currency,
      interval: interval as SubscriptionInterval,
      nextRenewalDate:
        environment.CLEANBREAK_REAL_PROVIDER_NEXT_RENEWAL?.trim() || undefined,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  }
}

// Manual authentication needs the same URL validation, without plan/price fields
// or starting a validation run. Errors never include the configured URL.
export function readRealProviderUrl(
  environment: Environment = process.env,
): URL {
  const parsedUrl = parsePublicBaseUrl(
    required(environment, "CLEANBREAK_REAL_PROVIDER_URL"),
  )
  if (parsedUrl.protocol !== "https:")
    throw new RealProviderConfigurationError(
      "CLEANBREAK_REAL_PROVIDER_URL must use HTTPS.",
    )
  if (parsedUrl.username || parsedUrl.password)
    throw new RealProviderConfigurationError(
      "CLEANBREAK_REAL_PROVIDER_URL must not contain credentials.",
    )
  return parsedUrl
}
