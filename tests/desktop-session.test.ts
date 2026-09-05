import { randomBytes } from "node:crypto"
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Desktop } from "@solarisdk/desktop"
import * as session from "@/lib/desktop/session"
import { readDesktopConnection, readDesktopConfig } from "@/lib/desktop/config"
import {
  DESKTOP_CREATE_OPTIONS,
  runDesktopSession,
} from "@/scripts/desktop-session"
import { runDesktopOpen } from "@/scripts/desktop-open"
import { runDesktopType } from "@/scripts/desktop-type"
import { runDesktopDryRun } from "@/lib/desktop/runtime"
import { renderImage } from "./helpers/render-image"

const expiresAt = "2026-12-01T12:00:00.000Z"
const createdAt = "2026-12-01T11:00:00.000Z"
function harness() {
  const sessionId = `pool:vm_123456:org.${randomBytes(24).toString("base64url")}`
  const env = {
    SOLARI_API_KEY: randomBytes(24).toString("hex"),
    SOLARI_DESKTOP_ID: "vm_123001",
  }
  const hidden = randomBytes(24).toString("hex")
  const handle = () => ({
    sessionId,
    id: sessionId,
    expiresAt,
    controlUrl: `wss://example.invalid/control?token=${hidden}`,
    streamUrl: `wss://example.invalid/stream?token=${hidden}`,
    connect: vi.fn(async () => undefined),
    health: vi.fn(async () => ({ ready: true, display: true, vnc: true })),
    close: vi.fn(),
    open: vi.fn(async () => 123),
    screenshot: vi.fn(async () => renderImage),
    process: { list: vi.fn(async () => [{ pid: 123, name: "firefox" }]) },
    destroy: vi.fn(),
    keyboard: { type: vi.fn(async (_text: string) => undefined) },
    stream: {
      start: vi.fn(async () => ({
        streamUrl: `wss://example.invalid/?token=${hidden}`,
      })),
    },
    pause: vi.fn(async () => undefined),
  })
  const created = handle(),
    connected = handle()
  const client = {
    create: vi.fn(async () => created),
    get: vi.fn(async (_id: string) => ({
      sessionId,
      expiresAt,
      status: "ready" as const,
    })),
    connect: vi.fn(async (_id: string) => connected),
    pause: vi.fn(async (_id: string) => ({
      sessionId,
      status: "paused" as const,
    })),
    destroy: vi.fn(),
  }
  const deps = {
    createClient: vi.fn(() => client),
    output: vi.fn(),
    loadState: vi.fn((): session.DesktopSessionState | undefined => undefined),
    saveState: vi.fn((_state: session.DesktopSessionState) => undefined),
  }
  return { sessionId, env, hidden, created, connected, client, deps }
}
afterEach(() => vi.restoreAllMocks())

describe("SDK Desktop create/check", () => {
  it("round-trips the exact SDK ID, persists safe fields and closes without pausing or destroying", async () => {
    const h = harness()
    expect(await runDesktopSession(["--create"], h.env, h.deps)).toBe(0)
    expect(h.client.create).toHaveBeenCalledExactlyOnceWith({
      template: "office",
      resolution: "1280x720",
      cpu: 2,
      memMb: 4096,
      timeoutMs: 3_600_000,
      lifecycle: { onTimeout: "pause", autoResume: false },
      record: false,
    })
    expect(h.created.close).toHaveBeenCalledOnce()
    expect(h.created.close.mock.invocationCallOrder[0]).toBeLessThan(
      h.client.connect.mock.invocationCallOrder[0],
    )
    expect(h.client.connect).toHaveBeenCalledExactlyOnceWith(h.sessionId)
    expect(h.connected.connect).toHaveBeenCalledOnce()
    expect(h.connected.health).toHaveBeenCalledOnce()
    const state = h.deps.saveState.mock.calls[0][0]
    expect(Object.keys(state).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "sessionId",
    ])
    expect(state.sessionId).toBe(h.sessionId)
    expect(state.expiresAt).toBe(expiresAt)
    expect(session.validSessionTimestamp(state.createdAt)).toBe(true)
    expect(h.deps.saveState.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.connected.health.mock.invocationCallOrder[0],
    )
    expect(h.client.pause).not.toHaveBeenCalled()
    expect(h.connected.close).toHaveBeenCalledOnce()
    expect(h.client.destroy).not.toHaveBeenCalled()
    expect(h.created.destroy).not.toHaveBeenCalled()
    const output = h.deps.output.mock.calls.flat().join("\n")
    expect(output).toContain(
      `sessionId: ${h.sessionId}\nid: ${h.sessionId}\nexpiresAt: ${expiresAt}`,
    )
    expect(output).toContain("CONNECT_ROUND_TRIP_OK")
    expect(h.deps.output).toHaveBeenCalledWith("Desktop template: office")
    for (const value of [
      h.hidden,
      h.env.SOLARI_API_KEY,
      "wss://",
      "controlUrl",
      "streamUrl",
    ]) {
      expect(output.includes(value)).toBe(false)
      expect(JSON.stringify(state).includes(value)).toBe(false)
    }
  })
  it.each([
    "create",
    "client_connect",
    "vm_connect",
    "health",
    "not_ready",
    "save",
  ])("fails safely at %s without retries or destruction", async (phase) => {
    const h = harness()
    const error = new Error(
      `Authorization: ${h.env.SOLARI_API_KEY} ${h.hidden}`,
    )
    if (phase === "create") h.client.create.mockRejectedValueOnce(error)
    if (phase === "client_connect")
      h.client.connect.mockRejectedValueOnce(error)
    if (phase === "vm_connect") h.connected.connect.mockRejectedValueOnce(error)
    if (phase === "health") h.connected.health.mockRejectedValueOnce(error)
    if (phase === "not_ready")
      h.connected.health.mockResolvedValueOnce({
        ready: false,
        display: false,
        vnc: false,
      })
    if (phase === "save")
      h.deps.saveState.mockImplementationOnce(() => {
        throw error
      })
    expect(await runDesktopSession(["--create"], h.env, h.deps)).toBe(1)
    expect(h.client.create).toHaveBeenCalledOnce()
    if (phase !== "save") expect(h.deps.saveState).not.toHaveBeenCalled()
    if (phase !== "create") {
      expect(h.created.close).toHaveBeenCalledOnce()
      expect(h.client.pause).not.toHaveBeenCalled()
    }
    if (!["create", "client_connect"].includes(phase))
      expect(h.connected.close).toHaveBeenCalledOnce()
    expect(h.client.destroy).not.toHaveBeenCalled()
    const output = h.deps.output.mock.calls.flat().join(" ")
    expect(output.includes(h.env.SOLARI_API_KEY)).toBe(false)
    expect(output.includes(h.hidden)).toBe(false)
  })
  it("refuses to overwrite existing local state or create behind an environment override", async () => {
    const h = harness()
    h.deps.loadState.mockReturnValueOnce({
      sessionId: h.sessionId,
      createdAt,
      expiresAt,
    })
    expect(await runDesktopSession(["--create"], h.env, h.deps)).toBe(1)
    expect(
      await runDesktopSession(
        ["--create"],
        { ...h.env, SOLARI_DESKTOP_SESSION_ID: h.sessionId },
        h.deps,
      ),
    ).toBe(1)
    expect(h.deps.createClient).not.toHaveBeenCalled()
  })
  it.each(["alias", "expiry", "returned_url", "reconnect_mismatch"])(
    "rejects invalid %s metadata without persisting or leaking it",
    async (kind) => {
      const h = harness()
      if (kind === "alias") h.created.id = "different-session"
      if (kind === "expiry") h.created.expiresAt = h.created.controlUrl
      if (kind === "returned_url")
        h.created.id = h.created.sessionId = h.created.controlUrl
      if (kind === "reconnect_mismatch")
        h.connected.sessionId = "different-session"
      expect(await runDesktopSession(["--create"], h.env, h.deps)).toBe(1)
      expect(h.deps.saveState).not.toHaveBeenCalled()
      expect(h.created.close).toHaveBeenCalledOnce()
      expect(h.client.destroy).not.toHaveBeenCalled()
      expect(h.deps.output.mock.calls.flat().join(" ").includes(h.hidden)).toBe(
        false,
      )
    },
  )
  it("rejects legacy console IDs without making even a get request", async () => {
    const h = harness()
    expect(await runDesktopSession(["--check"], h.env, h.deps)).toBe(1)
    expect(
      await runDesktopSession(
        ["--check"],
        { ...h.env, SOLARI_DESKTOP_SESSION_ID: "vm_123001" },
        h.deps,
      ),
    ).toBe(1)
    expect(h.deps.createClient).not.toHaveBeenCalled()
  })
  it("check gets, connects, tests health and closes only, with no typing/creation/pause", async () => {
    const h = harness()
    h.deps.loadState.mockReturnValue({
      sessionId: h.sessionId,
      createdAt,
      expiresAt,
    })
    expect(await runDesktopSession(["--check"], h.env, h.deps)).toBe(0)
    expect(h.client.get).toHaveBeenCalledExactlyOnceWith(h.sessionId)
    expect(h.client.connect).toHaveBeenCalledExactlyOnceWith(h.sessionId)
    expect(h.connected.connect).toHaveBeenCalledOnce()
    expect(h.connected.health).toHaveBeenCalledOnce()
    expect(h.connected.close).toHaveBeenCalledOnce()
    expect(h.deps.output.mock.calls).toEqual([
      ["DESKTOP_CONNECT_OK"],
      [`sessionId: ${h.sessionId}`],
      ["ready: true"],
    ])
    expect(h.client.create).not.toHaveBeenCalled()
    expect(h.client.pause).not.toHaveBeenCalled()
    expect(h.client.destroy).not.toHaveBeenCalled()
    expect(h.connected.keyboard.type).not.toHaveBeenCalled()
  })
  it("check refuses a mismatched get result and never substitutes its ID", async () => {
    const h = harness()
    h.client.get.mockResolvedValueOnce({
      sessionId: "vm_123002",
      expiresAt,
      status: "ready",
    })
    expect(
      await runDesktopSession(
        ["--check"],
        { ...h.env, SOLARI_DESKTOP_SESSION_ID: h.sessionId },
        h.deps,
      ),
    ).toBe(1)
    expect(h.client.connect).not.toHaveBeenCalled()
  })
})

describe("shared Desktop session resolution", () => {
  it("prefers the exact new environment ID, then verified local state, never the legacy slot", () => {
    const h = harness()
    const load = vi.fn(() => ({ sessionId: h.sessionId, createdAt, expiresAt }))
    expect(
      session.resolveDesktopSessionId(
        { ...h.env, SOLARI_DESKTOP_SESSION_ID: "another:exact:id.signature" },
        load,
      ),
    ).toBe("another:exact:id.signature")
    expect(load).not.toHaveBeenCalled()
    expect(session.resolveDesktopSessionId(h.env, load)).toBe(h.sessionId)
    expect(() =>
      session.resolveDesktopSessionId(h.env, () => undefined),
    ).toThrow("SOLARI_DESKTOP_SESSION_ID")
    for (const value of [
      "vm_123001",
      "vm_123002",
      "https://example.invalid/?token=data",
      "bad\nvalue",
    ]) {
      expect(() =>
        session.resolveDesktopSessionId(
          { SOLARI_DESKTOP_SESSION_ID: value },
          load,
        ),
      ).toThrow("exact SDK session ID")
    }
  })
  it("type, open, and validation all consume the same saved session through shared config", async () => {
    const h = harness()
    vi.spyOn(session, "readDesktopSessionState").mockReturnValue({
      sessionId: h.sessionId,
      createdAt,
      expiresAt,
    })
    expect(readDesktopConnection(h.env).desktopId).toBe(h.sessionId)
    expect(
      await runDesktopType(["--test"], h.env, {
        createClient: () => h.client,
        output: vi.fn(),
      }),
    ).toBe(0)
    expect(h.client.connect).toHaveBeenLastCalledWith(h.sessionId)
    const viewer = {
      url: "http://127.0.0.1/manual/",
      close: vi.fn(async () => undefined),
      setRecording: vi.fn(),
    }
    expect(
      await runDesktopOpen(
        {
          ...h.env,
          CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
          CLEANBREAK_REAL_PROVIDER_URL: "https://provider.example/billing",
        },
        {
          createClient: () => ({
            ...h.client,
            connect: async (id) =>
              (await h.client.connect(id)) as unknown as Desktop,
          }),
          interactive: true,
          output: vi.fn(),
          viewer: vi.fn(async () => viewer),
          confirm: vi.fn(async () => true),
          wait: vi.fn(async () => undefined),
        },
      ),
    ).toBe(0)
    expect(h.client.connect).toHaveBeenLastCalledWith(h.sessionId)
    const validationEnv = {
      ...h.env,
      NODE_ENV: "test",
      OPENAI_API_KEY: h.env.SOLARI_API_KEY,
      CLEANBREAK_REAL_PROVIDER_EXECUTOR: "desktop",
      CLEANBREAK_DRY_RUN: "true",
      CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
      CLEANBREAK_REAL_PROVIDER_NAME: "Test Provider",
      CLEANBREAK_REAL_PROVIDER_PLAN_NAME: "Trial",
      CLEANBREAK_REAL_PROVIDER_URL: "https://provider.example/billing",
      CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS: "100",
      CLEANBREAK_REAL_PROVIDER_CURRENCY: "USD",
      CLEANBREAK_REAL_PROVIDER_INTERVAL: "MONTHLY",
    } as NodeJS.ProcessEnv
    expect(readDesktopConfig(validationEnv).desktopId).toBe(h.sessionId)
    const result = await runDesktopDryRun(validationEnv, {
      client: {
        ...h.client,
        connect: async (id) =>
          (await h.client.connect(id)) as unknown as Desktop,
      },
      planner: vi.fn(),
      prepare: vi.fn(async () => false),
      viewer: vi.fn(async () => viewer),
      evidence: {
        directory: "offline",
        screenshot: vi.fn(),
        job: vi.fn(),
        validation: vi.fn(),
      },
    })
    expect(result.desktopId).toBe(h.sessionId)
    expect(h.client.connect).toHaveBeenLastCalledWith(h.sessionId)
    expect(h.client.connect).toHaveBeenCalledTimes(3)
    expect(h.client.destroy).not.toHaveBeenCalled()
  })
  it("writes only the allowed JSON fields, round-trips from disk, refuses overwrite, and is gitignored", () => {
    const h = harness()
    const directory = mkdtempSync(join(tmpdir(), "cleanbreak-session-test-"))
    const path = join(directory, "desktop-session.json")
    try {
      session.saveDesktopSessionState({ ...h.created, createdAt }, path)
      const raw = readFileSync(path, "utf8")
      expect(JSON.parse(raw)).toEqual({
        sessionId: h.sessionId,
        createdAt,
        expiresAt,
      })
      expect(session.readDesktopSessionState(path)).toEqual({
        sessionId: h.sessionId,
        createdAt,
        expiresAt,
      })
      expect(raw.includes(h.hidden)).toBe(false)
      expect(raw.includes(h.env.SOLARI_API_KEY)).toBe(false)
      expect(() =>
        session.saveDesktopSessionState(
          { sessionId: "other", createdAt, expiresAt },
          path,
        ),
      ).toThrow()
      expect(session.readDesktopSessionState(path)?.sessionId).toBe(h.sessionId)
      expect(
        execFileSync(
          "git",
          ["check-ignore", ".cleanbreak/desktop-session.json"],
          { encoding: "utf8" },
        ).trim(),
      ).toBe(".cleanbreak/desktop-session.json")
    } finally {
      for (const name of readdirSync(directory))
        unlinkSync(join(directory, name))
      rmdirSync(directory)
    }
  })
})
