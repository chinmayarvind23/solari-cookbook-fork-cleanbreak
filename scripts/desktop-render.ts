// Developer-only image validation/artifact. Never imported by the agent executor.
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import sharp from "sharp"

export const RENDER_ARTIFACT = ".cleanbreak/browser-render-test.png"

export async function validBrowserScreenshot(
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1024 ||
      bytes.byteLength > 32 * 1024 * 1024
    )
      return false
    const png = Buffer.from(bytes)
    if (
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return false
    if (
      !png
        .subarray(-12)
        .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
    )
      return false
    // Decode, not just a signature/size check. Bound memory and reject truncated,
    // tiny and essentially uniform frames (e.g. an all-black desktop).
    const { data, info } = await sharp(png, {
      failOn: "warning",
      limitInputPixels: 16_777_216,
    })
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.width < 320 || info.height < 200) return false
    let min = 255,
      max = 0,
      changed = 0
    const first = data[0]
    for (let i = 0; i < data.length; i += info.channels) {
      min = Math.min(min, data[i])
      max = Math.max(max, data[i])
      if (Math.abs(data[i] - first) > 8) changed++
    }
    return max - min > 8 && changed > info.width * info.height * 0.01
  } catch {
    return false
  }
}

export function writeBrowserRenderArtifact(bytes: Uint8Array): void {
  // No caller-controlled path; never serialize metadata, URLs or auth state.
  const directory = resolve(process.cwd(), ".cleanbreak")
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(resolve(directory, "browser-render-test.png"), bytes, {
    mode: 0o600,
  })
}
