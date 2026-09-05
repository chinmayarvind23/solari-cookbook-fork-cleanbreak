import { cancellationRepository } from "@/lib/cancellations/repository"
import { operatorAllowed } from "@/lib/cancellations/security"
import { digest } from "@/lib/cancellations/config"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Disposition": 'inline; filename="cleanbreak-receipt.json"',
  }
  if (!operatorAllowed(request.headers))
    return Response.json({ error: "NOT_AUTHORIZED" }, { status: 403, headers })
  const job = cancellationRepository().load((await context.params).id)
  if (
    !job ||
    job.state !== "VERIFIED" ||
    !job.receipt ||
    digest(job.receipt.payload) !== job.receipt.digest
  )
    return Response.json(
      { error: "VERIFIED_RECEIPT_UNAVAILABLE" },
      { status: 404, headers },
    )
  return Response.json(job.receipt, { headers })
}
