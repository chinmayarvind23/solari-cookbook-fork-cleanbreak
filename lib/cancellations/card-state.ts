import "server-only"
import { productConfig, digest } from "./config"
import { cancellationRepository } from "./repository"
import { publicJob } from "./public"
import { canStartNewAttemptForScope } from "./new-attempt"
import type { Provider } from "./state"

// Read-only SSR state; viewing the dashboard never authorizes or starts work.
export function cancellationCardState(provider: Provider) {
  const { scope } = productConfig(provider)
  const { job, previous } = cancellationRepository().currentForScope(scope)
  return {
    requestScopeKey: digest(scope),
    initialJob: job
      ? {
          ...publicJob(job),
          canStartNewAttempt: canStartNewAttemptForScope(job, scope),
        }
      : null,
    previousAttempt: previous ? publicJob(previous) : null,
  }
}
