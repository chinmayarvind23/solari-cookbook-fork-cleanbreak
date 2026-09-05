import "server-only"
import sharp from "sharp"

export const SCREEN_CHANGED_PIXEL_THRESHOLD = 0.005
export const SCREEN_CHANNEL_THRESHOLD = 16
export const CLICK_TARGET_PADDING = 32

export type ScreenStability = {
  changedPixelRatio: number | null
  threshold: number
  channelThreshold: number
  targetPadding: number | null
  targetChanged: boolean
  stable: boolean
  reason:
    | "STABLE"
    | "PIXEL_DRIFT"
    | "TARGET_CHANGED"
    | "DIMENSIONS_CHANGED"
    | "DECODE_FAILED"
}

async function decode(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > 32 * 1024 * 1024)
    throw new Error("INVALID_SCREENSHOT")
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 16_777_216,
  })
  const metadata = await image.metadata()
  if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1)
    throw new Error("INVALID_SCREENSHOT")
  const decoded = await image
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (decoded.info.channels !== 4) throw new Error("INVALID_SCREENSHOT")
  return decoded
}

// Compare decoded pixels, never compressed PNG bytes. Only aggregate diagnostics
// leave this function; decoded data and the fresh screenshot are not persisted.
export async function screenStability(
  original: Uint8Array,
  fresh: Uint8Array,
  clickTarget?: { x: number; y: number; endY?: number },
): Promise<ScreenStability> {
  const result: ScreenStability = {
    changedPixelRatio: null,
    threshold: SCREEN_CHANGED_PIXEL_THRESHOLD,
    channelThreshold: SCREEN_CHANNEL_THRESHOLD,
    targetPadding: clickTarget ? CLICK_TARGET_PADDING : null,
    targetChanged: false,
    stable: false,
    reason: "DECODE_FAILED",
  }
  try {
    const before = await decode(original)
    const after = await decode(fresh)
    const { width, height } = before.info
    if (width !== after.info.width || height !== after.info.height) {
      result.reason = "DIMENSIONS_CHANGED"
      return result
    }
    let changed = 0
    for (let pixel = 0; pixel < width * height; pixel++) {
      const offset = pixel * 4
      if (
        Math.abs(before.data[offset] - after.data[offset]) >
          SCREEN_CHANNEL_THRESHOLD ||
        Math.abs(before.data[offset + 1] - after.data[offset + 1]) >
          SCREEN_CHANNEL_THRESHOLD ||
        Math.abs(before.data[offset + 2] - after.data[offset + 2]) >
          SCREEN_CHANNEL_THRESHOLD ||
        // Transparency changes are never ignored as RGB noise.
        before.data[offset + 3] !== after.data[offset + 3]
      ) {
        changed++
        if (
          clickTarget &&
          Math.abs((pixel % width) - clickTarget.x) <= CLICK_TARGET_PADDING &&
          Math.floor(pixel / width) >=
            Math.min(clickTarget.y, clickTarget.endY ?? clickTarget.y) -
              CLICK_TARGET_PADDING &&
          Math.floor(pixel / width) <=
            Math.max(clickTarget.y, clickTarget.endY ?? clickTarget.y) +
              CLICK_TARGET_PADDING
        )
          result.targetChanged = true
      }
    }
    result.changedPixelRatio = changed / (width * height)
    result.stable =
      !result.targetChanged && result.changedPixelRatio <= result.threshold
    result.reason = result.targetChanged
      ? "TARGET_CHANGED"
      : result.stable
        ? "STABLE"
        : "PIXEL_DRIFT"
    return result
  } catch {
    // No decoder message, image data, metadata, or SDK body enters evidence.
    return result
  }
}
