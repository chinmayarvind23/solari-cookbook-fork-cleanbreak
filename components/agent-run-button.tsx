// Start a Browser demo job and show its current progress.
// Start a Browser demo job and show its current progress.
"use client"

import { useFormStatus } from "react-dom"

export function AgentRunButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button className="lab-button" disabled={disabled || pending} type="submit">
      {pending ? "Connecting to Solari…" : "Run autonomous dry run"}
    </button>
  )
}
