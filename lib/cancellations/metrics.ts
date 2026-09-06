// Dashboard totals come from saved cancellation receipts. Amounts stay in cents.
import { digest } from "./config"
import { verificationVerdict } from "./policy"
import type { Job } from "./state"

export type TrackedRenewal = {
  subscriptionKey: string
  amountCents: number
  currency: string
  interval: "MONTHLY" | "YEARLY"
}

export function verifiedReceipt(job: Job): boolean {
  try {
    const a = job.authorization,
      receipt = job.receipt
    const annual = a.expectedAmountCents * (a.interval === "MONTHLY" ? 12 : 1)
    return Boolean(
      a.provider === "miro" &&
      job.state === "VERIFIED" &&
      job.authorizationStatus === "CONSUMED" &&
      job.authorizationUses === 1 &&
      job.destructiveClicksAttempted === 1 &&
      job.destructiveClicksExecuted === 1 &&
      job.automaticDestructiveRetries === 0 &&
      job.unsafeActionsExecuted === 0 &&
      job.verification?.result === "VERIFIED" &&
      job.verification.fresh &&
      verificationVerdict(
        a,
        job.verification.observation,
        job.verification.fresh,
      ) === "VERIFIED" &&
      job.verification.observation?.matched &&
      job.verification.observation.authenticated &&
      job.verification.observation.billing.renewalStatus === "OFF" &&
      job.verification.observation.billing.nextChargePresent === false &&
      receipt &&
      digest(receipt.payload) === receipt.digest &&
      receipt.payload.jobId === job.id &&
      digest(receipt.payload.authorization) === digest(a) &&
      digest(receipt.payload.after) === digest(job.verification) &&
      receipt.payload.destructiveClicksExecuted === 1 &&
      receipt.payload.authorizationUses === 1 &&
      receipt.payload.automaticDestructiveRetries === 0 &&
      receipt.payload.unsafeActionsExecuted === 0 &&
      Number.isSafeInteger(annual) &&
      annual >= 0 &&
      receipt.payload.annualizedSavingsCents === annual &&
      /^[A-Z]{3}$/.test(a.currency),
    )
  } catch {
    return false
  }
}

export function dashboardMetrics(
  jobs: Job[],
  configured?: TrackedRenewal | null,
) {
  // The newest observation owns each subscription, including failed outcomes.
  const latest = new Map<string, Job>()
  const readable = jobs.filter(
    (job) => job && typeof job.updatedAt === "string" && job.authorization,
  )
  for (const job of readable.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (job.authorization?.provider !== "miro") continue
    if (!latest.has(job.authorization.subscriptionKey))
      latest.set(job.authorization.subscriptionKey, job)
  }
  const verified = [...latest.values()].filter(verifiedReceipt)
  const amounts = new Map<string, number>()
  for (const job of verified) {
    const a = job.authorization
    amounts.set(
      a.currency,
      (amounts.get(a.currency) ?? 0) +
        a.expectedAmountCents * (a.interval === "MONTHLY" ? 12 : 1),
    )
  }
  const canceled = Boolean(
    configured &&
    verified.some(
      (job) => job.authorization.subscriptionKey === configured.subscriptionKey,
    ),
  )
  const potentialCents =
    configured && !canceled
      ? configured.amountCents * (configured.interval === "MONTHLY" ? 12 : 1)
      : 0
  return {
    verified,
    totals: [...amounts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, annualCents]) => ({ currency, annualCents })),
    potentialCents,
    activeCount: configured && !canceled ? 1 : 0,
    currency: configured?.currency ?? "USD",
  }
}
