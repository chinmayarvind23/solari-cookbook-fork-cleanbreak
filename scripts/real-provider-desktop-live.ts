// Explicit initial authorization from a developer command; no secret arguments.
import { randomUUID } from "node:crypto"
import { productConfig } from "../lib/cancellations/config"
import { cancellationRepository } from "../lib/cancellations/repository"
import { executeCancellation } from "../lib/cancellations/worker"
import { publicJob } from "../lib/cancellations/public"
try {
  const config = productConfig("miro")
  const repo = cancellationRepository()
  const job = repo.create(config.scope, randomUUID())
  console.log(`Cancellation job: ${job.id}`)
  await executeCancellation(job.id)
  console.log(JSON.stringify(publicJob(repo.load(job.id)!)))
} catch {
  console.error(
    "Live cancellation not started. Check explicit authorization, operator authentication and configuration.",
  )
  process.exitCode = 1
}
