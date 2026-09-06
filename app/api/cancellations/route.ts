// Validate one cancellation request and schedule its saved authorization.
// Validate one cancellation request and schedule its saved authorization.
import { after } from "next/server"
import { productConfig, digest } from "@/lib/cancellations/config"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { publicJob } from "@/lib/cancellations/public"
import { operatorAllowed, sameOriginPost } from "@/lib/cancellations/security"
import { executeCancellation } from "@/lib/cancellations/worker"
import { NewAttemptNotAllowed } from "@/lib/cancellations/new-attempt"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  if (!operatorAllowed(request.headers))
    return Response.json(
      { error: "OPERATOR_AUTH_REQUIRED" },
      { status: 403, headers },
    )
  if (!sameOriginPost(request.headers))
    return Response.json(
      { error: "APP_ORIGIN_MISMATCH" },
      { status: 403, headers },
    )
  try {
    const text = await request.text()
    if (text.length > 256) throw new Error("INVALID_REQUEST")
    const body = JSON.parse(text)
    const key = request.headers.get("idempotency-key")
    if (
      !key ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(key) ||
      !body ||
      Object.keys(body).some(
        (key) => !["provider", "retryOf", "scopeKey"].includes(key),
      ) ||
      ("retryOf" in body &&
        (typeof body.retryOf !== "string" ||
          !/^[a-zA-Z0-9-]{16,80}$/.test(body.retryOf))) ||
      !["miro", "streammax"].includes(body.provider)
    )
      throw new Error("INVALID_REQUEST")
    const config = productConfig(body.provider)
    if ("scopeKey" in body && body.scopeKey !== digest(config.scope))
      return Response.json(
        { error: "CONFIGURATION_CHANGED" },
        { status: 409, headers },
      )
    const job = cancellationRepository().create(config.scope, key, body.retryOf)
    after(() => executeCancellation(job.id))
    return Response.json(publicJob(job), { status: 202, headers })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof NewAttemptNotAllowed
            ? "NEW_ATTEMPT_NOT_ALLOWED"
            : "CANCELLATION_NOT_STARTED_CHECK_CONFIGURATION",
      },
      { status: 409, headers },
    )
  }
}
