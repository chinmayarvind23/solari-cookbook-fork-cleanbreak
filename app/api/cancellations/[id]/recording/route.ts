// Stream the saved original recording to an authenticated operator.
// Stream the saved original recording to an authenticated operator.
import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { operatorAllowed } from "@/lib/cancellations/security"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }
  // Private recordings remain protected even after live execution is disabled.
  if (
    !operatorAllowed(request.headers, {
      ...process.env,
      CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL: "true",
    })
  )
    return Response.json({ error: "NOT_AUTHORIZED" }, { status: 403, headers })
  const { id } = await context.params
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(id))
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers })
  const job = cancellationRepository().load(id)
  if (
    job?.recording?.status !== "AVAILABLE" ||
    job.recording.filename !== "cancellation.mp4"
  )
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers })
  try {
    const path = resolve(
      process.cwd(),
      "artifacts",
      "cancellations",
      id,
      "cancellation.mp4",
    )
    const stat = statSync(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 128 * 1024 * 1024)
      throw new Error("INVALID_RECORDING")
    const bytes = readFileSync(path)
    if (
      bytes.length !== job.recording.sizeBytes ||
      bytes.subarray(4, 8).toString("ascii") !== "ftyp"
    )
      throw new Error("INVALID_RECORDING")
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="cleanbreak-${id}.mp4"`,
      },
    })
  } catch {
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers })
  }
}
