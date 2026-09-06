// Return safe job progress and reconnect eligible pending work.
// Return safe job progress and reconnect eligible pending work.
import { after } from "next/server"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { publicJob } from "@/lib/cancellations/public"
import { operatorAllowed } from "@/lib/cancellations/security"
import { executeCancellation } from "@/lib/cancellations/worker"
import { terminal } from "@/lib/cancellations/state"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const headers = { "Cache-Control": "no-store" }
  if (!operatorAllowed(request.headers))
    return Response.json({ error: "NOT_AUTHORIZED" }, { status: 403, headers })
  const { id } = await context.params
  const job = cancellationRepository().load(id)
  if (!job)
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers })
  if (!terminal(job.state)) after(() => executeCancellation(id))
  return Response.json(publicJob(job), { headers })
}
