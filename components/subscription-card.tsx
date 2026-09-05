import Link from "next/link"

import {
  annualCost,
  formatCurrency,
  type Subscription,
} from "@/lib/subscriptions"

const serviceMonograms: Record<string, string> = {
  streammax: "S",
  designpro: "D",
  newsplus: "N+",
}

function dateLabel(value?: string): string {
  if (!value) return "No future renewal"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

export function SubscriptionCard({
  subscription,
  receiptId,
}: {
  subscription: Subscription
  receiptId?: string
}) {
  const active = subscription.status === "ACTIVE"
  const isStreamMax = subscription.slug === "streammax"

  return (
    <article className="subscription-card">
      <div className={`service-icon service-icon-${subscription.slug}`}>
        {serviceMonograms[subscription.slug] ?? subscription.name.at(0)}
      </div>

      <div className="subscription-main">
        <div className="subscription-title-row">
          <div>
            <h3>{subscription.name}</h3>
            <p>{subscription.domain}</p>
          </div>
          <span className={`status-pill ${active ? "active" : "canceled"}`}>
            <span aria-hidden="true" />
            {active ? "Active" : "Canceled in fixture"}
          </span>
        </div>

        <div className="subscription-facts">
          <div>
            <span>Recurring cost</span>
            <strong>
              {formatCurrency(subscription.amount, subscription.currency)}
              <small>/mo</small>
            </strong>
          </div>
          <div>
            <span>{active ? "Renews" : "Renewal"}</span>
            <strong>{dateLabel(subscription.nextRenewalDate)}</strong>
          </div>
          <div>
            <span>Annual impact</span>
            <strong className="savings-value">
              {formatCurrency(
                annualCost(subscription.amount, subscription.interval),
                subscription.currency,
              )}
            </strong>
          </div>
        </div>

        {receiptId && !active ? (
          <Link
            className="primary-button card-action"
            href={`/receipts/${receiptId}`}
          >
            View CleanBreak Receipt
            <span aria-hidden="true">→</span>
          </Link>
        ) : isStreamMax ? (
          <Link className="primary-button card-action" href={subscription.url}>
            {active ? "Cancel with CleanBreak" : "Inspect account"}
            <span aria-hidden="true">↗</span>
          </Link>
        ) : null}
      </div>
    </article>
  )
}
