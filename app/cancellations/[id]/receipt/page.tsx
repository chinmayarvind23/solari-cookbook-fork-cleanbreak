// Display a saved one-click receipt after checking its digest.
// Display a saved one-click receipt after checking its digest.
import Link from "next/link"
import { notFound } from "next/navigation"
import { Brand } from "@/components/brand"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { digest } from "@/lib/cancellations/config"
export const dynamic = "force-dynamic"
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const job = cancellationRepository().load((await params).id)
  if (
    !job ||
    job.state !== "VERIFIED" ||
    !job.receipt ||
    digest(job.receipt.payload) !== job.receipt.digest
  )
    notFound()
  const auth = job.authorization
  return (
    <main className="page-width">
      <header className="dashboard-nav">
        <Brand />
        <Link href="/">Dashboard</Link>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">CleanBreak Receipt · independently verified</p>
          <h1>Cancellation verified.</h1>
          <p>
            {auth.provider === "miro" ? "Miro" : "StreamMax"} · {auth.planName}
          </p>
          <p>
            Future renewal is off. Avoided next recurring charge:{" "}
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: auth.currency,
            }).format(auth.expectedAmountCents / 100)}
            .
          </p>
          <p>
            Authorized: {auth.authorizedAt}
            <br />
            Verified: {job.verification?.at}
          </p>
          <p>
            One acknowledged destructive click · one authorization use · zero
            automatic retries · zero unsafe actions.
          </p>
          <p>
            Execution and verification used distinct control contexts. Desktop
            verification uses a new browser page within the same authenticated
            VM profile, not a new identity. DOM verification reloads the billing
            page and compares structured facts without sending screenshots.
          </p>
          <p>SHA-256 digest</p>
          <code style={{ overflowWrap: "anywhere" }}>{job.receipt.digest}</code>
          <p>
            The digest detects changes against a retained copy; it is not a
            digital signature or provider attestation.
          </p>
          <a
            className="primary-button"
            href={`/api/cancellations/${job.id}/receipt`}
          >
            Download evidence receipt JSON
          </a>
        </div>
      </section>
    </main>
  )
}
