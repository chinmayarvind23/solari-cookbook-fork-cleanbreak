// Check the user's approval against the proposed cancellation and its current terms.
import { createHash } from "node:crypto"

import type { ApprovalSnapshot, ProposedAction } from "@/lib/agent/types"
import type { Subscription } from "@/lib/subscriptions"

export type ApprovalContext = {
  jobId: string
  subscription: Subscription
  planName: string
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function canonicalApprovalSnapshot(
  snapshot: ApprovalSnapshot,
): ApprovalSnapshot {
  return {
    jobId: snapshot.jobId,
    subscriptionId: snapshot.subscriptionId,
    serviceName: normalizeText(snapshot.serviceName),
    serviceDomain: snapshot.serviceDomain.trim().toLowerCase(),
    planName: normalizeText(snapshot.planName),
    recurringPriceCents: snapshot.recurringPriceCents,
    currency: snapshot.currency.trim().toUpperCase(),
    interval: snapshot.interval,
    annualSavingsCents: snapshot.annualSavingsCents,
    currentStatus: snapshot.currentStatus,
    actionText: normalizeText(snapshot.actionText),
    targetRole: snapshot.targetRole.trim().toLowerCase(),
    observedUrl: new URL(snapshot.observedUrl).toString(),
    feeCents: snapshot.feeCents,
    accessUntil: snapshot.accessUntil
      ? normalizeText(snapshot.accessUntil)
      : null,
    visibleTerms: snapshot.visibleTerms.map(normalizeText).filter(Boolean),
    finalScreenshotPath: snapshot.finalScreenshotPath,
    observedAt: snapshot.observedAt,
    proposedActionCreatedAt: snapshot.proposedActionCreatedAt,
  }
}

export function approvalFingerprint(snapshot: ApprovalSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalApprovalSnapshot(snapshot)))
    .digest("hex")
}

export function materialApprovalTerms(
  action: ProposedAction,
): Omit<
  ApprovalSnapshot,
  "observedAt" | "proposedActionCreatedAt" | "finalScreenshotPath"
> {
  const {
    observedAt: _observedAt,
    proposedActionCreatedAt: _createdAt,
    finalScreenshotPath: _screenshot,
    ...material
  } = canonicalApprovalSnapshot(action.snapshot)
  return material
}

export function materiallyMatches(
  approved: ProposedAction,
  observed: ProposedAction,
): boolean {
  return (
    JSON.stringify(materialApprovalTerms(approved)) ===
    JSON.stringify(materialApprovalTerms(observed))
  )
}
