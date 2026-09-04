// Developer-only manual authentication; no planner, screenshots, or recording.
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readDesktopConnection } from "@/lib/desktop/config"
import { startDesktopViewer } from "@/lib/desktop/viewer"
import { confirmTerminal, terminalSignals } from "./desktop-terminal"

type Dependencies = {
  createClient(
    config: ReturnType<typeof readDesktopConnection>,
  ): Pick<DesktopClient, "connect" | "pause">
  viewer: typeof startDesktopViewer
  confirm: typeof confirmTerminal
  interactive: boolean
  output(message: string): void
}

export async function runDesktopOpen(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: Partial<Dependencies> = {},
) {
  const output = dependencies.output ?? console.log
  let exitCode = 0
  if (
    !(dependencies.interactive ?? process.stdin.isTTY) ||
    environment.CLEANBREAK_REAL_PROVIDER_AUTHORIZED?.trim() !== "true"
  ) {
    output(
      "Use an interactive terminal and set CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true for your dedicated VM.",
    )
    return 1
  }
  let config: ReturnType<typeof readDesktopConnection>
  try {
    config = readDesktopConnection(environment)
  } catch (error) {
    output(
      error instanceof Error ? error.message : "Invalid desktop configuration.",
    )
    return 1
  }
  const client = (
    dependencies.createClient ??
    ((config) =>
      new DesktopClient({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        callTimeoutMs: 10_000,
      }))
  )(config)
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
    viewer = await (dependencies.viewer ?? startDesktopViewer)(
      (await vm.stream.start()).streamUrl,
      false,
    )
    await (dependencies.confirm ?? confirmTerminal)(
      `Private manual desktop: ${viewer.url}\nOpen your provider in the existing browser, log in/MFA manually, and leave the billing page visible. Do not cancel. Press Enter here when ready to pause the VM.`,
      "",
      signals.signal,
    )
  } catch {
    output("Manual desktop connection failed. Raw SDK details withheld.")
    exitCode = 1
  } finally {
    try {
      await client.pause(config.desktopId)
      output("Desktop paused; authenticated machine state retained.")
    } catch {
      output(
        "Pause was not confirmed. Pause the existing VM in Solari; do not destroy it.",
      )
      exitCode = 1
    }
    try {
      vm?.close()
    } catch {
      exitCode = 1
    }
    try {
      await viewer?.close()
    } finally {
      signals.dispose()
    }
  }
  return exitCode
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runDesktopOpen().catch(() => {
    console.log("Manual desktop cleanup failed; check VM status in Solari.")
    return 1
  })
}
