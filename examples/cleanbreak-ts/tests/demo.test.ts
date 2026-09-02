import { describe, expect, it } from "vitest"

import {
  cancellationOutcome,
  firstCancellationScreen,
  resetStateForScenario,
} from "@/lib/demo"

describe("deterministic StreamMax scenarios", () => {
  it("starts ordinary scenarios with renewal enabled", () => {
    const state = resetStateForScenario(
      "dark-pattern",
      "2026-09-02T00:00:00.000Z",
    )

    expect(state).toMatchObject({
      status: "ACTIVE",
      autoRenew: true,
      nextChargeDate: "2026-09-28",
      lastMessage: null,
    })
  })

  it("starts the already-canceled scenario without a future charge", () => {
    const state = resetStateForScenario("already-canceled")

    expect(state).toMatchObject({
      status: "CANCELED",
      autoRenew: false,
      nextChargeDate: null,
    })
  })

  it("routes the dark-pattern variant through retention screens", () => {
    expect(firstCancellationScreen("dark-pattern")).toBe("pause-offer")
    expect(firstCancellationScreen("happy-path")).toBe("terms")
  })

  it("keeps ambiguous confirmation active", () => {
    expect(cancellationOutcome("ambiguous-confirmation")).toEqual({
      status: "ACTIVE",
      autoRenew: true,
      nextChargeDate: "2026-09-28",
      lastMessage: "Request received.",
    })
  })

  it("produces an authoritative canceled state for a completed fixture flow", () => {
    expect(cancellationOutcome("happy-path")).toEqual({
      status: "CANCELED",
      autoRenew: false,
      nextChargeDate: null,
      lastMessage: "Your membership has been canceled.",
    })
  })
})
