// Checks VM-local profile migration and preservation of the original.
import { describe, expect, it, vi } from "vitest"
import type { Desktop } from "@solarisdk/desktop"
import {
  MIGRATE_AUTH_LOCALLY,
  migrateDesktopAuthentication,
} from "../scripts/desktop-profile-migrate"

function fixture() {
  const vm = {
    process: {
      list: vi.fn(async () => [
        { pid: 123, comm: "chrome", cmdline: "/opt/google/chrome/chrome" },
      ]),
    },
    exec: vi.fn(async (command: string) =>
      command === "test"
        ? { exitCode: 0 }
        : {
            exitCode: 0,
            stdout: JSON.stringify({ migrated: true, originalPreserved: true }),
          },
    ),
    open: vi.fn(async () => 456),
    ports: {
      list: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ port: 9222, addr: "127.0.0.1" }]),
    },
    health: vi.fn(async () => ({ ready: true })),
  }
  return { vm, typed: vm as unknown as Desktop }
}
describe("explicit VM-local authentication migration", () => {
  it("copies only in the guest, preserves originals, and opens headful private Chrome", async () => {
    const { vm, typed } = fixture()
    await migrateDesktopAuthentication(
      typed,
      "https://miro.com/billing",
      async () => {},
    )
    expect(vm.exec).toHaveBeenCalledWith(
      "python3",
      expect.objectContaining({
        args: ["-c", MIGRATE_AUTH_LOCALLY, "123", expect.any(String)],
      }),
    )
    expect(vm.open).toHaveBeenCalledWith(
      "/usr/bin/google-chrome",
      expect.arrayContaining([
        "--user-data-dir=/tmp/cleanbreak-chrome",
        "--remote-debugging-address=127.0.0.1",
      ]),
    )
    expect(vm.open.mock.calls[0]).not.toContain("--headless")
    expect(MIGRATE_AUTH_LOCALLY).not.toContain("\u0000")
    expect(MIGRATE_AUTH_LOCALLY).not.toMatch(
      /rmtree|SIGKILL|base64|print\(state|print\(env/,
    )
    expect(MIGRATE_AUTH_LOCALLY).toContain("destination.rename(backup)")
    expect(MIGRATE_AUTH_LOCALLY).toContain("source.is_relative_to(home)")
    expect(MIGRATE_AUTH_LOCALLY).toContain("item.is_symlink()")
  })
  it("fails closed with no launch when migration cannot be confirmed", async () => {
    const { vm, typed } = fixture()
    vm.exec.mockResolvedValue({ exitCode: 2 } as never)
    await expect(
      migrateDesktopAuthentication(typed, "https://miro.com/billing"),
    ).rejects.toThrow("CHROME_UNAVAILABLE")
    expect(vm.open).not.toHaveBeenCalled()
  })
  it("refuses ambiguous Chrome roots and an existing debug port", async () => {
    const a = fixture()
    a.vm.process.list.mockResolvedValue([])
    await expect(
      migrateDesktopAuthentication(a.typed, "https://miro.com/billing"),
    ).rejects.toThrow("DEFAULT_CHROME_NOT_IDENTIFIED")
    expect(a.vm.exec).not.toHaveBeenCalled()
    const b = fixture()
    b.vm.ports.list
      .mockReset()
      .mockResolvedValue([{ port: 9222, addr: "0.0.0.0" }])
    await expect(
      migrateDesktopAuthentication(b.typed, "https://miro.com/billing"),
    ).rejects.toThrow("DEBUG_PORT_ALREADY_IN_USE")
    expect(b.vm.open).not.toHaveBeenCalled()
  })
})
