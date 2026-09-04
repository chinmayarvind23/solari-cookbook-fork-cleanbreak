// Developer-only GUI launch, not an agent tool. No screenshots or credentials.
import type { Desktop } from "@solarisdk/desktop"

type BrowserDesktop = Pick<Desktop, "open" | "exec" | "health">
export const BROWSER_RENDER_WAIT_MS = 1500

export async function launchDesktopBrowser(
  vm: BrowserDesktop,
  url: string,
  signal: AbortSignal,
  options: { fallback?: boolean; wait?: (ms: number) => Promise<void> } = {},
) {
  signal.throwIfAborted()
  let pid: number
  try {
    pid = await vm.open("firefox", [url])
  } catch {
    signal.throwIfAborted()
    if (!options.fallback) throw new Error("Desktop browser launch failed.")
    // An RPC failure does not prove Firefox is missing. Do not launch duplicates
    // on ambiguous errors. These probes contain only fixed commands/paths, never
    // the provider URL, user input, or a shell script; results are never logged.
    const firefox = await vm.exec("which", {
      args: ["firefox"],
      timeoutMs: 5000,
    })
    if (firefox.exitCode !== 1)
      throw new Error("Desktop browser launch failed.")
    let executable: string | undefined
    for (const path of [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
    ]) {
      signal.throwIfAborted()
      const detected = await vm.exec("test", {
        args: ["-x", path],
        timeoutMs: 5000,
      })
      if (detected.exitCode === 0) {
        executable = path
        break
      }
      if (detected.exitCode !== 1)
        throw new Error("Desktop browser launch failed.")
    }
    if (!executable) throw new Error("Desktop browser launch failed.")
    signal.throwIfAborted()
    pid = await vm.open(executable, [url])
  }
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Desktop browser launch failed.")
  signal.throwIfAborted()
  // Bounded startup allowance only; health is not proof of rendered page content.
  await (
    options.wait ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
  )(BROWSER_RENDER_WAIT_MS)
  signal.throwIfAborted()
  if ((await vm.health()).ready !== true)
    throw new Error("Desktop browser launch failed.")
  signal.throwIfAborted()
}
