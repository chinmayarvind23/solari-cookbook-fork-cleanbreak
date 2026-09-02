import Link from "next/link"

import { resetDemoAction } from "@/app/actions"
import { Brand } from "@/components/brand"
import { DEMO_SCENARIOS, scenarioDetails } from "@/lib/demo"
import { getDemoState } from "@/lib/db"

export const dynamic = "force-dynamic"

export default function DemoLabPage() {
  const state = getDemoState()

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
    </main>
  )
}
