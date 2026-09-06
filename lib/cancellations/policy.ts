// Check authorization, final targets, and stopped-renewal evidence.
import { digest } from "./config"
import type {
  Authorization,
  Billing,
  Observation,
  Scope,
  Verification,
} from "./state"
export const sameScope = (a: Scope, b: Scope) =>
  digest({
    provider: a.provider,
    providerOrigin: a.providerOrigin,
    subscriptionKey: a.subscriptionKey,
    sessionBinding: a.sessionBinding,
    planName: a.planName,
    expectedAmountCents: a.expectedAmountCents,
    currency: a.currency,
    interval: a.interval,
    accessPolicy: a.accessPolicy,
  }) ===
  digest({
    provider: b.provider,
    providerOrigin: b.providerOrigin,
    subscriptionKey: b.subscriptionKey,
    sessionBinding: b.sessionBinding,
    planName: b.planName,
    expectedAmountCents: b.expectedAmountCents,
    currency: b.currency,
    interval: b.interval,
    accessPolicy: b.accessPolicy,
  })
export function validFinal(
  a: Authorization,
  o: Observation,
  now: number,
): boolean {
  return (
    Date.parse(a.expiresAt) > now &&
    now - Date.parse(o.observedAt) <= 30_000 &&
    Date.parse(o.observedAt) <= now &&
    sameScope(a, o.scope) &&
    o.matched &&
    o.authenticated &&
    o.confidence >= 0.95 &&
    o.surface === "FINAL_CANCELLATION" &&
    o.target !== "UNKNOWN" &&
    o.targetCount === 1 &&
    o.intent === "STOP_FUTURE_RENEWAL" &&
    o.fee === "NONE" &&
    o.newCharge === "NONE" &&
    o.access === "THROUGH_TERM" &&
    !o.unrelatedChanges &&
    !o.ambiguous &&
    Number.isInteger(o.x) &&
    Number.isInteger(o.y) &&
    o.x >= 0 &&
    o.y >= 0 &&
    o.x < o.width &&
    o.y < o.height &&
    o.billing.nextChargePresent === true &&
    o.billing.nextChargeAmountCents === a.expectedAmountCents
  )
}
export function actionFingerprint(a: Authorization, o: Observation) {
  return digest({
    authorizationId: a.id,
    origin: a.providerOrigin,
    subscriptionKey: a.subscriptionKey,
    plan: a.planName,
    target: o.target,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    intent: o.intent,
    fee: o.fee,
    newCharge: o.newCharge,
    access: o.access,
    unrelatedChanges: o.unrelatedChanges,
    before: o.billing,
    version: o.version,
    observedAt: o.observedAt,
    screenshotHash: o.screenshotHash,
  })
}
export function sameAction(a: Observation, b: Observation) {
  return (
    sameScope(a.scope, b.scope) &&
    a.target === b.target &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.intent === b.intent &&
    a.fee === b.fee &&
    a.newCharge === b.newCharge &&
    a.access === b.access &&
    digest(a.billing) === digest(b.billing)
  )
}
export function billingVerdict(b: Billing): Verification["result"] {
  const stopped =
    ["CANCELED", "SCHEDULED"].includes(b.subscriptionStatus) &&
    b.renewalStatus === "OFF" &&
    b.nextChargePresent === false &&
    b.nextChargeAmountCents === null &&
    b.nextChargeDate === null &&
    (b.subscriptionStatus !== "SCHEDULED" || b.accessUntil !== null)
  const active =
    b.subscriptionStatus === "ACTIVE" &&
    b.renewalStatus === "ON" &&
    b.nextChargePresent === true &&
    b.nextChargeAmountCents !== null &&
    b.nextChargeDate !== null
  return stopped ? "VERIFIED" : active ? "NOT_VERIFIED" : "INCONCLUSIVE"
}
export function verificationVerdict(
  a: Scope,
  observation: Observation | null,
  fresh: boolean,
): Verification["result"] {
  if (
    !fresh ||
    !observation ||
    !sameScope(a, observation.scope) ||
    !observation.matched ||
    !observation.authenticated ||
    observation.confidence < 0.95 ||
    observation.surface !== "BILLING_PAGE" ||
    observation.ambiguous
  )
    return "INCONCLUSIVE"
  return billingVerdict(observation.billing)
}
