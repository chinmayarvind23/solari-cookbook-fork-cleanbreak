// Serialize receipt fields consistently so their digest can be checked.
import { createHash } from "node:crypto"

import type { ReceiptPayload } from "@/lib/receipts/types"

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function normalize(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON rejects non-finite numbers.")
    return value
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, JsonValue>>((result, key) => {
        const member = (value as Record<string, unknown>)[key]
        if (member === undefined)
          throw new TypeError("Canonical JSON rejects undefined values.")
        result[key] = normalize(member)
        return result
      }, {})
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value} values.`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function receiptSha256(payload: ReceiptPayload): string {
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex")
}
