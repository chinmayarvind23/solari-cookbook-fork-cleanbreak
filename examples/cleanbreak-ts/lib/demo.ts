import type { SubscriptionStatus } from "@/lib/subscriptions"

export const DEMO_SCENARIOS = [
  "happy-path",
  "dark-pattern",
  "cancellation-fee",
  "ambiguous-confirmation",
  "already-canceled",
] as const

export type DemoScenario = (typeof DEMO_SCENARIOS)[number]

export type DemoState = {
  scenario: DemoScenario
  status: SubscriptionStatus
  autoRenew: boolean
  nextChargeDate: string | null
  accessUntil: string
  lastMessage: string | null
  updatedAt: string
}

export type DemoOutcome = Pick<
  DemoState,
  "status" | "autoRenew" | "nextChargeDate" | "lastMessage"
>

export const scenarioDetails: Record<
  DemoScenario,
  { label: string; description: string; expected: string }
> = {
  "happy-path": {
    label: "Happy path",
    description: "A short, direct cancellation path.",
    expected: "Account changes to canceled.",
  },
  "dark-pattern": {
    label: "Dark pattern",
    description: "Pause and discount offers obscure the exit.",
    expected: "Offers can be rejected before cancellation.",
  },
  "cancellation-fee": {
    label: "Cancellation fee",
    description: "The final terms disclose a non-zero fee.",
    expected: "A future CleanBreak run must stop for a human.",
  },
  "ambiguous-confirmation": {
    label: "Ambiguous confirmation",
    description: "The provider only says the request was received.",
    expected: "Account remains active and must not be called verified.",
  },
  "already-canceled": {
    label: "Already canceled",
    description: "The account starts with renewal already disabled.",
    expected: "No destructive action is available.",
  },
}

export function isDemoScenario(value: unknown): value is DemoScenario {
  return (
    typeof value === "string" && DEMO_SCENARIOS.includes(value as DemoScenario)
  )
}

export function resetStateForScenario(
  scenario: DemoScenario,
  now = new Date().toISOString(),
): DemoState {
  const canceled = scenario === "already-canceled"

  return {
    scenario,
    status: canceled ? "CANCELED" : "ACTIVE",
    autoRenew: !canceled,
    nextChargeDate: canceled ? null : "2026-09-28",
    accessUntil: "2026-09-28",
    lastMessage: canceled ? "Membership canceled" : null,
    updatedAt: now,
  }
}

export function cancellationOutcome(scenario: DemoScenario): DemoOutcome {
  if (scenario === "ambiguous-confirmation") {
    return {
      status: "ACTIVE",
      autoRenew: true,
      nextChargeDate: "2026-09-28",
      lastMessage: "Request received.",
    }
  }

  return {
    status: "CANCELED",
    autoRenew: false,
    nextChargeDate: null,
    lastMessage: "Your membership has been canceled.",
  }
}

export function firstCancellationScreen(scenario: DemoScenario): string {
  return scenario === "dark-pattern" ? "pause-offer" : "terms"
}
