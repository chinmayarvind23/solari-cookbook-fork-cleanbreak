// Developer CLI only. No planner, profile persistence, screenshots, or recording.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConnection } from "@/lib/desktop/config"
import { validDesktopSessionId } from "@/lib/desktop/session"
import { terminalSignals } from "./desktop-terminal"

type Input = Pick<
  NodeJS.ReadStream,
  | "isTTY"
  | "isRaw"
  | "setRawMode"
  | "isPaused"
  | "resume"
  | "pause"
  | "on"
  | "off"
>
type Connection = Pick<Desktop, "connect" | "health" | "close"> & {
  keyboard: Pick<Desktop["keyboard"], "type">
}
type Dependencies = {
  createClient(config: ReturnType<typeof readDesktopConnection>): {
    connect(id: string): Promise<Connection>
  }
  readSecret(
    signal: AbortSignal,
    output: (message: string) => void,
  ): Promise<string>
  output(message: string): void
  interactive: boolean
  wait(): Promise<void>
}

type TestStage =
  "client_connect" | "vm_connect" | "health_check" | "keyboard_type"
const ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "AbortError",
  "SolariError",
  "ConnectionError",
  "TimeoutError",
  "ActionError",
  "GatewayError",
  "AuthError",
  "PlanError",
  "ConcurrencyLimitError",
  "NoCapacityError",
])

function configuredSecrets(
  environment: Readonly<Record<string, string | undefined>>,
) {
  return Object.entries(environment)
    .filter(([key]) =>
      /api.?key|authorization|cookie|token|secret|password/i.test(key),
    )
    .map(([, value]) => value?.trim())
    .filter((value): value is string => Boolean(value))
}

function containsConfiguredSecret(value: string, secrets: string[]) {
  return secrets.some((secret) =>
    [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"),
    ].some((encoded) => value.includes(encoded)),
  )
}

function testFailure(error: unknown, stage: TestStage, secrets: string[]) {
  const diagnostic = { stage, name: "Error", message: "[redacted]" }
  // Never serialize the error object, cause, body, headers, or stack. A fixed
  // name allowlist also prevents an attacker-controlled error.name leaking data.
  try {
    if (!(error instanceof Error)) return diagnostic
    if (
      ERROR_NAMES.has(error.name) &&
      !containsConfiguredSecret(error.name, secrets)
    )
      diagnostic.name = error.name
    const raw = error.message
    if (
      typeof raw !== "string" ||
      raw.length > 300 ||
      containsConfiguredSecret(raw, secrets) ||
      /api[ _-]?key|authorization|cookie|token|secret|password|credential|bearer|headers?|request[ _-]?body|storage[ _-]?state|localstorage/i.test(
        raw,
      ) ||
      /[\p{Cc}\p{Cf}{}\[\]<>?&#%=]|:\/\/|\bwww\./u.test(raw)
    )
      return diagnostic
    const message = raw.trim().replace(/ +/g, " ")
    // Fail closed: even an unlabeled token/password can look like ordinary text.
    // Only known SDK/runtime messages and bounded non-sensitive variants pass.
    const safeMessage =
      /^(?:connect failed|fetch failed|WebSocket error|Control channel (?:is )?closed|Not connected — call connect\(\) first|Action failed|Desktop not ready|Connection (?:failed|refused|timed out)|The operation was aborted\.?)$/i.test(
        message,
      ) ||
      /^Action "(?:connect|health|input\.key|desktop\.health)" timed out after \d{1,6}ms$/.test(
        message,
      ) ||
      /^(?:Gateway request failed with status |WebSocket error: Unexpected server response: |Unexpected server response: )[1-5]\d{2}$/.test(
        message,
      ) ||
      /^Control channel closed \(\d{4}\)$/.test(message)
    if (safeMessage) diagnostic.message = message
  } catch {
    /* Hostile/custom error getters are not diagnostic authority. */
  }
  return diagnostic
}

// Raw TTY input suppresses echo without readline/history/clipboard. Retain bytes
// only until Enter, wipe our buffer, and remove listeners on every exit path.
// JS strings and SDK transport buffers cannot be reliably zeroized by JavaScript.
export function readHiddenText(
  signal: AbortSignal,
  output: (message: string) => void,
  input: Input = process.stdin,
): Promise<string> {
  if (!input.isTTY || signal.aborted)
    return Promise.reject(
      new Error("Hidden input requires an active terminal."),
    )
  return new Promise((resolveText, reject) => {
    const buffer = Buffer.alloc(16_384)
    let length = 0
    let finished = false
    const wasRaw = Boolean(input.isRaw)
    const wasPaused = input.isPaused()
    const timer = setTimeout(cancel, 5 * 60_000)
    function finish(confirmed: boolean) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      input.off("data", onData)
      input.off("end", cancel)
      input.off("close", cancel)
      input.off("error", cancel)
      signal.removeEventListener("abort", cancel)
      try {
        input.setRawMode(wasRaw)
        if (wasPaused) input.pause()
        if (!confirmed || !length) throw new Error("Canceled")
        resolveText(
          new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(0, length),
          ),
        )
      } catch {
        reject(new Error("Hidden input canceled or unavailable."))
      } finally {
        buffer.fill(0)
        length = 0
      }
    }
    function cancel() {
      finish(false)
    }
    function onData(chunk: Buffer | string) {
      const bytes =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
      // Enter must arrive separately: reject multiline/control-bearing pastes.
      if (
        (bytes.length === 1 && (bytes[0] === 13 || bytes[0] === 10)) ||
        (bytes.length === 2 && bytes[0] === 13 && bytes[1] === 10)
      ) {
        finish(true)
        return
      }
      for (const byte of bytes) {
        if (byte === 8 || byte === 127) {
          if (length) {
            let start = length - 1
            while (start > 0 && (buffer[start] & 0xc0) === 0x80) start--
            buffer.fill(0, start, length)
            length = start
          }
        } else if (byte < 32 || length === buffer.length) {
          cancel()
          return
        } else buffer[length++] = byte
      }
    }
    try {
      input.setRawMode(true)
      input.on("data", onData)
      input.on("end", cancel)
      input.on("close", cancel)
      input.on("error", cancel)
      signal.addEventListener("abort", cancel, { once: true })
      output(
        "After verifying --test, focus the intended password field in the viewer. Enter text here (hidden), then press Enter to type it; Ctrl+C cancels.",
      )
      input.resume()
      if (signal.aborted) cancel()
    } catch {
      cancel()
    }
  })
}

export async function runDesktopType(
  args: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: Partial<Dependencies> = {},
): Promise<number> {
  const output = dependencies.output ?? console.log
  if (args.length !== 1 || !["--test", "--secret"].includes(args[0])) {
    output(
      "Usage: npm run desktop:type -- --test OR --secret. Never pass text as an argument.",
    )
    return 1
  }
  let config: ReturnType<typeof readDesktopConnection>
  try {
    config = readDesktopConnection(environment)
  } catch (error) {
    // Only fixed messages from our configuration validator, never SDK errors.
    output(
      error instanceof Error ? error.message : "Invalid desktop configuration.",
    )
    return 1
  }
  if (
    args[0] === "--secret" &&
    !(dependencies.interactive ?? Boolean(process.stdin.isTTY))
  ) {
    output(
      "Secret entry requires an interactive terminal; piped input is not supported.",
    )
    return 1
  }
  const signals = terminalSignals()
  let vm: Connection | undefined
  let text: string | undefined
  let code = 0
  let dispatched = false
  let stage: TestStage = "client_connect"
  const secrets = configuredSecrets(environment)
  try {
    // The target ID is non-secret, but malformed/misconfigured values must not
    // inject terminal controls or disclose a configured credential.
    output(
      `Desktop target: ${validDesktopSessionId(config.desktopId) && !containsConfiguredSecret(config.desktopId, secrets) ? config.desktopId : "[redacted]"}`,
    )
    const client = (
      dependencies.createClient ??
      ((config) =>
        new DesktopClient({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          callTimeoutMs: 10_000,
        }))
    )(config)
    // Existing VM only; never create, launch, navigate, or inspect the field.
    vm = await client.connect(config.desktopId)
    stage = "vm_connect"
    signals.signal.throwIfAborted()
    await vm.connect()
    stage = "health_check"
    let ready = false
    for (let attempt = 0; attempt < 30; attempt++) {
      signals.signal.throwIfAborted()
      if ((await vm.health()).ready) {
        ready = true
        break
      }
      await (
        dependencies.wait ??
        (() => new Promise<void>((done) => setTimeout(done, 500)))
      )()
    }
    if (!ready) throw new Error("Desktop not ready")
    text =
      args[0] === "--test"
        ? "AbCdEF123"
        : await (dependencies.readSecret ?? readHiddenText)(
            signals.signal,
            output,
          )
    signals.signal.throwIfAborted()
    if (!text || /[\p{Cc}\p{Cf}]/u.test(text)) throw new Error("Invalid input")
    stage = "keyboard_type"
    dispatched = true
    try {
      // Verified @solarisdk/core API: input.key { text, action: "press" }.
      // Do not send keyboard.press("Return"): terminal Enter never submits a form.
      await vm.keyboard.type(text)
    } finally {
      text = undefined
    }
    output(
      args[0] === "--test"
        ? "Typed test text into focused desktop field."
        : "Typed secret into focused desktop field.",
    )
  } catch (error) {
    if (args[0] === "--test")
      output(
        `Desktop test failure: ${JSON.stringify(testFailure(error, stage, secrets))}`,
      )
    output(
      dispatched
        ? "Typing was not confirmed; inspect the focused field before retrying. Raw SDK details withheld."
        : "Typing canceled or connection/input unavailable. No text was sent.",
    )
    code = 1
  } finally {
    text = undefined
    try {
      // DesktopClient has no close(). Close this handle, not the VM/viewer.
      vm?.close()
    } catch {
      output("Desktop control cleanup failed. Raw SDK details withheld.")
      code = 1
    } finally {
      signals.dispose()
    }
  }
  return code
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runDesktopType(process.argv.slice(2))
}
