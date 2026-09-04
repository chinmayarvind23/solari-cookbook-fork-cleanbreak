// Developer-only browser launch check/diagnostic. No provider navigation or recording.
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readDesktopConnection } from "@/lib/desktop/config"
import {
  diagnoseDesktopBrowsers,
  launchDesktopBrowser,
  reportBrowserLaunchFailure,
} from "./desktop-browser"
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
  return runBrowserCommand(environment, dependencies, false)
}

export async function runDesktopBrowserDiagnose(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: Partial<Dependencies> = {},
): Promise<number> {
  return runBrowserCommand(environment, dependencies, true)
}

async function runBrowserCommand(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Partial<Dependencies>,
  diagnose: boolean,
): Promise<number> {
  const output = dependencies.output ?? console.log
  const signals = terminalSignals()
  let vm: Handle | undefined
  let result = 0
  let ready = false
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
    if (diagnose) {
      signals.signal.throwIfAborted()
      ready = (await vm.health()).ready === true
      if (!ready) throw new Error("not ready")
      output("ready: true")
      await diagnoseDesktopBrowsers(vm, signals.signal, output)
    }
    await launchDesktopBrowser(vm, "https://example.com", signals.signal, {
      fallback: true,
      wait: dependencies.wait,
    })
  } catch (error) {
    if (!reportBrowserLaunchFailure(error, output)) {
      if (diagnose) {
        if (!ready) output("ready: false")
        output("reason: DIAGNOSTIC_UNAVAILABLE")
        output("result: failed")
      } else output("Desktop browser launch failed.")
    }
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
  if (result === 0)
    output(diagnose ? "result: ok" : "DESKTOP_BROWSER_LAUNCH_OK")
  return result
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2)
  if (args.length === 0) process.exitCode = await runDesktopBrowserTest()
  else if (args.length === 1 && args[0] === "--diagnose")
    process.exitCode = await runDesktopBrowserDiagnose()
  else {
    console.log(
      "Usage: npm run desktop:browser-test OR npm run desktop:browser-diagnose",
    )
    process.exitCode = 1
  }
}
