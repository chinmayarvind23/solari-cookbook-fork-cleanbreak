import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { confirmDemoCancellationAction, resetDemoAction } from "@/app/actions"
import { firstCancellationScreen, scenarioDetails } from "@/lib/demo"
import { getDemoState, getStreamMaxSubscription } from "@/lib/db"
import { formatCurrency } from "@/lib/subscriptions"

export const dynamic = "force-dynamic"

const validScreens = new Set([
  "account",
  "billing",
  "manage",
  "cancel",
  "pause-offer",
  "discount-offer",
  "reason",
  "terms",
  "result",
])

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

function FixtureButton({
  href,
  children,
  tone = "primary",
}: {
  href: string
  children: ReactNode
  tone?: "primary" | "quiet" | "danger"
}) {
  return (
    <Link className={`stream-button stream-button-${tone}`} href={href}>
      {children}
    </Link>
  )
}

function SettingsRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail?: string
  tone?: "good" | "warning"
}) {
  return (
    <div className="settings-row">
      <div>
        <span>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </div>
      <strong className={tone ? `text-${tone}` : ""}>{value}</strong>
    </div>
  )
}

function AccountScreen() {
  const state = getDemoState()

  return (
    <div className="stream-panel">
      <div className="stream-panel-heading">
        <div>
          <p className="stream-kicker">Account overview</p>
          <h1>Welcome back, Casey</h1>
        </div>
        <span
          className={`stream-status ${state.status === "CANCELED" ? "off" : ""}`}
        >
          {state.status === "CANCELED"
            ? "Membership canceled"
            : "Premium active"}
        </span>
      </div>

      {state.lastMessage ? (
        <div
          className={`provider-message ${state.status === "ACTIVE" ? "ambiguous" : "success"}`}
          role="status"
        >
          <strong>{state.lastMessage}</strong>
          <p>
            {state.status === "ACTIVE"
              ? "We’ll email you when an account specialist reviews it."
              : `Keep watching until ${formatDate(state.accessUntil)}.`}
          </p>
        </div>
      ) : null}

      <div className="account-plan-card">
        <div className="plan-art" aria-hidden="true">
          <span>SM</span>
        </div>
        <div>
          <span>Your plan</span>
          <h2>StreamMax Premium</h2>
          <p>4K streaming · 4 screens · downloads</p>
        </div>
        <strong>
          $29.99 <small>/ month</small>
        </strong>
      </div>

      <div className="stream-section-heading">
        <h2>Account settings</h2>
        <p>Manage how you watch and pay.</p>
      </div>
      <div className="account-nav-list">
        <Link href="/demo/streammax/billing">
          <span className="account-nav-icon" aria-hidden="true">
            $
          </span>
          <span>
            <strong>Billing</strong>
            <small>Payment method, invoices, and membership</small>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
        <div>
          <span className="account-nav-icon" aria-hidden="true">
            ◉
          </span>
          <span>
            <strong>Playback</strong>
            <small>Quality and device preferences</small>
          </span>
          <span aria-hidden="true">›</span>
        </div>
        <div>
          <span className="account-nav-icon" aria-hidden="true">
            ⌁
          </span>
          <span>
            <strong>Profiles</strong>
            <small>Household members and controls</small>
          </span>
          <span aria-hidden="true">›</span>
        </div>
      </div>
    </div>
  )
}

function BillingScreen() {
  const state = getDemoState()

  return (
    <div className="stream-panel compact-panel">
      <Link className="stream-back" href="/demo/streammax/account">
        ← Account
      </Link>
      <p className="stream-kicker">Billing</p>
      <h1>Billing &amp; membership</h1>
      <div className="settings-table">
        <SettingsRow label="Plan" value="Premium" detail="4K + HDR" />
        <SettingsRow label="Price" value="$29.99 / month" />
        <SettingsRow
          label="Membership"
          value={state.status === "CANCELED" ? "Canceled" : "Active"}
          tone={state.status === "CANCELED" ? "warning" : "good"}
        />
        <SettingsRow
          label="Auto-renew"
          value={state.autoRenew ? "On" : "Off"}
          tone={state.autoRenew ? undefined : "warning"}
        />
        <SettingsRow
          label="Next charge"
          value={
            state.nextChargeDate ? formatDate(state.nextChargeDate) : "None"
          }
        />
      </div>
      {state.status === "ACTIVE" ? (
        <FixtureButton href="/demo/streammax/manage">
          Manage subscription
        </FixtureButton>
      ) : (
        <div className="ended-access-note">
          <strong>No future charge scheduled</strong>
          <p>
            Your access remains available until {formatDate(state.accessUntil)}.
          </p>
        </div>
      )}
    </div>
  )
}

function ManageScreen() {
  const state = getDemoState()

  if (state.status === "CANCELED") return <AccountScreen />

  return (
    <div className="stream-panel compact-panel">
      <Link className="stream-back" href="/demo/streammax/billing">
        ← Billing
      </Link>
      <p className="stream-kicker">Membership</p>
      <h1>Manage your subscription</h1>
      <div className="manage-plan">
        <div>
          <span>Current plan</span>
          <strong>Premium</strong>
        </div>
        <div>
          <span>Monthly total</span>
          <strong>$29.99</strong>
        </div>
      </div>
      <div className="manage-options">
        <button type="button" disabled>
          Change plan <span>›</span>
        </button>
        <button type="button" disabled>
          Update payment method <span>›</span>
        </button>
      </div>
      <div className="danger-zone">
        <div>
          <h2>Cancel membership</h2>
          <p>Stop renewal and keep access through your paid period.</p>
        </div>
        <FixtureButton href="/demo/streammax/cancel" tone="danger">
          Start cancellation
        </FixtureButton>
      </div>
    </div>
  )
}

function CancelStartScreen() {
  const state = getDemoState()
  const next = firstCancellationScreen(state.scenario)

  return (
    <div className="stream-panel decision-panel">
      <div className="decision-icon muted" aria-hidden="true">
        ?
      </div>
      <p className="stream-kicker">Before you go</p>
      <h1>End your Premium membership?</h1>
      <p className="decision-copy">
        You’ll keep full access through {formatDate(state.accessUntil)}. After
        that, your profiles and watchlist will stay here if you return.
      </p>
      <div className="decision-actions">
        <FixtureButton href="/demo/streammax/manage" tone="primary">
          Keep my membership
        </FixtureButton>
        <FixtureButton href={`/demo/streammax/${next}`} tone="quiet">
          Continue cancellation
        </FixtureButton>
      </div>
    </div>
  )
}

function PauseOfferScreen() {
  return (
    <div className="stream-panel offer-panel">
      <span className="offer-tag">A better option</span>
      <div className="offer-art pause-art" aria-hidden="true">
        Ⅱ
      </div>
      <h1>Pause instead?</h1>
      <p>
        Take a 30-day break. You won’t be charged while paused, and everything
        will be waiting when you come back.
      </p>
      <strong className="offer-price">$0 today</strong>
      <div className="decision-actions">
        <FixtureButton href="/demo/streammax/manage">
          Pause membership
        </FixtureButton>
        <FixtureButton href="/demo/streammax/discount-offer" tone="quiet">
          No thanks, continue cancellation
        </FixtureButton>
      </div>
    </div>
  )
}

function DiscountOfferScreen() {
  return (
    <div className="stream-panel offer-panel discount-panel">
      <span className="offer-tag">One-time offer</span>
      <p className="discount-number">30% off</p>
      <h1>Stay for less.</h1>
      <p>
        Keep every Premium benefit and pay just $20.99 a month for the next
        three months.
      </p>
      <div className="offer-comparison">
        <span>$29.99</span>
        <strong>$20.99 / month</strong>
      </div>
      <div className="decision-actions">
        <FixtureButton href="/demo/streammax/manage">
          Claim 30% off
        </FixtureButton>
        <FixtureButton href="/demo/streammax/reason" tone="quiet">
          Reject offer and continue
        </FixtureButton>
      </div>
    </div>
  )
}

function ReasonScreen() {
  return (
    <div className="stream-panel compact-panel">
      <p className="stream-kicker">Help us improve</p>
      <h1>Why are you leaving?</h1>
      <p className="decision-copy left-copy">Choose the closest reason.</p>
      <form className="reason-form" action="/demo/streammax/terms" method="get">
        {[
          "It costs too much",
          "I don’t use it enough",
          "I’m switching to another service",
          "Technical issues",
          "Other",
        ].map((reason, index) => (
          <label key={reason}>
            <input
              defaultChecked={index === 1}
              name="reason"
              type="radio"
              value={reason}
            />
            <span>{reason}</span>
          </label>
        ))}
        <button className="stream-button stream-button-primary" type="submit">
          Continue cancellation
        </button>
      </form>
    </div>
  )
}

function TermsScreen() {
  const state = getDemoState()
  const hasFee = state.scenario === "cancellation-fee"

  if (state.status === "CANCELED") {
    return (
      <div className="stream-panel decision-panel">
        <div className="decision-icon success" aria-hidden="true">
          ✓
        </div>
        <h1>Membership already canceled</h1>
        <p className="decision-copy">
          Auto-renew is off. No additional cancellation action is available.
        </p>
        <FixtureButton href="/demo/streammax/billing">
          View billing status
        </FixtureButton>
      </div>
    )
  }

  return (
    <div className="stream-panel compact-panel">
      <p className="stream-kicker">Final step</p>
      <h1>Confirm cancellation</h1>
      <p className="decision-copy left-copy">
        Review exactly what happens before ending your StreamMax membership.
      </p>

      {hasFee ? (
        <div className="fee-alert" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>Early cancellation fee: $45.00</strong>
            <p>This non-refundable fee will be charged immediately.</p>
          </div>
        </div>
      ) : null}

      <div className="terms-list">
        <SettingsRow label="Current plan" value="Premium" />
        <SettingsRow label="Current price" value="$29.99 / month" />
        <SettingsRow label="Auto-renewal" value="Will be disabled" />
        <SettingsRow
          label="Access until"
          value={formatDate(state.accessUntil)}
        />
        <SettingsRow
          label="Cancellation fee"
          value={hasFee ? "$45.00" : "None"}
          tone={hasFee ? "warning" : "good"}
        />
      </div>

      <form action={confirmDemoCancellationAction}>
        <button
          className="stream-button stream-button-danger full-button"
          type="submit"
        >
          Confirm cancellation
        </button>
      </form>
      <Link className="centered-link" href="/demo/streammax/manage">
        Never mind, keep my membership
      </Link>
    </div>
  )
}

function ResultScreen() {
  const state = getDemoState()
  const ambiguous = state.status === "ACTIVE"

  return (
    <div className="stream-panel decision-panel">
      <div
        className={`decision-icon ${ambiguous ? "muted" : "success"}`}
        aria-hidden="true"
      >
        {ambiguous ? "…" : "✓"}
      </div>
      <p className="stream-kicker">Request update</p>
      <h1>{state.lastMessage ?? "No cancellation submitted"}</h1>
      <p className="decision-copy">
        {ambiguous
          ? "Your account still shows Premium active and auto-renew on."
          : `Auto-renew is off. You can keep watching until ${formatDate(state.accessUntil)}.`}
      </p>
      <div className="result-facts">
        <SettingsRow
          label="Membership"
          value={state.status === "ACTIVE" ? "Active" : "Canceled"}
        />
        <SettingsRow
          label="Auto-renew"
          value={state.autoRenew ? "On" : "Off"}
        />
        <SettingsRow
          label="Next charge"
          value={
            state.nextChargeDate ? formatDate(state.nextChargeDate) : "None"
          }
        />
      </div>
      <FixtureButton href="/demo/streammax/account">
        Return to account
      </FixtureButton>
    </div>
  )
}

const screens: Record<string, () => ReactNode> = {
  account: AccountScreen,
  billing: BillingScreen,
  manage: ManageScreen,
  cancel: CancelStartScreen,
  "pause-offer": PauseOfferScreen,
  "discount-offer": DiscountOfferScreen,
  reason: ReasonScreen,
  terms: TermsScreen,
  result: ResultScreen,
}

export default async function StreamMaxPage({
  params,
}: {
  params: Promise<{ screen?: string[] }>
}) {
  const { screen: segments } = await params
  const screen = segments?.join("/") ?? "account"
  if (!validScreens.has(screen)) notFound()

  const state = getDemoState()
  const subscription = getStreamMaxSubscription()
  const Screen = screens[screen]

  return (
    <main className="fixture-page">
      <div className="fixture-control-bar">
        <div>
          <Link href="/demo">← Scenario lab</Link>
          <span aria-hidden="true">/</span>
          <strong>{scenarioDetails[state.scenario].label}</strong>
        </div>
        <form action={resetDemoAction}>
          <input name="scenario" type="hidden" value={state.scenario} />
          <input
            name="returnTo"
            type="hidden"
            value="/demo/streammax/account"
          />
          <button type="submit">Reset fixture</button>
        </form>
      </div>

      <section className="streammax-shell">
        <header className="streammax-nav">
          <Link className="streammax-brand" href="/demo/streammax/account">
            <span aria-hidden="true">▶</span>
            STREAMMAX
          </Link>
          <nav aria-label="StreamMax navigation">
            <span>Browse</span>
            <span>Movies</span>
            <span>Series</span>
            <Link href="/demo/streammax/account" aria-label="Account">
              C
            </Link>
          </nav>
        </header>
        <div className="stream-content">{Screen()}</div>
        <footer className="stream-footer">
          <span>StreamMax is a fictional deterministic demo service.</span>
          <span>
            {formatCurrency(subscription.amount)} / month ·{" "}
            {state.scenario.replaceAll("-", " ")}
          </span>
        </footer>
      </section>
    </main>
  )
}
