// Developer CLI only. Creates/checks sessions; never logs in, types, or records.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  DesktopClient,
  type Desktop,
  type CreateDesktopOptions,
} from "@solarisdk/desktop"
import {
  readDesktopClientConfig,
  readDesktopConnection,
} from "@/lib/desktop/config"
import {
  readDesktopSessionState,
  saveDesktopSessionState,
  validDesktopSessionId,
  validSessionTimestamp,
  type DesktopSessionState,
} from "@/lib/desktop/session"
import { terminalSignals } from "./desktop-terminal"

// Explicit full-GUI template; creation options use the installed SDK types.
export const DESKTOP_CREATE_OPTIONS: CreateDesktopOptions = {
  template: "office",
  resolution: "1280x720",
  cpu: 2,
  memMb: 4096,
  timeoutMs: 60 * 60_000,
  lifecycle: { onTimeout: "pause", autoResume: false },
  record: false,
}
type Handle = Pick<
  Desktop,
  "id" | "sessionId" | "expiresAt" | "connect" | "health" | "close"
>
type Dependencies = {
  createClient(config: ReturnType<typeof readDesktopClientConfig>): {
    create(options: CreateDesktopOptions): Promise<Handle>
    get: DesktopClient["get"]
    connect(sessionId: string): Promise<Handle>
    pause: DesktopClient["pause"]
  }
  loadState(): DesktopSessionState | undefined
  saveState(state: DesktopSessionState): void
  output(message: string): void
}

export async function runDesktopSession(
  args: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: Partial<Dependencies> = {},
): Promise<number> {
  const output = dependencies.output ?? console.log
  if (args.length !== 1 || !["--create", "--check"].includes(args[0])) {
    output("Usage: npm run desktop:create OR npm run desktop:check")
    return 1
  }
  const creating = args[0] === "--create"
  let config: ReturnType<typeof readDesktopClientConfig>
  let sessionId: string | undefined
  try {
    config = readDesktopClientConfig(environment)
    if (creating) {
      if ((dependencies.loadState ?? readDesktopSessionState)()) {
        output(
          "Desktop state already exists. Run npm run desktop:check; creation will not overwrite the saved session.",
        )
        return 1
      }
      if (environment.SOLARI_DESKTOP_SESSION_ID?.trim()) {
        output(
          "Clear SOLARI_DESKTOP_SESSION_ID before creating; otherwise it would override the newly saved session.",
        )
        return 1
      }
    } else
      sessionId = readDesktopConnection(
        environment,
        dependencies.loadState,
      ).desktopId
  } catch (error) {
    // Fixed local validation errors only. No SDK errors reach this branch.
    output(
      error instanceof Error ? error.message : "Invalid desktop configuration.",
    )
    return 1
  }
  const signals = terminalSignals()
  let client: ReturnType<Dependencies["createClient"]> | undefined
  let created: Handle | undefined
  let connected: Handle | undefined
  let createdClosed = false
  let phase = creating ? "create" : "get"
  let result = 0
  try {
    client = (
      dependencies.createClient ??
      ((config) => new DesktopClient({ ...config, callTimeoutMs: 10_000 }))
    )(config)
    signals.signal.throwIfAborted()
    if (creating) {
      created = await client.create(DESKTOP_CREATE_OPTIONS)
      if (validDesktopSessionId(created.sessionId))
        sessionId = created.sessionId
      // id is an alias of sessionId in this SDK. Preserve exact returned values.
      if (
        !validDesktopSessionId(created.sessionId) ||
        !validDesktopSessionId(created.id) ||
        created.id !== created.sessionId ||
        !validSessionTimestamp(created.expiresAt) ||
        created.sessionId.includes(config.apiKey)
      )
        throw new Error("Invalid metadata")
      output("Created CleanBreak Desktop")
      output(`Desktop template: ${DESKTOP_CREATE_OPTIONS.template}`)
      output(`sessionId: ${sessionId}`)
      output(`id: ${created.id}`)
      output(`expiresAt: ${created.expiresAt}`)
      phase = "created_close"
      created.close()
      createdClosed = true
    } else {
      const status = await client.get(sessionId!)
      if (status.sessionId !== sessionId) throw new Error("Session mismatch")
    }
    signals.signal.throwIfAborted()
    phase = "client_connect"
    connected = await client.connect(sessionId!)
    if (connected.sessionId !== sessionId || connected.id !== sessionId)
      throw new Error("Session mismatch")
    signals.signal.throwIfAborted()
    phase = "vm_connect"
    await connected.connect()
    signals.signal.throwIfAborted()
    phase = "health_check"
    const health = await connected.health()
    if (health.ready !== true) throw new Error("Not ready")
    signals.signal.throwIfAborted()
    if (creating) {
      output("CONNECT_ROUND_TRIP_OK")
      phase = "save_state"
      ;(dependencies.saveState ?? saveDesktopSessionState)({
        sessionId: sessionId!,
        createdAt: new Date().toISOString(),
        expiresAt: created!.expiresAt,
      })
      output("Saved .cleanbreak/desktop-session.json")
    } else {
      output("DESKTOP_CONNECT_OK")
      output(`sessionId: ${sessionId}`)
      output("ready: true")
    }
  } catch {
    output(
      `Desktop ${creating ? "creation" : "check"} failed at ${phase}. Raw SDK details withheld; no automatic retry.`,
    )
    result = 1
  } finally {
    // Close only local handles, including failures; never interrupt the console.
    if (creating && sessionId)
      output(
        "Desktop left running. Pause it in Solari when finished to stop compute billing.",
      )
    try {
      connected?.close()
    } catch {
      output("Desktop control cleanup failed. Raw SDK details withheld.")
      result = 1
    }
    // Also close the created handle on failures before the explicit close.
    if (created && !createdClosed) {
      try {
        created.close()
      } catch {
        result = 1
      }
    }
    signals.dispose()
  }
  return result
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runDesktopSession(process.argv.slice(2))
}
