// Checks live-server configuration and startup safety.
import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { runLiveWeb } from "@/scripts/dev-live"

function harness() {
  const password = randomUUID()
  return {
    password,
    readPassword: vi.fn(async (): Promise<string> => password),
    output: vi.fn(),
    validate: vi.fn(),
    start: vi.fn(async (env: NodeJS.ProcessEnv, port: string) => {
      expect(env.CLEANBREAK_OPERATOR_PASSWORD).toBe(password)
      expect(env.CLEANBREAK_DRY_RUN).toBe("false")
      expect(env.CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL).toBe("true")
      expect(env.CLEANBREAK_REAL_PROVIDER_AUTHORIZED).toBe("true")
      expect(env.CLEANBREAK_REAL_PROVIDER_EXECUTOR).toBe("desktop")
      expect(env.CLEANBREAK_CANCELLATION_WORKER).toBe("false")
      expect(port).toBe("3000")
      return 0
    }),
  }
}
describe("explicit developer live web setup", () => {
  it("passes settings to the web server without changing parent env or starting jobs", async () => {
    const d = harness(),
      env = { CLEANBREAK_DRY_RUN: "true" }
    expect(await runLiveWeb(env, d)).toBe(0)
    expect(env).toEqual({ CLEANBREAK_DRY_RUN: "true" })
    expect(d.validate).toHaveBeenCalledOnce()
    expect(d.start).toHaveBeenCalledOnce()
    expect(d.output.mock.calls.flat().join(" ")).toContain(
      "Open exactly: http://localhost:3000",
    )
    expect(d.output.mock.calls.flat().join(" ")).not.toContain(d.password)
    expect(
      d.start.mock.calls[0][0].CLEANBREAK_OPERATOR_PASSWORD,
    ).toBeUndefined()
  })
  it("uses an existing valid operator password without prompting or echoing", async () => {
    const d = harness()
    expect(
      await runLiveWeb({ CLEANBREAK_OPERATOR_PASSWORD: d.password }, d),
    ).toBe(0)
    expect(d.readPassword).not.toHaveBeenCalled()
    expect(d.output.mock.calls.flat().join(" ")).not.toContain(d.password)
  })
  it.each([
    "http://example.com",
    "https://localhost:3000",
    "http://localhost:3000/?token=private",
    "http://user:private@localhost:3000",
    "not-a-url",
  ])("rejects unsafe/mismatched developer origin %s", async (origin) => {
    const d = harness()
    expect(await runLiveWeb({ CLEANBREAK_APP_ORIGIN: origin }, d)).toBe(1)
    expect(d.start).not.toHaveBeenCalled()
    expect(d.output.mock.calls.flat().join(" ")).not.toContain("private")
  })
  it("does not start with a short password", async () => {
    const d = harness()
    d.readPassword.mockResolvedValue("")
    expect(await runLiveWeb({}, d)).toBe(1)
    expect(d.start).not.toHaveBeenCalled()
  })
  it("withholds raw configuration errors and fails before server start", async () => {
    const d = harness()
    d.validate.mockImplementation(() => {
      throw new Error(d.password)
    })
    expect(await runLiveWeb({}, d)).toBe(1)
    expect(d.start).not.toHaveBeenCalled()
    expect(d.output.mock.calls.flat().join(" ")).not.toContain(d.password)
  })
})
