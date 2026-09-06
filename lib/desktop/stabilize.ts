// Wait for a bounded stable view before evaluating a Desktop action.
import "server-only"
import type { Desktop } from "@solarisdk/desktop"
import { screenStability, type ScreenStability } from "./screen-stability"

export type TransitionStability = {
  captures: number
  stable: boolean
  deadlineReached: boolean
  comparison: ScreenStability | null
}

// Observation only. This helper cannot dispatch an input or retry an action.
export async function stabilizeDesktopPage(
  vm: Pick<Desktop, "screenshot">,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal,
): Promise<{ screenshot: Uint8Array; metrics: TransitionStability }> {
  const deadline = Date.now() + 5000
  async function bounded<T>(action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error("PAGE_STABILIZATION_FAILED")
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("PAGE_STABILIZATION_FAILED")),
            remaining,
          )
          onAbort = () => reject(new Error("INTERRUPTED"))
          signal.addEventListener("abort", onAbort, { once: true })
          if (signal.aborted) onAbort()
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (onAbort) signal.removeEventListener("abort", onAbort)
    }
  }
  const metrics: TransitionStability = {
    captures: 0,
    stable: false,
    deadlineReached: false,
    comparison: null,
  }
  let latest: Uint8Array | undefined
  try {
    await bounded(() => sleep(750))
    latest = await bounded(() => vm.screenshot({ format: "png" }))
    metrics.captures++
    // Also bounded by count for fake clocks and immediate test sleeps.
    for (let attempt = 0; attempt < 17; attempt++) {
      await bounded(() => sleep(250))
      const next = await bounded(() => vm.screenshot({ format: "png" }))
      metrics.captures++
      metrics.comparison = await bounded(() => screenStability(latest!, next))
      if (metrics.comparison.reason === "DECODE_FAILED")
        throw new Error("INVALID_SCREENSHOT")
      latest = next
      if (metrics.comparison.stable) {
        metrics.stable = true
        return { screenshot: latest, metrics }
      }
    }
  } catch {
    signal.throwIfAborted()
    // Deadline with a valid observed frame may proceed to planning. Dispatch
    // still requires its own fresh target-aware stability check.
    if (!latest || Date.now() < deadline)
      throw new Error("PAGE_STABILIZATION_FAILED")
  }
  metrics.deadlineReached = true
  return { screenshot: latest!, metrics }
}
