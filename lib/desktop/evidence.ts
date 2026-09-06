// Write private Desktop evidence using fixed filenames and safe metadata.
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import type { DesktopRun } from "./runtime"

export function successfulDesktopValidation(run: DesktopRun): boolean {
  return (
    run.state === "AWAITING_APPROVAL" &&
    run.stopReason === "FINAL_ACTION_BOUNDARY" &&
    run.destructiveClicksExecuted === 0 &&
    run.unsafeActionsExecuted === 0 &&
    run.automaticDestructiveRetries === 0 &&
    (run.mode !== "auto" || run.finalBoundaryEstablished) &&
    (run.providerAdapter !== "miro" ||
      (run.finalBoundaryEstablished &&
        run.steps
          .slice(0, -1)
          .some(
            (s) =>
              s.providerAdapter === "miro" &&
              s.adapterRule !== null &&
              s.decision?.type === "cancel_flow_navigation" &&
              s.execution === "NAVIGATION_RETURNED" &&
              s.screenStability?.stable === true,
          ))) &&
    run.proposedAction !== null &&
    run.controlClosed &&
    run.steps.at(-1)?.policy === "FINAL_ACTION_BOUNDARY" &&
    run.steps.at(-1)?.execution === "NOT_EXECUTED" &&
    run.steps
      .slice(0, -1)
      .some(
        (step) =>
          step.decision?.type === "cancel_flow_navigation" &&
          step.policy === "HUMAN_NAVIGATION_REVIEW_REQUIRED" &&
          step.execution === "NAVIGATION_RETURNED" &&
          step.screenStability?.stable === true,
      )
  )
}

export function desktopEvidence(
  runId: string,
  root = resolve(process.cwd(), "artifacts", "desktop"),
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("INVALID_RUN_ID")
  const directory = resolve(root, runId)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return {
    directory,
    screenshot(step: number, bytes: Uint8Array) {
      const filename = `step-${String(step).padStart(2, "0")}.png`
      writeFileSync(resolve(directory, filename), bytes, { mode: 0o600 })
      return filename
    },
    job(run: DesktopRun) {
      // Private ignored evidence: the SDK's opaque VM ID may itself be a capability.
      writeFileSync(
        resolve(directory, "job.json"),
        JSON.stringify(run, null, 2) + "\n",
        { mode: 0o600 },
      )
    },
    validation(run: DesktopRun) {
      if (!successfulDesktopValidation(run)) return false
      writeFileSync(
        resolve(directory, "validation.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            executor: "desktop",
            mode: run.mode,
            providerAdapter: run.providerAdapter,
            finalBoundaryEstablished: run.finalBoundaryEstablished,
            automaticDestructiveRetries: run.automaticDestructiveRetries,
            runId,
            state: run.state,
            stopReason: run.stopReason,
            cancellationFlowTraversed: true,
            flowStages: run.steps.map((step) => step.flowStage),
            desktopReference: createHash("sha256")
              .update(run.desktopId)
              .digest("hex"),
            proposedAction: run.proposedAction,
            steps: run.steps.length,
            liveViewReference: run.liveViewReference,
            recordingStatus: run.recordingStatus,
            recordingReference: run.recordingReference,
            paused: run.paused,
            controlClosed: run.controlClosed,
            destructiveClicksExecuted: run.destructiveClicksExecuted,
            unsafeActionsExecuted: run.unsafeActionsExecuted,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      )
      return true
    },
  }
}
