import type { CancellationJobState } from "@/lib/agent/types"

const transitions: Record<CancellationJobState, CancellationJobState[]> = {
  READY: ["NAVIGATING"],
  NAVIGATING: ["AWAITING_APPROVAL", "FAILED"],
  AWAITING_APPROVAL: ["COMMITTING", "VERIFYING", "ABORTED"],
  COMMITTING: ["VERIFYING"],
  VERIFYING: [],
  ABORTED: [],
  FAILED: [],
}

export function assertJobTransition(
  from: CancellationJobState,
  to: CancellationJobState,
): void {
  if (!transitions[from].includes(to)) {
    throw new Error(`Invalid cancellation job transition: ${from} -> ${to}`)
  }
}
