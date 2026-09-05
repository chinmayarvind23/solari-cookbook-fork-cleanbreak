import { createHash, timingSafeEqual } from "node:crypto"
export function operatorAllowed(
  headers: Headers,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const password = env.CLEANBREAK_OPERATOR_PASSWORD
  if (!password)
    return (
      !env.CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL ||
      env.CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL !== "true"
    )
  const supplied = headers.get("authorization") || ""
  const expected = `Basic ${Buffer.from(`cleanbreak:${password}`).toString("base64")}`
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(expected).digest(),
  )
}
export function sameOriginPost(
  headers: Headers,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const origin = new URL(env.CLEANBREAK_APP_ORIGIN || "http://localhost:3000")
    .origin
  return (
    headers.get("origin") === origin &&
    headers.get("host") === new URL(origin).host &&
    [null, "same-origin", "none"].includes(headers.get("sec-fetch-site")) &&
    headers.get("content-type")?.split(";")[0] === "application/json"
  )
}
