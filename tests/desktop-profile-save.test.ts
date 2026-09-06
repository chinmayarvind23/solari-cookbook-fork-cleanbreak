// Checks explicit authentication refresh and safe profile uploads.
import { expect, it, vi } from "vitest"
import { saveAuthenticatedDesktopProfile } from "../scripts/desktop-profile-save"
import type { Solari } from "@solarisdk/browser"
const make = () => ({
  profiles: {
    list: vi.fn(async () => [{ name: "offline-profile", id: "offline-id" }]),
    save: vi.fn(async () => ({ version: 2, sizeBytes: 100 })),
  },
})
it("uploads IndexedDB-capable in-memory state only after two positive auth checks", async () => {
  const api = make(),
    state = { cookies: [{ name: "offline-placeholder" }], origins: [] },
    context = { storageState: vi.fn(async () => state) },
    auth = vi.fn(async () => true),
    log = vi.spyOn(console, "log")
  const safe = await saveAuthenticatedDesktopProfile(
    api as unknown as Solari,
    context as never,
    "offline-profile",
    auth,
  )
  expect(context.storageState).toHaveBeenCalledWith({ indexedDB: true })
  expect(api.profiles.save).toHaveBeenCalledWith("offline-id", state)
  expect(auth).toHaveBeenCalledTimes(2)
  expect(safe).toEqual({
    name: "offline-profile",
    id: "offline-id",
    version: 2,
    sizeBytes: 100,
  })
  expect(log).not.toHaveBeenCalled()
  log.mockRestore()
})
it.each(["missing", "unauthenticated", "auth-lost"])(
  "does not overwrite on %s",
  async (kind) => {
    const api = make(),
      context = {
        storageState: vi.fn(async () => ({ cookies: [{}], origins: [] })),
      },
      auth = vi.fn().mockResolvedValue(kind !== "unauthenticated")
    if (kind === "auth-lost")
      auth.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(
      saveAuthenticatedDesktopProfile(
        api as unknown as Solari,
        context as never,
        kind === "missing" ? "absent" : "offline-profile",
        auth,
      ),
    ).rejects.toThrow()
    expect(api.profiles.save).not.toHaveBeenCalled()
  },
)
