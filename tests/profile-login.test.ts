import { describe, expect, it, vi } from "vitest"

import { profileMetadata, runProfileHelper } from "@/scripts/profile-login"

const environment = {
  SOLARI_API_KEY: "test-key-not-for-output",
  SOLARI_PROFILE_NAME: "cleanbreak-canva",
}

function harness() {
  const profile = {
    id: "prof_test",
    name: "cleanbreak-canva",
    version: 2,
    sizeBytes: 123,
    storageState: { cookies: [{ value: "cookie-not-for-output" }] },
    token: "token-not-for-output",
  }
  const client = {
    profiles: {
      list: vi.fn(async () => [profile]),
      create: vi.fn(),
      delete: vi.fn(),
      save: vi.fn(),
    },
    launch: vi.fn(),
    close: vi.fn(async () => undefined),
  }
  const output = vi.fn()
  return { client, output, create: vi.fn(() => client) }
}

describe("developer profile helpers", () => {
  it("distinguishes a decimal-string zero byte count from absent metadata", () => {
    expect(
      profileMetadata({ id: "p", name: "n", sizeBytes: "0" }),
    ).toMatchObject({
      version: "not exposed",
      sizeBytes: 0,
    })
    expect(
      profileMetadata({ id: "p", name: "n", sizeBytes: null }).sizeBytes,
    ).toBe("not exposed")
    expect(
      profileMetadata({ id: "p", name: "n", sizeBytes: "private-value" })
        .sizeBytes,
    ).toBe("not exposed")
  })

  it("lists only allowed metadata and closes the client", async () => {
    const run = harness()
    expect(
      await runProfileHelper(["--list"], environment, run.create, run.output),
    ).toBe(0)
    expect(run.output.mock.calls).toEqual([
      [
        JSON.stringify({
          name: "cleanbreak-canva",
          id: "prof_test",
          version: 2,
          sizeBytes: 123,
        }),
      ],
    ])
    expect(run.client.close).toHaveBeenCalledOnce()
    expect(run.client.launch).not.toHaveBeenCalled()
  })

  it("reports the missing interactive UI without launching or saving", async () => {
    const run = harness()
    expect(
      await runProfileHelper([], environment, run.create, run.output),
    ).toBe(1)
    expect(run.output.mock.calls.flat().join(" ")).toContain(
      "Manual login unavailable",
    )
    expect(run.client.launch).not.toHaveBeenCalled()
    expect(run.client.profiles.save).not.toHaveBeenCalled()
    expect(run.client.close).toHaveBeenCalledOnce()
  })

  it("uses exact case-sensitive profile matching and never creates a profile", async () => {
    const run = harness()
    expect(
      await runProfileHelper(
        [],
        { ...environment, SOLARI_PROFILE_NAME: "CleanBreak-Canva" },
        run.create,
        run.output,
      ),
    ).toBe(1)
    expect(run.output.mock.calls.flat().join(" ")).toContain(
      "No profile exactly matches",
    )
    expect(run.client.profiles.create).not.toHaveBeenCalled()
    expect(run.client.close).toHaveBeenCalledOnce()
  })

  it("withholds SDK error bodies and still cleans up", async () => {
    const run = harness()
    run.client.profiles.list.mockRejectedValue(
      new Error(environment.SOLARI_API_KEY),
    )
    expect(
      await runProfileHelper(["--list"], environment, run.create, run.output),
    ).toBe(1)
    expect(run.output.mock.calls.flat().join(" ")).not.toContain(
      environment.SOLARI_API_KEY,
    )
    expect(run.client.close).toHaveBeenCalledOnce()
  })
})
