// Apply target-aware stability checks to Desktop navigation.
import type { DesktopDecision } from "./decision"
import { isMiroExtensionOffer, type MiroScope } from "./miro"
import {
  screenStability,
  screenStabilityOutsideAnimation,
  type ProtectedTarget,
} from "./screen-stability"

// Called only after deterministic ALLOW and human review (unless explicit auto).
// No action retry, no saved mask, and no route from this helper to a final click.
export async function navigationScreenStability(options: {
  original: Uint8Array
  fresh: Uint8Array
  decision: DesktopDecision
  scope?: MiroScope
  screenshot: () => Promise<Uint8Array>
  sleep: (ms: number) => Promise<void>
  signal: AbortSignal
}) {
  const { original, fresh, decision: d, scope } = options
  const target: ProtectedTarget | undefined =
    d.type === "scroll"
      ? { x: d.x!, y: d.y!, endY: d.y! + d.deltaY! }
      : d.type === "click" || d.type === "cancel_flow_navigation"
        ? { x: d.x!, y: d.y! }
        : undefined
  const standard = await screenStability(original, fresh, target)
  if (standard.stable || standard.reason !== "PIXEL_DRIFT") return standard
  const region = d.miroObservation?.marketingAnimation
  const scrolling =
    d.type === "scroll" && d.targetText === "vertical scrollbar" && d.scrollbar
  const declining =
    (d.type === "click" || d.type === "cancel_flow_navigation") &&
    /^(no thanks|not now)$/i.test(d.targetText?.trim() ?? "") &&
    d.miroObservation?.targetRole === "BUTTON"
  if (
    !region ||
    !target ||
    !scope ||
    (!scrolling && !declining) ||
    !isMiroExtensionOffer(d, scope)
  )
    return standard
  // Protect the complete track, not just this drag's endpoints.
  const protectedTarget = scrolling
    ? {
        x: d.scrollbar!.left + d.scrollbar!.width / 2,
        y: d.scrollbar!.top,
        endY: d.scrollbar!.top + d.scrollbar!.height,
      }
    : target
  const comparison = await screenStabilityOutsideAnimation(
    original,
    fresh,
    protectedTarget,
    region,
  )
  if (!comparison.stable) return comparison
  // One additional read-only temporal sample. The same fixed observed region
  // must contain motion, while BOTH fresh frames retain stable controls/page.
  options.signal.throwIfAborted()
  await options.sleep(250)
  options.signal.throwIfAborted()
  const latest = await options.screenshot()
  const temporal = await screenStabilityOutsideAnimation(
    fresh,
    latest,
    protectedTarget,
    region,
  )
  const latestComparison = await screenStabilityOutsideAnimation(
    original,
    latest,
    protectedTarget,
    region,
  )
  options.signal.throwIfAborted()
  if (!temporal.stable) return temporal
  if (!latestComparison.stable) return latestComparison
  // A static changed illustration/control is not evidence of an animation.
  if (!temporal.animation?.excludedChangedPixelCount) return standard
  return latestComparison
}
