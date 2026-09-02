import Link from "next/link"

import { resetDemoAction, runSolariBrowserTestAction } from "@/app/actions"
import { Brand } from "@/components/brand"
import { DEMO_SCENARIOS, scenarioDetails } from "@/lib/demo"
import { getDemoState } from "@/lib/db"
import { latestSolariRun, solariReadiness } from "@/lib/solari/runtime"

export const dynamic = "force-dynamic"

function formatDuration(durationMs: number | null): string {
  return durationMs === null ? "—" : `${(durationMs / 1_000).toFixed(1)}s`
}

export default async function DemoLabPage({
  searchParams,
}: {
  searchParams: Promise<{ solari?: string }>
}) {
  const state = getDemoState()
  const readiness = solariReadiness()
  const latestRun = latestSolariRun()
  const { solari } = await searchParams
  const canRun = readiness.apiKeyConfigured && readiness.publicTargetValid

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
