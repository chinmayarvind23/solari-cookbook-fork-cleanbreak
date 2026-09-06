// Track whether navigation changed the visible page and bound stalled actions.
import type { DesktopDecision } from "./decision"
import {
  screenStability,
  screenStabilityOutsideAnimation,
  type AnimationRegion,
  type ProtectedTarget,
} from "./screen-stability"

export function pageNavigationKey(d: DesktopDecision) {
  return d.type === "key" &&
    d.keys?.length === 1 &&
    (d.keys[0] === "Page_Down" || d.keys[0] === "Page_Up")
    ? d.keys[0]
    : null
}

// Only aggregate pixels, not semantic success. Small cursor/clock drift must not
// turn an ineffective page-scroll key into evidence that the dialog moved.
export async function navigationProgress(
  before: Uint8Array,
  after: Uint8Array,
  animation?: { region: AnimationRegion; target: ProtectedTarget },
) {
  const comparison = animation
    ? await screenStabilityOutsideAnimation(
        before,
        after,
        animation.target,
        animation.region,
      )
    : await screenStability(before, after)
  if (
    comparison.reason === "DECODE_FAILED" ||
    comparison.reason === "DIMENSIONS_CHANGED"
  )
    throw new Error("NAVIGATION_OBSERVATION_FAILED")
  return {
    changedPixelRatio:
      comparison.animation?.outsideChangedPixelRatio ??
      comparison.changedPixelRatio!,
    threshold: comparison.threshold,
    screenChanged: !comparison.stable,
  }
}
export type NavigationProgress = Awaited<ReturnType<typeof navigationProgress>>
