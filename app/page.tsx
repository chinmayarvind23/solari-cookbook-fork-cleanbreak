import Link from "next/link"

import { resetDemoAction } from "@/app/actions"
import { Brand } from "@/components/brand"
import { SubscriptionCard } from "@/components/subscription-card"
import { CancellationCard } from "@/components/cancellation-card"
import { miroProductSummary } from "@/lib/cancellations/config"
import { getDemoState, listSubscriptions } from "@/lib/db"
import { createAgentRepository } from "@/lib/agent/repository"
import { createReceiptRepository } from "@/lib/receipts/repository"
import {
  annualCost,
  formatCurrency,
  monthlyEquivalent,
} from "@/lib/subscriptions"

export const dynamic = "force-dynamic"

export default function DashboardPage() {
  const miro = miroProductSummary()
  const subscriptions = listSubscriptions()
  const demoState = getDemoState()
  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === "ACTIVE",
  )
  const monthlySpend = activeSubscriptions.reduce(
    (total, subscription) => total + monthlyEquivalent(subscription),
    0,
  )
  const annualSpend = activeSubscriptions.reduce(
    (total, subscription) =>
      total + annualCost(subscription.amount, subscription.interval),
    0,
  )
  const streamMax = subscriptions.find(
    (subscription) => subscription.slug === "streammax",
  )!
  const potentialSavings =
    streamMax.status === "ACTIVE"
      ? annualCost(streamMax.amount, streamMax.interval)
      : 0
  const verifiedSavings =
    createAgentRepository().getVerifiedAnnualSavingsCents() / 100
  const latestStreamMaxReceipt =
    createReceiptRepository().getLatestForSubscription(streamMax.id)

  return (
    <main className="dashboard-shell">
      <header className="dashboard-nav page-width">
        <Brand />
        <div className="nav-actions">
          <Link className="text-link" href="/demo">
            Demo lab
          </Link>
          <button className="avatar" type="button" aria-label="User menu">
            CM
          </button>
        </div>
      </header>

      <section className="hero page-width">
        <div className="hero-copy">
          <p className="eyebrow">Subscription control, with proof</p>
          <h1>Break up with recurring charges.</h1>
          <p className="hero-subtitle">
            CleanBreak cancels subscriptions in a real browser, then checks
            again to prove they actually stopped renewing.
          </p>
        </div>
        <aside className="trust-note">
          <span className="trust-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>Execution is not proof.</strong>
            <p>Only independent verification creates a CleanBreak Receipt.</p>
          </div>
        </aside>
      </section>

      <section className="metrics page-width" aria-label="Subscription summary">
        <article className="metric-card metric-primary">
          <p>Active recurring spend</p>
          <strong>{formatCurrency(annualSpend)}</strong>
          <span>/ year</span>
          <small>
            {activeSubscriptions.length} active · {formatCurrency(monthlySpend)}
            /month
          </small>
        </article>
        <article className="metric-card">
          <p>Potential savings</p>
          <strong>{formatCurrency(potentialSavings)}</strong>
          <span>/ year</span>
          <small>Available in the StreamMax demo</small>
        </article>
        <article className="metric-card">
          <div className="metric-label-row">
            <p>Verified savings</p>
            <span className="verified-badge">FRESH-SESSION PROOF</span>
          </div>
          <strong>{formatCurrency(verifiedSavings)}</strong>
          <span>/ year</span>
          <small>
            {verifiedSavings > 0
              ? "Independently verified"
              : "No verified cancellations yet"}
          </small>
        </article>
      </section>

      <section className="subscriptions-section page-width">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your subscriptions</p>
            <h2>{activeSubscriptions.length} active subscriptions</h2>
          </div>
          <div className="section-actions">
            <form action={resetDemoAction}>
              <input name="scenario" type="hidden" value="dark-pattern" />
              <input name="returnTo" type="hidden" value="/" />
              <button className="secondary-button" type="submit">
                Reset StreamMax
              </button>
            </form>
            <button className="secondary-button" disabled type="button">
              + Add subscription
            </button>
          </div>
        </div>

        {demoState.status === "CANCELED" && verifiedSavings === 0 ? (
          <div className="notice-banner" role="status">
            <span aria-hidden="true">i</span>
            <p>
              StreamMax changed inside the demo fixture. It is not counted as
              verified savings because no independent verification job ran.
            </p>
          </div>
        ) : null}

        <div className="subscription-grid">
          {miro && <CancellationCard provider="miro" {...miro} />}
          <CancellationCard
            provider="streammax"
            planName="Premium"
            amountCents={2999}
            currency="USD"
            interval="MONTHLY"
            enabled
          />
          {subscriptions
            .filter((subscription) => subscription.slug !== "streammax")
            .map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                receiptId={
                  subscription.id === streamMax.id
                    ? latestStreamMaxReceipt?.receiptId
                    : undefined
                }
              />
            ))}
        </div>

        <footer className="dashboard-footer">
          <p>
            Demo target: <strong>{streamMax.name}</strong> · scenario:{" "}
            <strong>{demoState.scenario.replaceAll("-", " ")}</strong>
          </p>
          <Link href="/demo">Configure fixture →</Link>
        </footer>
      </section>
    </main>
  )
}
