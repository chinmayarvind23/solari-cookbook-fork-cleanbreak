// Developer-only GUI launch. Screenshots stay in memory unless diagnostics opt in.
import type { Desktop } from "@solarisdk/desktop"
import { validBrowserScreenshot } from "./desktop-render"

type BrowserDesktop = Pick<
  Desktop,
  "open" | "exec" | "health" | "process" | "screenshot"
>
export const BROWSER_RENDER_WAIT_MS = 1500
export const BROWSER_RENDER_TIMEOUT_MS = 10_000

type LaunchStage =
  | "chrome_probe"
  | "chrome_open"
  | "firefox_open"
  | "firefox_probe"
  | "chromium_probe"
  | "fallback_open"
  | "render_wait"
  | "health_recheck"
  | "process_check"
  | "screenshot"
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
  | "CHROME_OPEN_FAILED"
  | "CHROME_PROCESS_EXITED"
  | "SCREENSHOT_FAILED"
  | "DESKTOP_NOT_READY"

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
  options: {
    browser?: "chrome"
    fallback?: boolean
    allowNoSandbox?: boolean // Legacy option; detected Google Chrome uses fixed VM flags.
    wait?: (ms: number) => Promise<void>
    output?: (message: string) => void
    saveScreenshot?: (bytes: Uint8Array) => void
  } = {},
) {
  let stage: LaunchStage = "firefox_open"
  let reason: LaunchReason = "FIREFOX_OPEN_FAILED"
  try {
    signal.throwIfAborted()
    let pid: number
    let executable = "firefox"
    if (options.browser === "chrome") {
      stage = "chrome_probe"
      reason = "PROBE_FAILED"
      const detected = await executableProbe(vm, "/usr/bin/google-chrome")
      if (detected !== 0)
        throw new BrowserLaunchFailure(
          stage,
          detected === 1 ? "NO_SUPPORTED_BROWSER" : reason,
        )
      executable = "/usr/bin/google-chrome"
      stage = "chrome_open"
      reason = "CHROME_OPEN_FAILED"
      signal.throwIfAborted()
      pid = await vm.open(executable, [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--user-data-dir=/tmp/cleanbreak-chrome",
        "--new-window",
        url,
      ])
    } else
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
        let detectedExecutable: string | undefined
        for (const path of CHROMIUM_PATHS) {
          signal.throwIfAborted()
          const exitCode = await executableProbe(vm, path)
          if (exitCode === 0) {
            detectedExecutable = path
            break
          }
          if (exitCode !== 1) throw new BrowserLaunchFailure(stage, reason)
        }
        if (!detectedExecutable)
          throw new BrowserLaunchFailure(stage, "NO_SUPPORTED_BROWSER")
        executable = detectedExecutable
        stage = "fallback_open"
        reason =
          executable === "/usr/bin/google-chrome"
            ? "CHROME_OPEN_FAILED"
            : "FALLBACK_OPEN_FAILED"
        signal.throwIfAborted()
        pid = await vm.open(
          executable,
          executable === "/usr/bin/google-chrome"
            ? [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--user-data-dir=/tmp/cleanbreak-chrome",
                "--new-window",
                url,
              ]
            : [url],
        )
      }
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new BrowserLaunchFailure(
        stage,
        executable === "/usr/bin/google-chrome"
          ? "CHROME_OPEN_FAILED"
          : "INVALID_PROCESS_ID",
      )
    const wait =
      options.wait ??
      ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
    const google = executable === "/usr/bin/google-chrome"
    const chrome = executable !== "firefox"
    // Verification is bounded in wall time AND poll count. Never relaunch.
    {
      const deadline = Date.now() + BROWSER_RENDER_TIMEOUT_MS
      async function bounded<T>(action: () => Promise<T>): Promise<T> {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new BrowserLaunchFailure(stage, reason)
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([
            action(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new BrowserLaunchFailure(stage, reason)),
                remaining,
              )
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }
      const browserName = (name: string) =>
        (chrome
          ? /^(?:chrome|chromium|chromium-browser|google-chrome)$/
          : /^firefox(?:-bin)?$/
        ).test(name)
      // The live office guest returns comm/cmdline/state, despite the installed
      // SDK declaring name/cmd. Read only the executable name, never cmdline.
      const processName = (process: { name?: unknown; comm?: unknown }) =>
        typeof process.name === "string"
          ? process.name
          : typeof process.comm === "string"
            ? process.comm
            : ""
      const running = (process: { state?: unknown }) =>
        typeof process.state !== "string" ||
        !/^[ZX]/i.test(process.state.trim())
      const matches = (
        process: Awaited<ReturnType<Desktop["process"]["list"]>>[number],
      ) =>
        Number.isSafeInteger(process.pid) &&
        process.pid > 0 &&
        (google || process.pid === pid) &&
        browserName(processName(process)) &&
        running(process as { state?: unknown })
      stage = "render_wait"
      reason = "RENDER_WAIT_FAILED"
      await bounded(() => wait(BROWSER_RENDER_WAIT_MS))
      let exited = false
      let image: Uint8Array | undefined
      for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
        signal.throwIfAborted()
        stage = "health_recheck"
        reason = "DESKTOP_NOT_READY"
        if ((await bounded(() => vm.health())).ready !== true)
          throw new BrowserLaunchFailure(stage, reason)
        stage = "process_check"
        reason = "DESKTOP_NOT_READY"
        const processes = await bounded(() => vm.process.list())
        const alive = processes.some(matches)
        if (!alive) {
          options.output?.("launchPidValid: false")
          options.output?.(
            `${chrome ? "chromeProcessDetected" : "browserProcessDetected"}: false`,
          )
          if (
            processes.some((p) => p.pid === pid || browserName(processName(p)))
          )
            throw new BrowserLaunchFailure(stage, "CHROME_PROCESS_EXITED")
          exited = true
          break
        }
        stage = "screenshot"
        reason = "SCREENSHOT_FAILED"
        try {
          const bytes = await bounded(() => vm.screenshot()) // SDK: Promise<Uint8Array>, default PNG.
          if (await bounded(() => validBrowserScreenshot(bytes))) image = bytes
        } catch {
          /* Retry only observation, never a browser launch. */
        }
        if (image) {
          stage = "process_check"
          reason = "DESKTOP_NOT_READY"
          const afterCapture = await bounded(() => vm.process.list())
          if (!afterCapture.some(matches)) {
            if (
              afterCapture.some(
                (p) => p.pid === pid || browserName(processName(p)),
              )
            )
              throw new BrowserLaunchFailure(stage, "CHROME_PROCESS_EXITED")
            exited = true
            break
          }
          options.output?.(
            `launchPidValid: ${afterCapture.some((p) => p.pid === pid && matches(p))}`,
          )
          options.output?.(
            `${chrome ? "chromeProcessDetected" : "browserProcessDetected"}: true`,
          )
          options.output?.("screenshotCaptured: true")
          options.output?.(`screenshotBytes: ${image.byteLength}`)
          stage = "screenshot"
          reason = "SCREENSHOT_FAILED"
          options.saveScreenshot?.(image)
          return
        }
        if (attempt < 7) await bounded(() => wait(1000))
      }
      if (!exited)
        throw new BrowserLaunchFailure("screenshot", "SCREENSHOT_FAILED")
      throw new BrowserLaunchFailure("process_check", "CHROME_PROCESS_EXITED")
    }
  } catch (error) {
    if (signal.aborted) throw new BrowserLaunchFailure(stage, "CANCELED")
    if (error instanceof BrowserLaunchFailure) throw error
    throw new BrowserLaunchFailure(stage, reason)
  }
}
