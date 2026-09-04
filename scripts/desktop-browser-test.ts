// Developer-only Firefox launch check. No provider navigation or recording.
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readDesktopConnection } from "@/lib/desktop/config"
import { launchDesktopBrowser } from "./desktop-browser"
import { terminalSignals } from "./desktop-terminal"

type Handle = Pick<Desktop, "connect" | "open" | "exec" | "health" | "close">
type Dependencies = {
  createClient(config: ReturnType<typeof readDesktopConnection>): {
    connect(id: string): Promise<Handle>
  }
  output(message: string): void
  wait(ms: number): Promise<void>
}

export async function runDesktopBrowserTest(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: Partial<Dependencies> = {},
): Promise<number> {
  const output = dependencies.output ?? console.log
  const signals = terminalSignals()
  let vm: Handle | undefined
  let result = 0
  try {
    const config = readDesktopConnection(environment)
    const client = (
      dependencies.createClient ??
      ((config) =>
        new DesktopClient({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          callTimeoutMs: 10_000,
        }))
    )(config)
    signals.signal.throwIfAborted()
    vm = await client.connect(config.desktopId)
    signals.signal.throwIfAborted()
    await vm.connect()
    await launchDesktopBrowser(vm, "https://example.com", signals.signal, {
      wait: dependencies.wait,
    })
  } catch {
    output("Desktop browser launch failed.")
    result = 1
  } finally {
    try {
      vm?.close()
    } catch {
      output("Desktop control cleanup failed.")
      result = 1
    }
    signals.dispose()
  }
  if (result === 0) output("DESKTOP_BROWSER_LAUNCH_OK")
  return result
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runDesktopBrowserTest()
}
