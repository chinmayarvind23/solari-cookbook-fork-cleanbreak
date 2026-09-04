// Developer-only manual authentication; no planner, screenshots, or recording.
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConnection } from "@/lib/desktop/config"
import { startDesktopViewer } from "@/lib/desktop/viewer"
import { confirmTerminal, terminalSignals } from "./desktop-terminal"

async function main() {
  if (
    !process.stdin.isTTY ||
    process.env.CLEANBREAK_REAL_PROVIDER_AUTHORIZED?.trim() !== "true"
  ) {
    console.log(
      "Use an interactive terminal and set CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true for your dedicated VM.",
    )
    process.exitCode = 1
    return
  }
  let config: ReturnType<typeof readDesktopConnection>
  try {
    config = readDesktopConnection()
  } catch (error) {
    console.log(
      error instanceof Error ? error.message : "Invalid desktop configuration.",
    )
    process.exitCode = 1
    return
  }
  const client = new DesktopClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    callTimeoutMs: 10_000,
  })
  const signals = terminalSignals()
  let vm: Desktop | undefined
  let viewer: Awaited<ReturnType<typeof startDesktopViewer>> | undefined
  try {
    vm = await client.connect(config.desktopId)
    await vm.connect()
    let ready = false
    for (let i = 0; i < 30; i++) {
      signals.signal.throwIfAborted()
      if ((await vm.health()).ready) {
        ready = true
        break
      }
      await new Promise((done) => setTimeout(done, 500))
    }
    if (!ready) throw new Error("not ready")
    viewer = await startDesktopViewer(
      (await vm.stream.start()).streamUrl,
      false,
    )
    await confirmTerminal(
      `Private manual desktop: ${viewer.url}\nOpen your provider in the existing browser, log in/MFA manually, and leave the billing page visible. Do not cancel. Press Enter here when ready to pause the VM.`,
      "",
      signals.signal,
    )
  } catch {
    console.log("Manual desktop connection failed. Raw SDK details withheld.")
    process.exitCode = 1
  } finally {
    try {
      await client.pause(config.desktopId)
      console.log("Desktop paused; authenticated machine state retained.")
    } catch {
      console.log(
        "Pause was not confirmed. Pause the existing VM in Solari; do not destroy it.",
      )
      process.exitCode = 1
    }
    try {
      vm?.close()
    } catch {
      process.exitCode = 1
    }
    try {
      await viewer?.close()
    } finally {
      signals.dispose()
    }
  }
}
await main().catch(() => {
  console.log("Manual desktop cleanup failed; check VM status in Solari.")
  process.exitCode = 1
})
