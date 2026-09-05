// Opt-in durable startup recovery for the persistent Node deployment.
export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.CLEANBREAK_CANCELLATION_WORKER !== "true"
  )
    return
  const { recoverCancellations } = await import("@/lib/cancellations/worker")
  const shared = globalThis as typeof globalThis & {
    oneClickWorkerStarted?: boolean
  }
  if (shared.oneClickWorkerStarted) return
  shared.oneClickWorkerStarted = true
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await recoverCancellations()
    } finally {
      running = false
    }
  }
  void tick().catch(() => undefined)
  setInterval(() => {
    void tick().catch(() => undefined)
  }, 2000).unref()
}
