// Check saved receipt data against its canonical digest.
import { latestAgentJob } from "@/lib/agent/runtime"
import { canonicalJson, receiptSha256 } from "@/lib/receipts/canonical"
import { createReceiptRepository } from "@/lib/receipts/repository"

const job = latestAgentJob()
if (!job || job.state !== "VERIFIED") {
  throw new Error("Integrity smoke requires the latest job to be VERIFIED.")
}
const receipt = createReceiptRepository().getByJobId(job.id)
if (!receipt) throw new Error("Integrity smoke could not find the receipt.")
const { sha256, ...payload } = receipt
if (receiptSha256(payload) !== sha256) {
  throw new Error(
    "Persisted receipt digest does not match its canonical payload.",
  )
}
const tampered = structuredClone(payload)
tampered.recurringAmountCents += 1
const tamperedHash = receiptSha256(tampered)
if (tamperedHash === sha256) {
  throw new Error("A covered amount mutation did not change the digest.")
}
const orderingA = canonicalJson({ z: { b: 2, a: 1 }, a: true })
const orderingB = canonicalJson({ a: true, z: { a: 1, b: 2 } })
if (orderingA !== orderingB) {
  throw new Error("Object key reordering changed canonical JSON.")
}

console.log(
  JSON.stringify(
    {
      receiptId: receipt.receiptId,
      originalHash: sha256,
      tamperedHash,
      mutationChangesHash: tamperedHash !== sha256,
      reorderedKeysPreserveCanonicalForm: orderingA === orderingB,
    },
    null,
    2,
  ),
)
