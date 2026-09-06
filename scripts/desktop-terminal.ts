// Handle terminal confirmation, cancellation, and cleanup signals.
import { createInterface } from "node:readline"

export function terminalSignals() {
  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const event of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(event, abort)
  return {
    signal: controller.signal,
    dispose() {
      for (const event of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
        process.off(event, abort)
    },
  }
}

// Input is compared, never logged. EOF/SIGINT/abort is not confirmation.
export function confirmTerminal(
  prompt: string,
  expected: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!process.stdin.isTTY || signal.aborted) return Promise.resolve(false)
  console.log(prompt)
  return new Promise((resolve) => {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      terminal.removeAllListeners()
      signal.removeEventListener("abort", cancel)
      terminal.close()
      resolve(ok)
    }
    const cancel = () => finish(false)
    const timer = setTimeout(cancel, 5 * 60_000)
    terminal.once("line", (value) => finish(value === expected))
    terminal.once("close", cancel)
    terminal.once("SIGINT", cancel)
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
  })
}
