// Collect explicit approval for the supervised Browser workflow.
// Collect explicit approval for the supervised Browser workflow.
"use client"

import { useFormStatus } from "react-dom"

import {
  abortCancellationAction,
  approveCancellationAction,
} from "@/app/actions"

function SubmitButton({
  intent,
  dryRun,
}: {
  intent: "approve" | "abort"
  dryRun: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button
      className={intent === "approve" ? "primary-button" : "secondary-button"}
      disabled={pending}
      type="submit"
    >
      {pending
        ? intent === "approve"
          ? dryRun
            ? "Confirming safety boundary…"
            : "Canceling, then verifying independently…"
          : "Aborting…"
        : intent === "approve"
          ? dryRun
            ? "Test approval — no cancellation"
            : "Approve cancellation"
          : "Abort"}
    </button>
  )
}

export function ApprovalControls({
  jobId,
  fingerprint,
  dryRun,
}: {
  jobId: string
  fingerprint: string
  dryRun: boolean
}) {
  return (
    <div className="approval-actions">
      <form action={approveCancellationAction}>
        <input name="jobId" type="hidden" value={jobId} />
        <input name="intent" type="hidden" value="approve" />
        <input name="fingerprint" type="hidden" value={fingerprint} />
        <SubmitButton dryRun={dryRun} intent="approve" />
      </form>
      <form action={abortCancellationAction}>
        <input name="jobId" type="hidden" value={jobId} />
        <input name="intent" type="hidden" value="abort" />
        <input name="fingerprint" type="hidden" value={fingerprint} />
        <SubmitButton dryRun={dryRun} intent="abort" />
      </form>
    </div>
  )
}
