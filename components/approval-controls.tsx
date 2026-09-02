"use client"

import { useFormStatus } from "react-dom"

import {
  abortCancellationAction,
  approveCancellationAction,
} from "@/app/actions"

function SubmitButton({ intent }: { intent: "approve" | "abort" }) {
  const { pending } = useFormStatus()
  return (
    <button
      className={intent === "approve" ? "primary-button" : "secondary-button"}
      disabled={pending}
      type="submit"
    >
      {pending
        ? intent === "approve"
          ? "Arming cancellation…"
          : "Aborting…"
        : intent === "approve"
          ? "Approve cancellation"
          : "Abort"}
    </button>
  )
}

export function ApprovalControls({
  jobId,
  fingerprint,
}: {
  jobId: string
  fingerprint: string
}) {
  return (
    <div className="approval-actions">
      <form action={approveCancellationAction}>
        <input name="jobId" type="hidden" value={jobId} />
        <input name="intent" type="hidden" value="approve" />
        <input name="fingerprint" type="hidden" value={fingerprint} />
        <SubmitButton intent="approve" />
      </form>
      <form action={abortCancellationAction}>
        <input name="jobId" type="hidden" value={jobId} />
        <input name="intent" type="hidden" value="abort" />
        <input name="fingerprint" type="hidden" value={fingerprint} />
        <SubmitButton intent="abort" />
      </form>
    </div>
  )
}
