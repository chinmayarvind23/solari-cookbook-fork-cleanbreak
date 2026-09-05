import "server-only"
import type { CancellationRepository } from "./repository"
import { digest } from "./config"
import type { Observation } from "./state"
export type FinalDispatchGrant = Readonly<{
  jobId: string
  observationHash: string
}>
const grants = new WeakSet<FinalDispatchGrant>()
export function consumeFinalDispatch(
  grant: FinalDispatchGrant,
  jobId: string,
  observation: Observation,
) {
  if (
    !grants.delete(grant) ||
    grant.jobId !== jobId ||
    grant.observationHash !== digest(observation)
  )
    throw new Error("COMMIT_GATE_REQUIRED")
}
// The ONLY destructive dispatch path. Durable reservation precedes invocation.
// A throw, timeout or process crash after claim spends the authorization forever.
export async function claimAndDispatch(
  repository: CancellationRepository,
  id: string,
  owner: string,
  exactlyOneFinalClick: (grant: FinalDispatchGrant) => Promise<void>,
) {
  const claimed = repository.claim(id, owner)
  if (!claimed) throw new Error("AUTHORIZATION_UNAVAILABLE")
  const grant = Object.freeze({
    jobId: id,
    observationHash: digest(claimed.boundary),
  })
  grants.add(grant)
  try {
    await exactlyOneFinalClick(grant)
    return repository.save({ ...claimed, destructiveClicksExecuted: 1 }, owner)
  } catch {
    return repository.load(id)! // No second call. Recovery treats COMMITTING as unknown.
  } finally {
    grants.delete(grant)
  }
}
