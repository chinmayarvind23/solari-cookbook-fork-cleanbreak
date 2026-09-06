// Regression checks for private-file removal from standalone build output.
import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join, sep } from "node:path"
import { expect, it } from "vitest"
it("build sanitization removes only generated copies and private manifest references", () => {
  const temporary = mkdtempSync(join(tmpdir(), "cleanbreak-build-privacy-"))
  try {
    mkdirSync(join(temporary, ".next", "standalone", ".cleanbreak"), {
      recursive: true,
    })
    mkdirSync(join(temporary, ".next", "server"), { recursive: true })
    writeFileSync(join(temporary, ".env"), "source-marker")
    writeFileSync(
      join(temporary, ".next", "standalone", ".env"),
      "copied-marker",
    )
    writeFileSync(
      join(temporary, ".next", "server", "instrumentation.js.nft.json"),
      JSON.stringify({
        version: 1,
        files: [
          "../../.env",
          "../../.cleanbreak/desktop-session.json",
          "../../artifacts/private.png",
          "../../node_modules/real-package/index.js",
        ],
      }),
    )
    execFileSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        resolve("scripts/sanitize-standalone.ts"),
      ],
      { cwd: temporary, windowsHide: true, stdio: "pipe" },
    )
    expect(readFileSync(join(temporary, ".env"), "utf8")).toBe("source-marker")
    expect(existsSync(join(temporary, ".next", "standalone", ".env"))).toBe(
      false,
    )
    expect(
      existsSync(join(temporary, ".next", "standalone", ".cleanbreak")),
    ).toBe(false)
    expect(
      JSON.parse(
        readFileSync(
          join(temporary, ".next", "server", "instrumentation.js.nft.json"),
          "utf8",
        ),
      ),
    ).toEqual({
      version: 1,
      files: ["../../node_modules/real-package/index.js"],
    })
  } finally {
    if (
      !resolve(temporary).startsWith(
        resolve(tmpdir()) + sep + "cleanbreak-build-privacy-",
      )
    )
      throw new Error("UNSAFE_TEST_CLEANUP")
    rmSync(temporary, { recursive: true })
  }
})
