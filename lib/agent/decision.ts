// Validate structured planner decisions before policy evaluates them.
import { z } from "zod"

import type { BrowserDecision } from "@/lib/agent/types"

export const browserDecisionSchema = z
  .object({
    type: z.enum([
      "click",
      "fill",
      "select",
      "navigate",
      "final_cancel_candidate",
      "needs_human",
      "failure",
    ]),
    observationId: z.string().min(1),
    targetId: z.string().nullable(),
    value: z.string().nullable(),
    url: z.string().nullable(),
    reasoning: z.string().min(1).max(600),
    confidence: z.number().min(0).max(1).nullable(),
    reason: z.string().max(300).nullable(),
  })
  .strict()

export function validateDecision(value: unknown): BrowserDecision {
  const decision = browserDecisionSchema.parse(value)
  const targeted = ["click", "fill", "select", "final_cancel_candidate"]
  if (targeted.includes(decision.type) && !decision.targetId) {
    throw new Error(`${decision.type} requires a targetId`)
  }
  if (decision.type === "navigate" && !decision.url) {
    throw new Error("navigate requires a URL")
  }
  if (["fill", "select"].includes(decision.type) && decision.value === null) {
    throw new Error(`${decision.type} requires a value`)
  }
  if (["needs_human", "failure"].includes(decision.type) && !decision.reason) {
    throw new Error(`${decision.type} requires a reason`)
  }
  if (
    !["needs_human", "failure"].includes(decision.type) &&
    decision.confidence === null
  ) {
    throw new Error(`${decision.type} requires confidence`)
  }
  return decision
}
