// Developer session reference only; never browser/auth state or SDK handles.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

export type DesktopSessionState = {
  sessionId: string
  createdAt: string
  expiresAt: string
}

export function desktopSessionPath() {
  return resolve(process.cwd(), ".cleanbreak", "desktop-session.json")
}

export function validDesktopSessionId(value: unknown): value is string {
  // The installed SDK describes pool:vm:org.signature; don't truncate, split,
  // decode, or substitute a console VM slot. Permit opaque SDK IDs, not URLs.
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    /^[A-Za-z0-9_.:+/=-]+$/.test(value) &&
    !value.includes("://")
  )
}

export function validSessionTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  )
}

export function readDesktopSessionState(
  path = desktopSessionPath(),
): DesktopSessionState | undefined {
  if (!existsSync(/* turbopackIgnore: true */ path)) return undefined
  try {
    const raw = readFileSync(/* turbopackIgnore: true */ path, "utf8")
    if (raw.length > 4096) throw new Error("oversize")
    const value: unknown = JSON.parse(raw)
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "createdAt,expiresAt,sessionId"
    )
      throw new Error("shape")
    const state = value as DesktopSessionState
    if (
      !validDesktopSessionId(state.sessionId) ||
      !validSessionTimestamp(state.createdAt) ||
      !validSessionTimestamp(state.expiresAt)
    )
      throw new Error("invalid")
    return state
  } catch {
    throw new Error(
      "Invalid .cleanbreak/desktop-session.json; no desktop was selected.",
    )
  }
}

export function saveDesktopSessionState(
  state: DesktopSessionState,
  path = desktopSessionPath(),
) {
  if (
    !validDesktopSessionId(state.sessionId) ||
    !validSessionTimestamp(state.createdAt) ||
    !validSessionTimestamp(state.expiresAt)
  )
    throw new Error("Invalid desktop session metadata.")
  // Select the three fields explicitly. Never serialize a Desktop/API response.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(
    path,
    JSON.stringify(
      {
        sessionId: state.sessionId,
        createdAt: state.createdAt,
        expiresAt: state.expiresAt,
      },
      null,
      2,
    ) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  )
}

export function resolveDesktopSessionId(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  loadState = readDesktopSessionState,
) {
  const explicit = environment.SOLARI_DESKTOP_SESSION_ID?.trim()
  if (explicit) {
    if (!validDesktopSessionId(explicit) || /^vm_\d+$/i.test(explicit))
      throw new Error(
        "SOLARI_DESKTOP_SESSION_ID must be the exact SDK session ID, not a console vm_XXXXXX slot. Run npm run desktop:create.",
      )
    return explicit
  }
  // Only desktop:create writes this file, after a successful SDK round-trip.
  const saved = loadState()
  if (saved) return saved.sessionId
  throw new Error(
    "SOLARI_DESKTOP_SESSION_ID is required, or run npm run desktop:create to save a verified session. SOLARI_DESKTOP_ID is no longer used.",
  )
}
