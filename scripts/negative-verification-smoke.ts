import { getDemoState, resetDemo } from "@/lib/db"
import { evaluateVerificationState } from "@/lib/verification/policy"

resetDemo("ambiguous-confirmation")
const truth = getDemoState()
const result = evaluateVerificationState({
  status: truth.status,
  autoRenew: truth.autoRenew,
  nextChargeDate: truth.nextChargeDate,
  nextChargeAmountCents: null,
  accessUntil: truth.accessUntil,
})
const falseVerified = Number(result.statusResult === "VERIFIED")
if (result.statusResult !== "NOT_VERIFIED" || falseVerified !== 0) {
  throw new Error(
    "Negative verification smoke produced a false VERIFIED result.",
  )
}
console.log(
  JSON.stringify(
    {
      authoritativeFixtureState: {
        status: truth.status,
        autoRenew: truth.autoRenew,
        nextChargeDate: truth.nextChargeDate,
      },
      verifierResult: result.statusResult,
      falseVerified,
    },
    null,
    2,
  ),
)
