// Build the dashboard from saved jobs and keep real receipt totals separate from samples.
// Build the dashboard from saved jobs and keep real receipt totals separate from samples.
import Link from "next/link"

import { resetDemoAction } from "@/app/actions"
import { Brand } from "@/components/brand"
import { SubscriptionCard } from "@/components/subscription-card"
import { CancellationCard } from "@/components/cancellation-card"
import { miroProductSummary } from "@/lib/cancellations/config"
import { cancellationCardState } from "@/lib/cancellations/card-state"
import { getDemoState, listSubscriptions } from "@/lib/db"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { dashboardMetrics } from "@/lib/cancellations/metrics"
import { publicJob } from "@/lib/cancellations/public"
import { formatCurrency } from "@/lib/subscriptions"

export const dynamic = "force-dynamic"

export default function DashboardPage() {
  const configured = miroProductSummary()
  const jobs = cancellationRepository().dashboardJobs()
  const metrics = dashboardMetrics(jobs, configured)
  const saved = metrics.verified.find(
    (job) =>
      !configured ||
      job.authorization.subscriptionKey === configured.subscriptionKey,
  )
  const miro =
    configured ??
    (saved
      ? {
          planName: saved.authorization.planName,
          amountCents: saved.authorization.expectedAmountCents,
          currency: saved.authorization.currency,
          interval: saved.authorization.interval,
          enabled: false,
        }
      : null)
  const miroCard = miro?.enabled
    ? cancellationCardState("miro")
    : saved
      ? {
          initialJob: publicJob(saved),
          requestScopeKey: saved.authorization.subscriptionKey,
        }
      : undefined
  const fixtureCard = cancellationCardState("streammax")
  const subscriptions = listSubscriptions()
  const demoState = getDemoState()
  const streamMax = subscriptions.find(
    (subscription) => subscription.slug === "streammax",
  )!

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
          <p>Tracked renewal</p>
          <strong>
            {formatCurrency(metrics.potentialCents / 100, metrics.currency)}
          </strong>
          <span>/ year</span>
          <small>
            {metrics.activeCount} configured renewal
            {metrics.activeCount === 1 ? "" : "s"} remaining
          </small>
        </article>
        <article className="metric-card">
          <p>Potential savings</p>
          <strong>
            {formatCurrency(metrics.potentialCents / 100, metrics.currency)}
          </strong>
          <span>/ year</span>
          <small>Uncanceled configured renewal; demo amounts excluded</small>
        </article>
        <article className="metric-card">
          <div className="metric-label-row">
            <p>Verified savings</p>
            <span className="verified-badge">RECEIPT VERIFIED</span>
          </div>
          {metrics.totals.length ? (
            metrics.totals.map((total) => (
              <div key={total.currency}>
                <strong>
                  {formatCurrency(total.annualCents / 100, total.currency)}
                </strong>
                <span> {total.currency} / year</span>
              </div>
            ))
          ) : (
            <>
              <strong>{formatCurrency(0, metrics.currency)}</strong>
              <span>/ year</span>
            </>
          )}
          <small>
            {metrics.verified.length > 0
              ? `${metrics.verified.length} verified cancellation${metrics.verified.length === 1 ? "" : "s"}. Annualized renewal avoided.`
              : "No verified cancellations yet"}
          </small>
        </article>
      </section>

      <section className="subscriptions-section page-width">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your subscriptions</p>
            <h2>Your cancellation workspace</h2>
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

        <div className="subscription-grid">
          {miro && (
            <CancellationCard
              key={miroCard?.requestScopeKey ?? "disabled-miro"}
              provider="miro"
              {...miro}
              {...miroCard}
            />
          )}
        </div>
        <h2>Practice with sample subscriptions</h2>
        <p>
          These fictional amounts are excluded from the real savings totals
          above.
        </p>
        <div className="subscription-grid">
          <CancellationCard
            key={fixtureCard.requestScopeKey}
            provider="streammax"
            planName="Premium"
            amountCents={2999}
            currency="USD"
            interval="MONTHLY"
            enabled
            {...fixtureCard}
          />
          {subscriptions
            .filter(
              (subscription) =>
                !["streammax", "miro"].includes(subscription.slug),
            )
            .map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
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
