import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { Brand } from "@/components/brand"
import { createReceiptRepository } from "@/lib/receipts/repository"
import { formatCurrency } from "@/lib/subscriptions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "CleanBreak Receipt — Cancellation verified",
  description: "Tamper-evident proof that a subscription stopped renewing.",
}

function displayDate(value: string | null): string {
  if (!value) return "None"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString("en-US", { timeZone: "UTC" })
}

function Evidence({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    // Evidence routes are guarded and dynamic, so their dimensions are not known at build time.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="receipt-evidence" src={src} alt={alt} />
  ) : null
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!/^cbr_[a-f0-9]{24}$/.test(id)) notFound()
  const receipt = createReceiptRepository().getById(id)
  if (!receipt) notFound()
  const money = (cents: number) => formatCurrency(cents / 100, receipt.currency)

  return (
    <main className="receipt-shell">
      <header className="receipt-nav page-width">
        <Brand />
        <div>
          <Link href="/">Dashboard</Link>
          <a href={`/api/receipts/${receipt.receiptId}?download=1`}>
            Export JSON
          </a>
        </div>
      </header>

      <article className="receipt-document page-width">
        <section className="receipt-hero">
          <div>
            <p className="eyebrow">CleanBreak Receipt · {receipt.receiptId}</p>
            <span className="receipt-verified-mark">
              ✓ CANCELLATION VERIFIED
            </span>
            <h1>{receipt.serviceName} will not renew.</h1>
            <p className="receipt-lede">
              Independent verification found auto-renew <strong>OFF</strong> and
              the next charge <strong>NONE</strong>.
            </p>
          </div>
          <aside className="receipt-savings">
            <span>Annualized savings</span>
            <strong>{money(receipt.annualizedSavingsCents)}</strong>
            <small>/ year eliminated</small>
          </aside>
          <dl className="receipt-proof-strip">
            <div>
              <dt>Plan</dt>
              <dd>{receipt.planName}</dd>
            </div>
            <div>
              <dt>Execution browser</dt>
              <dd>{receipt.execution.sessionId}</dd>
            </div>
            <div>
              <dt>Verification browser</dt>
              <dd>{receipt.verification.sessionId}</dd>
            </div>
            <div>
              <dt>Verified at</dt>
              <dd>{displayDate(receipt.verification.verifiedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="receipt-section">
          <header>
            <span>01</span>
            <div>
              <p>Before</p>
              <h2>Renewal was active</h2>
            </div>
          </header>
          <dl className="receipt-facts">
            <div>
              <dt>Status</dt>
              <dd>{receipt.before.status}</dd>
            </div>
            <div>
              <dt>Auto-renew</dt>
              <dd>
                {receipt.before.autoRenew === null
                  ? "Unknown"
                  : receipt.before.autoRenew
                    ? "ON"
                    : "OFF"}
              </dd>
            </div>
            <div>
              <dt>Recurring charge</dt>
              <dd>
                {money(receipt.before.recurringAmountCents)} /{" "}
                {receipt.before.interval === "MONTHLY" ? "month" : "year"}
              </dd>
            </div>
            <div>
              <dt>Next charge</dt>
              <dd>{displayDate(receipt.before.nextChargeDate)}</dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>{displayDate(receipt.before.capturedAt)}</dd>
            </div>
            <div>
              <dt>Evidence URL</dt>
              <dd>{receipt.before.url}</dd>
            </div>
          </dl>
          <Evidence
            src={receipt.before.screenshotUrl}
            alt="StreamMax account before cancellation"
          />
        </section>

        <section className="receipt-section">
          <header>
            <span>02</span>
            <div>
              <p>Human approval</p>
              <h2>Exact terms were authorized</h2>
            </div>
          </header>
          <dl className="receipt-facts">
            <div>
              <dt>Action</dt>
              <dd>{receipt.approval.actionName}</dd>
            </div>
            <div>
              <dt>Target role</dt>
              <dd>{receipt.approval.targetRole}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{displayDate(receipt.approval.approvedAt)}</dd>
            </div>
            <div>
              <dt>Cancellation fee</dt>
              <dd>
                {receipt.approval.feeCents === null
                  ? "Unknown"
                  : money(receipt.approval.feeCents)}
              </dd>
            </div>
            <div>
              <dt>Access until</dt>
              <dd>{receipt.approval.accessUntil ?? "Not stated"}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd className="receipt-mono">
                {receipt.approval.actionFingerprint}
              </dd>
            </div>
          </dl>
          <ul className="receipt-criteria">
            {receipt.approval.visibleTerms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
          <Evidence
            src={receipt.approval.screenshotUrl}
            alt="Final cancellation terms shown before approval"
          />
        </section>

        <section className="receipt-section">
          <header>
            <span>03</span>
            <div>
              <p>Cancellation action</p>
              <h2>Cancellation action submitted</h2>
            </div>
          </header>
          <p className="receipt-caveat">
            This execution record is not a success claim. Only the independent
            verification below establishes the result.
          </p>
          <dl className="receipt-facts">
            <div>
              <dt>Outcome</dt>
              <dd>{receipt.execution.outcome}</dd>
            </div>
            <div>
              <dt>Destructive clicks</dt>
              <dd>{receipt.execution.destructiveClicksExecuted}</dd>
            </div>
            <div>
              <dt>Automatic retries</dt>
              <dd>{receipt.execution.automaticRetries}</dd>
            </div>
            <div>
              <dt>Armed</dt>
              <dd>{displayDate(receipt.execution.armedAt)}</dd>
            </div>
            <div>
              <dt>Click started</dt>
              <dd>{displayDate(receipt.execution.clickStartedAt)}</dd>
            </div>
            <div>
              <dt>Click returned</dt>
              <dd>{displayDate(receipt.execution.clickReturnedAt)}</dd>
            </div>
          </dl>
          <div className="receipt-evidence-grid">
            <Evidence
              src={receipt.execution.preScreenshotUrl}
              alt="Immediately before cancellation action"
            />
            <Evidence
              src={receipt.execution.postScreenshotUrl}
              alt="Immediately after cancellation action"
            />
          </div>
          <div className="receipt-replay">
            <span>Recording: {receipt.execution.recordingStatus}</span>
            {receipt.execution.replayUrl ? (
              <a
                href={receipt.execution.replayUrl}
                rel="noreferrer"
                target="_blank"
              >
                Replay cancellation ↗
              </a>
            ) : (
              <span>Replay cancellation unavailable</span>
            )}
          </div>
        </section>

        <section className="receipt-section receipt-verification">
          <header>
            <span>04</span>
            <div>
              <p>Independent verification</p>
              <h2>Future billing stopped</h2>
            </div>
          </header>
          <div className="receipt-verdict">
            <strong>VERIFIED</strong>
            <span>
              Status {receipt.verification.status} · Auto-renew{" "}
              {receipt.verification.autoRenew ? "ON" : "OFF"} · Next charge{" "}
              {receipt.verification.nextChargeDate ?? "NONE"}
            </span>
          </div>
          <p>{receipt.verification.explanation}</p>
          <dl className="receipt-facts">
            <div>
              <dt>Fresh browser</dt>
              <dd>{receipt.verification.freshSession ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Same saved profile</dt>
              <dd>{receipt.verification.sameProfileReused ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Access until</dt>
              <dd>{receipt.verification.accessUntil ?? "Not stated"}</dd>
            </div>
            <div>
              <dt>Verified URL</dt>
              <dd>{receipt.verification.url}</dd>
            </div>
          </dl>
          <ul className="receipt-criteria">
            {receipt.verification.satisfiedCriteria.map((criterion) => (
              <li key={criterion}>✓ {criterion}</li>
            ))}
          </ul>
          <Evidence
            src={receipt.verification.screenshotUrl}
            alt="Fresh-session verification of stopped renewal"
          />
          <div className="receipt-replay">
            <span>Recording: {receipt.verification.recordingStatus}</span>
            {receipt.verification.replayUrl ? (
              <a
                href={receipt.verification.replayUrl}
                rel="noreferrer"
                target="_blank"
              >
                Replay verification ↗
              </a>
            ) : (
              <span>Replay verification unavailable</span>
            )}
          </div>
        </section>

        <section className="receipt-section receipt-integrity">
          <header>
            <span>05</span>
            <div>
              <p>Integrity</p>
              <h2>Tamper-evident receipt payload</h2>
            </div>
          </header>
          <p>
            The digest covers the versioned canonical JSON payload. Changing a
            covered value changes the digest; this is not a digital signature or
            proof of identity.
          </p>
          <dl className="receipt-facts">
            <div>
              <dt>Canonical version</dt>
              <dd>{receipt.canonicalVersion}</dd>
            </div>
            <div>
              <dt>Algorithm</dt>
              <dd>SHA-256</dd>
            </div>
          </dl>
          <code className="receipt-digest">{receipt.sha256}</code>
          <a
            className="primary-button receipt-export"
            href={`/api/receipts/${receipt.receiptId}?download=1`}
          >
            Export receipt JSON
          </a>
        </section>
      </article>
    </main>
  )
}
