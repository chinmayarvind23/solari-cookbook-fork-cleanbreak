import Link from "next/link"

import {
  resetDemoAction,
  runAgentDryRunAction,
  runSolariBrowserTestAction,
  runVerificationAction,
} from "@/app/actions"
import { AgentRunButton } from "@/components/agent-run-button"
import { ApprovalControls } from "@/components/approval-controls"
import { Brand } from "@/components/brand"
import { agentRuntimeReadiness, latestAgentJob } from "@/lib/agent/runtime"
import { DEMO_SCENARIOS, scenarioDetails } from "@/lib/demo"
import { getDemoState } from "@/lib/db"
import { latestSolariRun, solariReadiness } from "@/lib/solari/runtime"
import { formatCurrency } from "@/lib/subscriptions"
import { createReceiptRepository } from "@/lib/receipts/repository"

export const dynamic = "force-dynamic"

function formatDuration(durationMs: number | null): string {
  return durationMs === null ? "—" : `${(durationMs / 1_000).toFixed(1)}s`
}

export default async function DemoLabPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; solari?: string }>
}) {
  const state = getDemoState()
  const readiness = solariReadiness()
  const latestRun = latestSolariRun()
  const agentReadiness = agentRuntimeReadiness()
  const agentJob = latestAgentJob()
  const { agent, solari } = await searchParams
  const canRun = readiness.apiKeyConfigured && readiness.publicTargetValid
  const receipt = agentJob
    ? createReceiptRepository().getByJobId(agentJob.id)
    : null

  return (
    <main className="lab-shell">
      <header className="lab-nav page-width">
        <Brand fixture />
        <Link className="text-link" href="/">
          ← CleanBreak dashboard
        </Link>
      </header>

      <section className="lab-hero page-width">
        <div>
          <p className="eyebrow">Deterministic target site</p>
          <h1>StreamMax scenario lab</h1>
          <p>
            Reset the fictional subscription to a known state, then navigate the
            cancellation flow manually. The account truth is stored server-side
            so future browser sessions see the same result.
          </p>
        </div>
        <div className="truth-chip">
          <span>Current truth</span>
          <strong>{state.status}</strong>
          <small>Auto-renew {state.autoRenew ? "on" : "off"}</small>
        </div>
      </section>

      <section className="scenario-grid page-width">
        {DEMO_SCENARIOS.map((scenario) => {
          const detail = scenarioDetails[scenario]
          const selected = state.scenario === scenario

          return (
            <article
              className={`scenario-card ${selected ? "selected" : ""}`}
              key={scenario}
            >
              <div className="scenario-topline">
                <span>
                  {String(DEMO_SCENARIOS.indexOf(scenario) + 1).padStart(
                    2,
                    "0",
                  )}
                </span>
                {selected ? <strong>Loaded</strong> : null}
              </div>
              <h2>{detail.label}</h2>
              <p>{detail.description}</p>
              <small>{detail.expected}</small>
              <form action={resetDemoAction}>
                <input name="scenario" type="hidden" value={scenario} />
                <input
                  name="returnTo"
                  type="hidden"
                  value="/demo/streammax/account"
                />
                <button className="lab-button" type="submit">
                  {selected ? "Reset and launch" : "Load scenario"}
                </button>
              </form>
            </article>
          )
        })}
      </section>

      <section className="solari-lab page-width" id="agent-run">
        <div className="solari-lab-heading">
          <div>
            <p className="eyebrow">Autonomous cancellation dry run</p>
            <h2>Navigate safely to the approval boundary</h2>
            <p>
              OpenAI plans one observation-scoped action at a time. A
              deterministic policy checks every action, rejects retention
              offers, and stops before the final cancellation control.
            </p>
          </div>
          <form action={runAgentDryRunAction}>
            <AgentRunButton disabled={!agentReadiness.ready} />
          </form>
        </div>

        <div
          className={`solari-readiness ${agentReadiness.ready ? "ready" : "blocked"}`}
        >
          <strong>
            {agentReadiness.ready ? "Agent ready" : "Configuration needed"}
          </strong>
          <span>{agentReadiness.message}</span>
          <small>Planner model: {agentReadiness.model}</small>
          {agent === "configuration" ? (
            <small>The run did not start. Check server-only settings.</small>
          ) : null}
        </div>

        {agentJob ? (
          <article className="solari-run-card agent-run-card">
            <div className="solari-run-title">
              <div>
                <span>Latest autonomous run</span>
                <strong>{agentJob.state}</strong>
              </div>
              <small>{new Date(agentJob.createdAt).toLocaleString()}</small>
            </div>

            {agentJob.state === "AWAITING_APPROVAL" ? (
              <div className="agent-ready-copy">
                <strong>Ready to cancel</strong>
                <p>
                  CleanBreak reached the final cancellation step and stopped for
                  your approval.
                </p>
                <span>Approval required</span>
              </div>
            ) : null}

            {agentJob.state === "VERIFYING" ? (
              <div className="agent-ready-copy uncertain">
                <strong>
                  Cancellation action attempted — verification required
                </strong>
                <p>
                  CleanBreak will not claim success from the execution session
                  and will not click the destructive control again
                  automatically.
                </p>
              </div>
            ) : null}

            {agentJob.state === "VERIFIED" ? (
              <div className="agent-ready-copy verified">
                <strong>Cancellation verified</strong>
                <p>Auto-renew is off and no future charge was found.</p>
                <span>$359.88/year eliminated</span>
                {receipt ? (
                  <Link href={`/receipts/${receipt.receiptId}`}>
                    View CleanBreak Receipt →
                  </Link>
                ) : (
                  <small>
                    Receipt generation is pending and can be retried.
                  </small>
                )}
              </div>
            ) : null}

            {agentJob.verification?.status === "NOT_VERIFIED" ? (
              <div className="agent-ready-copy aborted">
                <strong>Cancellation could not be verified</strong>
                <p>The account still shows future billing.</p>
              </div>
            ) : null}

            {agentJob.verification?.status === "INCONCLUSIVE" ? (
              <div className="agent-ready-copy uncertain">
                <strong>Cancellation status is unclear</strong>
                <p>CleanBreak could not prove that future billing stopped.</p>
              </div>
            ) : null}

            {agentJob.state === "ABORTED" ? (
              <div className="agent-ready-copy aborted">
                <strong>Cancellation aborted</strong>
                <p>No final cancellation action was executed.</p>
              </div>
            ) : null}

            <dl className="solari-run-facts">
              <div>
                <dt>Steps</dt>
                <dd>{agentJob.steps}</dd>
              </div>
              <div>
                <dt>Model calls</dt>
                <dd>{agentJob.modelCalls}</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>
                  {agentJob.inputTokens} in / {agentJob.outputTokens} out
                </dd>
              </div>
              <div>
                <dt>Retention</dt>
                <dd>
                  {agentJob.retentionsEncountered} seen;{" "}
                  {agentJob.retentionsRejected} rejected
                </dd>
              </div>
              <div>
                <dt>Unsafe actions</dt>
                <dd>{agentJob.unsafeActionsExecuted}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(agentJob.durationMs)}</dd>
              </div>
            </dl>

            {agentJob.proposedAction ? (
              <div className="agent-proposal">
                <span>Exact financial confirmation</span>
                <strong>
                  {agentJob.proposedAction.snapshot.actionText} for{" "}
                  {agentJob.proposedAction.snapshot.serviceName}
                </strong>
                <dl className="approval-facts">
                  <div>
                    <dt>Service</dt>
                    <dd>
                      {agentJob.proposedAction.snapshot.serviceName} (
                      {agentJob.proposedAction.snapshot.serviceDomain})
                    </dd>
                  </div>
                  <div>
                    <dt>Plan</dt>
                    <dd>{agentJob.proposedAction.snapshot.planName}</dd>
                  </div>
                  <div>
                    <dt>Recurring price</dt>
                    <dd>
                      {formatCurrency(
                        agentJob.proposedAction.snapshot.recurringPriceCents /
                          100,
                        agentJob.proposedAction.snapshot.currency,
                      )}{" "}
                      /{" "}
                      {agentJob.proposedAction.snapshot.interval === "MONTHLY"
                        ? "month"
                        : "year"}
                    </dd>
                  </div>
                  <div>
                    <dt>Annual savings</dt>
                    <dd>
                      {formatCurrency(
                        agentJob.proposedAction.snapshot.annualSavingsCents /
                          100,
                        agentJob.proposedAction.snapshot.currency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Current status</dt>
                    <dd>{agentJob.proposedAction.snapshot.currentStatus}</dd>
                  </div>
                  <div>
                    <dt>Cancellation fee</dt>
                    <dd>
                      {agentJob.proposedAction.feeCents === null
                        ? "Unknown — human handling required"
                        : formatCurrency(
                            agentJob.proposedAction.feeCents / 100,
                            agentJob.proposedAction.snapshot.currency,
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>Access until</dt>
                    <dd>
                      {agentJob.proposedAction.accessUntil ?? "Not stated"}
                    </dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>
                      {new Date(
                        agentJob.proposedAction.snapshot.observedAt,
                      ).toLocaleString()}
                    </dd>
                  </div>
                </dl>
                {agentJob.proposedAction.visibleTerms.map((term) => (
                  <p key={term}>{term}</p>
                ))}
                <small>{agentJob.proposedAction.currentUrl}</small>
                {agentJob.state === "AWAITING_APPROVAL" &&
                agentJob.proposedAction.feeCents === 0 ? (
                  <>
                    <p className="approval-warning">
                      Approving authorizes one destructive click in a new
                      recorded browser session. CleanBreak will then report
                      VERIFYING, not success. It will never retry that click
                      automatically.
                    </p>
                    <ApprovalControls
                      jobId={agentJob.id}
                      fingerprint={agentJob.proposedAction.fingerprint}
                    />
                  </>
                ) : agentJob.state === "AWAITING_APPROVAL" ? (
                  <p className="solari-run-error">
                    Approval is unavailable because the cancellation fee is
                    nonzero or unknown. Human handling is required; no override
                    is offered.
                  </p>
                ) : null}
              </div>
            ) : null}

            {agent === "approval-blocked" ? (
              <p className="solari-run-error">
                The approval was rejected safely. Refresh the proposal and
                review its current terms.
              </p>
            ) : null}

            {agentJob.errorMessage ? (
              <p className="solari-run-error">
                {agentJob.errorCode}: {agentJob.errorMessage}
              </p>
            ) : null}

            <ol className="agent-timeline">
              {agentJob.timeline.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>
                      {step.stepNumber}.{" "}
                      {step.targetName ?? step.actionType ?? "Planner error"}
                    </strong>
                    <span>
                      {step.policyResult} · {step.risk ?? "UNKNOWN"} ·{" "}
                      {step.confidence === null
                        ? "no confidence"
                        : `${Math.round(step.confidence * 100)}% confidence`}
                    </span>
                  </div>
                  <p>{step.reasoning ?? step.policyReason}</p>
                  <small>{step.url}</small>
                  {step.screenshotUrl ? (
                    <a href={step.screenshotUrl} target="_blank">
                      Screenshot ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>

            <div className="solari-evidence-links">
              {agentJob.replayUrl ? (
                <a href={agentJob.replayUrl} rel="noreferrer" target="_blank">
                  Open session replay ↗
                </a>
              ) : (
                <span>Replay URL is not available yet.</span>
              )}
            </div>
            {agentJob.commitAttempt ? (
              <div className="commit-evidence">
                <strong>
                  Commit attempt: {agentJob.commitAttempt.outcome}
                </strong>
                <span>
                  Session {agentJob.commitAttempt.sessionId ?? "not created"}
                </span>
                <span>
                  Destructive clicks: {agentJob.destructiveClicksExecuted};
                  automatic retries: {agentJob.automaticDestructiveRetries}
                </span>
                {agentJob.commitAttempt.preScreenshotUrl ? (
                  <a
                    href={agentJob.commitAttempt.preScreenshotUrl}
                    target="_blank"
                  >
                    Pre-click screenshot ↗
                  </a>
                ) : null}
                {agentJob.commitAttempt.postScreenshotUrl ? (
                  <a
                    href={agentJob.commitAttempt.postScreenshotUrl}
                    target="_blank"
                  >
                    Post-click screenshot ↗
                  </a>
                ) : null}
                {agentJob.commitAttempt.replayUrl ? (
                  <a
                    href={agentJob.commitAttempt.replayUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Commit replay ↗
                  </a>
                ) : null}
              </div>
            ) : null}
            {agentJob.state === "VERIFYING" ? (
              <form action={runVerificationAction}>
                <input name="jobId" type="hidden" value={agentJob.id} />
                <button className="primary-button" type="submit">
                  Verify independently
                </button>
              </form>
            ) : null}
            {agentJob.verification ? (
              <div className="commit-evidence verification-evidence">
                <strong>Verified in a fresh Solari session</strong>
                <dl className="approval-facts">
                  <div>
                    <dt>Service</dt>
                    <dd>StreamMax</dd>
                  </div>
                  <div>
                    <dt>Plan</dt>
                    <dd>Premium</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{agentJob.verification.subscriptionStatus}</dd>
                  </div>
                  <div>
                    <dt>Auto-renew</dt>
                    <dd>
                      {agentJob.verification.autoRenew === null
                        ? "Unknown"
                        : agentJob.verification.autoRenew
                          ? "On"
                          : "Off"}
                    </dd>
                  </div>
                  <div>
                    <dt>Next charge</dt>
                    <dd>{agentJob.verification.nextChargeDate ?? "None"}</dd>
                  </div>
                  <div>
                    <dt>Access until</dt>
                    <dd>{agentJob.verification.accessUntil ?? "Not stated"}</dd>
                  </div>
                  <div>
                    <dt>Verified</dt>
                    <dd>
                      {new Date(
                        agentJob.verification.verifiedAt,
                      ).toLocaleString()}
                    </dd>
                  </div>
                </dl>
                <span>
                  Execution session{" "}
                  {agentJob.commitAttempt?.sessionId?.slice(0, 12) ??
                    "not created"}
                  …
                </span>
                <span>
                  Verification session{" "}
                  {agentJob.verification.verificationSessionId.slice(0, 12)}…
                </span>
                {agentJob.verification.screenshotUrl ? (
                  <a href={agentJob.verification.screenshotUrl} target="_blank">
                    Fresh verification screenshot ↗
                  </a>
                ) : null}
                {agentJob.verification.replayUrl ? (
                  <a
                    href={agentJob.verification.replayUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Verification replay ↗
                  </a>
                ) : (
                  <span>
                    Verification replay is unavailable; screenshot evidence
                    remains authoritative.
                  </span>
                )}
              </div>
            ) : null}
            {agentJob.latestScreenshotUrl ? (
              // Guarded local evidence from the latest observed step.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="solari-screenshot"
                alt="Latest page observed by the cancellation agent"
                src={agentJob.latestScreenshotUrl}
              />
            ) : null}
          </article>
        ) : (
          <p className="solari-empty">
            No autonomous dry run has been recorded yet.
          </p>
        )}
      </section>

      <section className="solari-lab page-width" id="solari-run">
        <div className="solari-lab-heading">
          <div>
            <p className="eyebrow">Remote browser evidence</p>
            <h2>Recorded Solari smoke run</h2>
            <p>
              Opens the StreamMax account page through a reusable Solari
              profile. This check only observes the page and takes a screenshot;
              it never clicks a cancellation control.
            </p>
          </div>
          <form action={runSolariBrowserTestAction}>
            <button className="lab-button" disabled={!canRun} type="submit">
              Run browser test
            </button>
          </form>
        </div>

        <div className={`solari-readiness ${canRun ? "ready" : "blocked"}`}>
          <strong>
            {canRun ? "Configuration ready" : "Configuration needed"}
          </strong>
          <span>{readiness.message}</span>
          {readiness.targetHost ? (
            <small>Public target: {readiness.targetHost}</small>
          ) : null}
          {solari === "configuration" ? (
            <small>
              The run did not start. Check the server-only settings.
            </small>
          ) : null}
        </div>

        {latestRun ? (
          <article className="solari-run-card">
            <div className="solari-run-title">
              <div>
                <span>Latest run</span>
                <strong>{latestRun.status}</strong>
              </div>
              <small>{new Date(latestRun.createdAt).toLocaleString()}</small>
            </div>

            {latestRun.status === "SUCCEEDED" ? (
              <p className="solari-connected-copy">
                <strong>Solari browser connected.</strong> StreamMax was opened
                in a real cloud browser. CleanBreak is ready for autonomous
                navigation.
              </p>
            ) : null}

            <dl className="solari-run-facts">
              <div>
                <dt>Session</dt>
                <dd>{latestRun.sessionId ?? "Not created"}</dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>
                  {latestRun.profileId ?? "Not resolved"}
                  {latestRun.profileId
                    ? latestRun.profileCreated
                      ? " (created)"
                      : " (reused)"
                    : null}
                </dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>{new URL(latestRun.targetUrl).hostname}</dd>
              </div>
              <div>
                <dt>Page title</dt>
                <dd>{latestRun.pageTitle ?? "Not observed"}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(latestRun.durationMs)}</dd>
              </div>
              <div>
                <dt>Recording</dt>
                <dd>{latestRun.recordingStatus}</dd>
              </div>
              <div>
                <dt>Cleanup</dt>
                <dd>
                  Browser{" "}
                  {latestRun.browserReleased ? "released" : "not released"};
                  client {latestRun.clientClosed ? "closed" : "not closed"}
                </dd>
              </div>
            </dl>

            {latestRun.errorMessage ? (
              <p className="solari-run-error">
                {latestRun.errorCode}: {latestRun.errorMessage}
              </p>
            ) : null}

            <div className="solari-evidence-links">
              {latestRun.screenshotUrl ? (
                <a href={latestRun.screenshotUrl} target="_blank">
                  Open screenshot evidence ↗
                </a>
              ) : null}
              {latestRun.replayUrl ? (
                <a href={latestRun.replayUrl} rel="noreferrer" target="_blank">
                  Open session replay ↗
                </a>
              ) : (
                <span>Replay URL is not available yet.</span>
              )}
            </div>

            {latestRun.screenshotUrl ? (
              // This is run evidence served from a guarded local route.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="solari-screenshot"
                alt="StreamMax page captured by the latest Solari run"
                src={latestRun.screenshotUrl}
              />
            ) : null}
          </article>
        ) : (
          <p className="solari-empty">No Solari run has been recorded yet.</p>
        )}
      </section>
    </main>
  )
}
