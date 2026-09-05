// Dedicated persistent single-instance worker. Never creates authorizations.
import { recoverCancellations } from "../lib/cancellations/worker"
let stopped = false
process.once("SIGINT", () => {
  stopped = true
})
process.once("SIGTERM", () => {
  stopped = true
})
while (!stopped) {
  await recoverCancellations()
  await new Promise((done) => setTimeout(done, 2000))
}
