import "server-only"
import { randomUUID } from "node:crypto"
import { digest } from "./config"
import {
  actionFingerprint,
  sameAction,
  sameScope,
  validFinal,
  verificationVerdict,
} from "./policy"
import { claimAndDispatch, type FinalDispatchGrant } from "./dispatch"
import {
  terminal,
  type Job,
  type Observation,
  type Scope,
  type State,
} from "./state"
import type { CancellationRepository } from "./repository"
import { CancellationFailure } from "./failure"

export interface CancellationDriver {
  scope: Scope
  assertEnabled(): void
  connect(): Promise<void>
  navigate(
    progress: (
      stage: "NAVIGATING" | "CANCELLATION_FLOW",
      evidence?: Job["navigation"],
    ) => void,
  ): Promise<Observation>
  revalidate(previous: Observation): Promise<Observation>
  clickFinal(observation: Observation, grant: FinalDispatchGrant): Promise<void>
  close(): Promise<void>
  finishRecording?(): Promise<Job["recording"]>
  verify(): Promise<{
    observation: Observation | null
    contextId: string
    fresh: boolean
  }>
}
export class WorkflowCrash extends Error {} // Offline fault injection; no network retry semantics.
export async function runCancellation(
  id: string,
  repository: CancellationRepository,
  driver: CancellationDriver,
  options: {
    now?: () => number
    fault?: (point: "afterArm" | "afterClaim") => void
  } = {},
) {
  const owner = randomUUID(),
    now = options.now ?? Date.now
  if (!repository.acquire(id, owner)) return repository.load(id)
  let job = repository.load(id)!
  let leaseLost = false
  const heartbeat = setInterval(() => {
    try {
      if (!repository.heartbeat(id, owner)) leaseLost = true
    } catch {
      leaseLost = true
    }
  }, 20_000)
  const check = () => {
    if (leaseLost) throw new Error("WORKER_LEASE_LOST")
    driver.assertEnabled()
    if (!sameScope(job.authorization, driver.scope))
      throw new Error("AUTHORIZATION_MISMATCH")
  }
  const update = (state: State, patch: Partial<Job> = {}) => {
    job = repository.save({ ...job, ...patch, state }, owner)
  }
  try {
    check()
    if (["CONNECTING", "NAVIGATING", "CANCELLATION_FLOW"].includes(job.state))
      throw new Error("NAVIGATION_INTERRUPTED_NO_RETRY")
    if (job.state === "AUTHORIZED") {
      if (Date.parse(job.authorization.expiresAt) <= now())
        throw new Error("AUTHORIZATION_EXPIRED")
      update(
        "CONNECTING",
        driver.finishRecording
          ? { recording: { status: "RECORDING", filename: null, sizeBytes: 0 } }
          : {},
      )
      await driver.connect()
      update("NAVIGATING")
      const boundary = await driver.navigate((stage, navigation) => {
        check()
        update(stage, navigation ? { navigation } : {})
      })
      check()
      if (!validFinal(job.authorization, boundary, now()))
        throw new Error("AUTHORIZATION_MISMATCH")
      const fresh = await driver.revalidate(boundary)
      check()
      if (
        !validFinal(job.authorization, fresh, now()) ||
        !sameAction(boundary, fresh)
      )
        throw new Error("AUTHORIZATION_MISMATCH")
      update("COMMIT_ARMED", {
        boundary: fresh,
        fingerprint: actionFingerprint(job.authorization, fresh),
      })
      options.fault?.("afterArm")
    } else if (job.state === "COMMIT_ARMED") {
      // Recovery before dispatch always re-observes; no stale coordinates replay.
      await driver.connect()
      const fresh = await driver.revalidate(job.boundary!)
      check()
      if (
        !validFinal(job.authorization, fresh, now()) ||
        !sameAction(job.boundary!, fresh)
      )
        throw new Error("AUTHORIZATION_MISMATCH")
      update("COMMIT_ARMED", {
        boundary: fresh,
        fingerprint: actionFingerprint(job.authorization, fresh),
      })
    }
    if (job.state === "COMMIT_ARMED") {
      check()
      job = await claimAndDispatch(repository, id, owner, async (grant) => {
        options.fault?.("afterClaim")
        await driver.clickFinal(job.boundary!, grant)
      })
    }
    // An uncertain dispatch or recovered COMMITTING job goes ONLY to verification.
    await driver.close()
    if (job.state === "COMMITTING") update("VERIFYING")
    if (job.state === "VERIFYING") {
      check()
      const observed = await driver.verify()
      const fresh =
        observed.fresh &&
        observed.contextId !== job.boundary?.contextId &&
        observed.observation?.contextId === observed.contextId &&
        observed.observation?.screenshotHash !== job.boundary?.screenshotHash &&
        (!observed.observation ||
          Date.parse(observed.observation.observedAt) >=
            Date.parse(job.updatedAt))
      let result = verificationVerdict(
        job.authorization,
        observed.observation,
        fresh,
      )
      // A known stopped bill does not prove our uncertain click was executed.
      if (result === "VERIFIED" && job.destructiveClicksExecuted !== 1)
        result = "INCONCLUSIVE"
      const verification = {
        ...observed,
        fresh,
        result,
        at: new Date(now()).toISOString(),
      }
      let receipt: Job["receipt"] = null
      if (result === "VERIFIED") {
        const payload = {
          schemaVersion: 1,
          product: "CleanBreak Receipt",
          jobId: job.id,
          authorization: job.authorization,
          authorizedIntent: job.authorization.intent,
          finalActionFingerprint: job.fingerprint,
          navigation: job.navigation,
          before: job.boundary,
          after: verification,
          destructiveClicksExecuted: job.destructiveClicksExecuted,
          automaticDestructiveRetries: 0,
          unsafeActionsExecuted: 0,
          authorizationUses: job.authorizationUses,
          avoidedNextChargeCents: job.authorization.expectedAmountCents,
          annualizedSavingsCents:
            job.authorization.expectedAmountCents *
            (job.authorization.interval === "MONTHLY" ? 12 : 1),
          savingsBasis:
            "Configured recurring amount; verified future renewal stopped. Not cash recovered.",
          execution: {
            executor:
              job.authorization.provider === "miro"
                ? "desktop"
                : "browser-fixture",
            sessionReference: job.authorization.sessionBinding,
          },
          verificationProvenance: { contextId: observed.contextId, fresh },
        }
        receipt = { payload, digest: digest(payload) }
      }
      update(result, {
        verification,
        receipt,
        reason: result === "INCONCLUSIVE" ? "OUTCOME_UNKNOWN_NO_RETRY" : null,
      })
    }
  } catch (error) {
    if (error instanceof WorkflowCrash) throw error
    job = repository.load(id)!
    if (!terminal(job.state)) {
      const fixed =
        error instanceof CancellationFailure
          ? error.code
          : error instanceof Error &&
              [
                "AUTHORIZATION_MISMATCH",
                "AUTHORIZATION_EXPIRED",
                "NAVIGATION_INTERRUPTED_NO_RETRY",
              ].includes(error.message)
            ? error.message
            : "WORKFLOW_FAILED_CLOSED"
      const state = job.authorizationUses === 1 ? "INCONCLUSIVE" : "FAILED"
      update(state, {
        reason: fixed,
        authorizationStatus: job.authorizationUses ? "CONSUMED" : "EXPIRED",
      })
    }
  } finally {
    clearInterval(heartbeat)
    if (driver.finishRecording) {
      try {
        const recording =
          (await driver.finishRecording()) ??
          (repository.load(id)?.recording?.status === "RECORDING"
            ? { status: "FAILED" as const, filename: null, sizeBytes: 0 }
            : undefined)
        if (recording) {
          job = repository.load(id)!
          update(job.state, { recording })
        }
      } catch {
        // A failed recorder must not leave the UI polling forever. This changes
        // only recording metadata, never the outcome or destructive authority.
        try {
          job = repository.load(id)!
          update(job.state, {
            recording: { status: "FAILED", filename: null, sizeBytes: 0 },
          })
        } catch {
          /* A lost lease cannot be bypassed to update recording metadata. */
        }
      }
    }
    await driver.close().catch(() => undefined)
    repository.release(id, owner)
    repository.unlockUnclaimed(repository.load(id)!)
  }
  return repository.load(id)
}
