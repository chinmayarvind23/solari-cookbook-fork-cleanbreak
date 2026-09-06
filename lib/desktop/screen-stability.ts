// Compare decoded pixels and protect the intended click area from changes.
import "server-only"
import sharp from "sharp"

export const SCREEN_CHANGED_PIXEL_THRESHOLD = 0.005
export const SCREEN_CHANNEL_THRESHOLD = 16
export const CLICK_TARGET_PADDING = 32

export type AnimationRegion = {
  x: number
  y: number
  width: number
  height: number
}
export type ProtectedTarget = { x: number; y: number; endY?: number }

export type ScreenStability = {
  changedPixelRatio: number | null
  threshold: number
  channelThreshold: number
  targetPadding: number | null
  targetChanged: boolean
  stable: boolean
  animation?: {
    region: AnimationRegion
    outsideChangedPixelRatio: number
    excludedPixelCount: number
    excludedChangedPixelCount: number
  }
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
  clickTarget?: ProtectedTarget,
): Promise<ScreenStability> {
  return compareScreens(original, fresh, clickTarget)
}

// Only the separately scoped navigation guard calls this. Final cancellation
// continues to use screenStability(), which has no exclusion parameter.
export async function screenStabilityOutsideAnimation(
  original: Uint8Array,
  fresh: Uint8Array,
  clickTarget: ProtectedTarget,
  region: AnimationRegion,
): Promise<ScreenStability> {
  return compareScreens(original, fresh, clickTarget, region)
}

async function compareScreens(
  original: Uint8Array,
  fresh: Uint8Array,
  clickTarget?: ProtectedTarget,
  region?: AnimationRegion,
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
    if (region) {
      // Cap excluded area at 20%; retain browser chrome, and reject rather than
      // clip any region overlapping the entire padded target/scrollbar track.
      const { x, y, width: w, height: h } = region
      const target = clickTarget!
      if (
        ![x, y, w, h].every(Number.isSafeInteger) ||
        x < 32 ||
        y < 160 ||
        w < 1 ||
        h < 1 ||
        x + w > width - 32 ||
        y + h > height - 32 ||
        w > width * 0.6 ||
        h > height * 0.5 ||
        w * h > width * height * 0.2 ||
        (x <= target.x + CLICK_TARGET_PADDING &&
          x + w - 1 >= target.x - CLICK_TARGET_PADDING &&
          y <=
            Math.max(target.y, target.endY ?? target.y) +
              CLICK_TARGET_PADDING &&
          y + h - 1 >=
            Math.min(target.y, target.endY ?? target.y) - CLICK_TARGET_PADDING)
      )
        return result
    }
    let changed = 0
    let outsideChanged = 0
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
        const px = pixel % width
        const py = Math.floor(pixel / width)
        if (
          !region ||
          px < region.x ||
          px >= region.x + region.width ||
          py < region.y ||
          py >= region.y + region.height
        )
          outsideChanged++
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
    const comparedRatio = region
      ? outsideChanged / (width * height - region.width * region.height)
      : result.changedPixelRatio
    if (region)
      result.animation = {
        region: { ...region },
        outsideChangedPixelRatio: comparedRatio,
        excludedPixelCount: region.width * region.height,
        excludedChangedPixelCount: changed - outsideChanged,
      }
    result.stable = !result.targetChanged && comparedRatio <= result.threshold
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
