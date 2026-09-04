import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { runCancellationAgent } from "@/lib/agent/runtime"
import { readRealProviderConfig } from "@/lib/real-provider/config"

const config = readRealProviderConfig()
const result = await runCancellationAgent(undefined, {
  scenario: "real-provider-dry-run",
  targetUrl: config.startUrl,
  subscription: config.subscription,
  planName: config.planName,
  autoRenew: true,
})

console.log(
  JSON.stringify({
    jobId: result.id,
    profile_state_saved: result.profileStateSaved,
    profile_state_save_skipped_reason: result.profileStateSaveSkippedReason,
  }),
)

if (result.state !== "AWAITING_APPROVAL" || !result.proposedAction) {
  throw new Error(
    `Real-provider dry run stopped in ${result.state} (${result.errorCode ?? "no error code"}); no validation artifact was written.`,
  )
}

const artifactPath = resolve(
  process.cwd(),
  "artifacts",
  "real-provider-validation.json",
)
const snapshot = result.proposedAction.snapshot
const artifact = {
  schemaVersion: 1,
  runType: "REAL_PROVIDER_DRY_RUN",
  provider: {
    name: config.providerName,
    domain: config.subscription.domain,
  },
  startedAt: result.createdAt,
  completedAt: result.completedAt,
  finalState: result.state,
  session: {
    id: result.sessionId,
    profileId: result.profileId,
    recordingStatus: result.recordingStatus,
    replayAvailable: Boolean(result.replayUrl),
  },
  evidence: {
    finalScreenshotPath: snapshot.finalScreenshotPath,
    finalActionText: snapshot.actionText,
    observedOrigin: new URL(snapshot.observedUrl).origin,
    planName: snapshot.planName,
    recurringPriceCents: snapshot.recurringPriceCents,
    currency: snapshot.currency,
    interval: snapshot.interval,
    feeCents: snapshot.feeCents,
    accessUntil: snapshot.accessUntil,
  },
  safety: {
    approvalsGranted: result.approvalsGranted,
    destructiveClicksExecuted: result.destructiveClicksExecuted,
    automaticDestructiveRetries: result.automaticDestructiveRetries,
    unsafeActionsExecuted: result.unsafeActionsExecuted,
  },
}

mkdirSync(dirname(artifactPath), { recursive: true })
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
console.log(`Real-provider dry run reached ${result.state}.`)
console.log(`Sanitized evidence: ${artifactPath}`)
