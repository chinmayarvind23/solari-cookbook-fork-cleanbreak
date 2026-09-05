import "server-only"
import { cancellationRepository } from "./repository"
import { productConfig } from "./config"
import { runCancellation } from "./service"
import { desktopCancellationDriver } from "./desktop"
import { fixtureCancellationDriver } from "./fixture"
export async function executeCancellation(id: string) {
  const repository = cancellationRepository(),
    job = repository.load(id)
  if (!job) return
  try {
    const config = productConfig(job.authorization.provider)
    const driver =
      job.authorization.provider === "miro"
        ? desktopCancellationDriver(config, id)
        : fixtureCancellationDriver(config, id)
    await runCancellation(id, repository, driver)
  } catch {
    // A disabled/reconfigured worker must not leave an apparently running job.
    const owner = crypto.randomUUID()
    if (repository.acquire(id, owner)) {
      try {
        const current = repository.load(id)!
        repository.save(
          {
            ...current,
            state: current.authorizationUses ? "INCONCLUSIVE" : "FAILED",
            authorizationStatus: current.authorizationUses
              ? "CONSUMED"
              : "EXPIRED",
            reason: "WORKER_CONFIGURATION_UNAVAILABLE",
          },
          owner,
        )
        repository.unlockUnclaimed(repository.load(id)!)
      } finally {
        repository.release(id, owner)
      }
    }
  }
}
export async function recoverCancellations() {
  for (const id of cancellationRepository().pending())
    await executeCancellation(id)
}
