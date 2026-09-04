// Developer-only GUI launch, not an agent tool. No screenshots or credentials.
import type { Desktop } from "@solarisdk/desktop"

type BrowserDesktop = Pick<Desktop, "open" | "exec" | "health">
export const BROWSER_RENDER_WAIT_MS = 1500

type LaunchStage =
  | "firefox_open"
  | "firefox_probe"
  | "chromium_probe"
  | "fallback_open"
  | "render_wait"
  | "health_recheck"
type LaunchReason =
  | "FIREFOX_PRESENT_BUT_OPEN_FAILED"
  | "FIREFOX_OPEN_FAILED"
  | "PROBE_FAILED"
  | "NO_SUPPORTED_BROWSER"
  | "FALLBACK_OPEN_FAILED"
  | "INVALID_PROCESS_ID"
  | "RENDER_WAIT_FAILED"
  | "HEALTH_RECHECK_FAILED"
  | "HEALTH_NOT_READY"
  | "CANCELED"

// Carries only local enum values. Never retain an SDK exception/cause/body.
class BrowserLaunchFailure extends Error {
  constructor(
    readonly stage: LaunchStage,
    readonly reason: LaunchReason,
  ) {
    super("Desktop browser launch failed.")
  }
}

export function reportBrowserLaunchFailure(
  error: unknown,
  output: (message: string) => void,
) {
  if (!(error instanceof BrowserLaunchFailure)) return false
  output(`launchStage: ${error.stage}`)
  output(`reason: ${error.reason}`)
  output("result: failed")
  return true
}

const CHROMIUM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
] as const

// Deliberately extract only a bounded numeric exit code; never inspect/log stdout
// or stderr. Null means the probe failed, not that the executable was absent.
async function executableProbe(
  vm: Pick<Desktop, "exec">,
  path: string,
  usePath = false,
): Promise<number | null> {
  try {
    const { exitCode } = await vm.exec(usePath ? "which" : "test", {
      args: usePath ? [path] : ["-x", path],
      timeoutMs: 5000,
    })
    return Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255
      ? exitCode
      : null
  } catch {
    return null
  }
}

export async function diagnoseDesktopBrowsers(
  vm: Pick<Desktop, "exec">,
  signal: AbortSignal,
  output: (message: string) => void,
) {
  const probes = [
    ["firefox", "firefox", true],
    ["firefoxPath", "/usr/bin/firefox", false],
    ["chromium", CHROMIUM_PATHS[0], false],
    ["chromiumBrowser", CHROMIUM_PATHS[1], false],
    ["chrome", CHROMIUM_PATHS[2], false],
  ] as const
  for (const [label, path, usePath] of probes) {
    signal.throwIfAborted()
    const exitCode = await executableProbe(vm, path, usePath)
    if (exitCode !== null) output(`${label}ExitCode: ${exitCode}`)
    if (exitCode === 0 || exitCode === 1)
      output(`${label}Detected: ${exitCode === 0}`)
    else output(`${label}ProbeSucceeded: false`)
  }
}

export async function launchDesktopBrowser(
  vm: BrowserDesktop,
  url: string,
  signal: AbortSignal,
  options: { fallback?: boolean; wait?: (ms: number) => Promise<void> } = {},
) {
  let stage: LaunchStage = "firefox_open"
  let reason: LaunchReason = "FIREFOX_OPEN_FAILED"
  try {
    signal.throwIfAborted()
    let pid: number
    try {
      pid = await vm.open("firefox", [url])
    } catch {
      if (!options.fallback) throw new BrowserLaunchFailure(stage, reason)
      signal.throwIfAborted()
      stage = "firefox_probe"
      reason = "PROBE_FAILED"
      // A failed open is not proof of absence. Detect PATH and the known Firefox
      // path before allowing fallback; do not blindly retry a possibly running app.
      for (const [path, usePath] of [
        ["firefox", true],
        ["/usr/bin/firefox", false],
      ] as const) {
        signal.throwIfAborted()
        const exitCode = await executableProbe(vm, path, usePath)
        if (exitCode === 0)
          throw new BrowserLaunchFailure(
            "firefox_open",
            "FIREFOX_PRESENT_BUT_OPEN_FAILED",
          )
        if (exitCode !== 1) throw new BrowserLaunchFailure(stage, reason)
      }
      stage = "chromium_probe"
      let executable: string | undefined
      for (const path of CHROMIUM_PATHS) {
        signal.throwIfAborted()
        const exitCode = await executableProbe(vm, path)
        if (exitCode === 0) {
          executable = path
          break
        }
        if (exitCode !== 1) throw new BrowserLaunchFailure(stage, reason)
      }
      if (!executable)
        throw new BrowserLaunchFailure(stage, "NO_SUPPORTED_BROWSER")
      stage = "fallback_open"
      reason = "FALLBACK_OPEN_FAILED"
      signal.throwIfAborted()
      pid = await vm.open(executable, [url])
    }
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new BrowserLaunchFailure(stage, "INVALID_PROCESS_ID")
    stage = "render_wait"
    reason = "RENDER_WAIT_FAILED"
    signal.throwIfAborted()
    // Bounded startup allowance only; health is not proof of rendered page content.
    await (
      options.wait ??
      ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
    )(BROWSER_RENDER_WAIT_MS)
    signal.throwIfAborted()
    stage = "health_recheck"
    reason = "HEALTH_RECHECK_FAILED"
    if ((await vm.health()).ready !== true)
      throw new BrowserLaunchFailure(stage, "HEALTH_NOT_READY")
    signal.throwIfAborted()
  } catch (error) {
    if (signal.aborted) throw new BrowserLaunchFailure(stage, "CANCELED")
    if (error instanceof BrowserLaunchFailure) throw error
    throw new BrowserLaunchFailure(stage, reason)
  }
}
