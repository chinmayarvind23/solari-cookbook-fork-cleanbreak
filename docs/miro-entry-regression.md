# Miro Desktop entry regression

The adapter compares the configured and observed billing account path with one
optional trailing slash normalized. It still rejects different accounts, origins,
credentials, query strings, fragments and missing/truncated URLs.

`miroObservation.targetContext` is required (nullable when unknown). It describes
the targeted control and its immediate section or entire active dialog, excluding
unrelated page-header/sidebar controls. Financial/account-change terms in that
context block navigation. Cancellation consequences in **either** page context or
target context still intercept. A null/empty target context fails closed.

The first standalone Billing entry remains limited to exact Cancel subscription
or Cancel trial, authenticated Miro, correct account page, confidence/coordinates,
Billing/Licensing context, no modal and no previous cancellation navigation.
This is not a generic relaxation or permission to reuse a cancel button later.

Source: [Miro trial cancellation](https://help.miro.com/hc/en-us/articles/15392587152786-Business-plan-14-day-free-trial)
documents Licensing configuration → Cancel trial → Continue before later choices
and the final cancellation. The distinct Starter/legacy downgrade flow is not
authorized by this adapter.

Safe `adapterDiagnostic` metadata and `Miro policy: MIRO_...` terminal messages
identify rejected URL, observation, missing context, financial/account context,
consequence, repeated entry or ambiguous steps. No raw URL/target context is saved
in structured evidence; existing private screenshot evidence remains unchanged.

## Test it

Offline regression suite: `npx vitest run tests/desktop.test.ts`.
Full suite: `npm test`. The new runtime regression supplies synthetic observations
matching the billing layout, dispatches reversible navigation through the actual
policy and stability gate, and checks later final interception, zero destructive
actions/retries and no automatic VM pause. It is not a live-provider success claim.

For your dedicated authenticated VM, with Billing visible:

```powershell
$env:CLEANBREAK_DRY_RUN = "true"
$env:CLEANBREAK_REAL_PROVIDER_AUTHORIZED = "true"
$env:CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL = "false"
npm run real-provider:desktop-dry-run -- --auto
```

Success requires a non-null validation path, `finalBoundaryEstablished: true`,
`AWAITING_APPROVAL`, `FINAL_ACTION_BOUNDARY`, zero destructive/unsafe/retry counters
and `controlClosed: true`. `paused: false` is expected. This validates navigation
to the boundary, not actual cancellation. Do not enable destructive execution to
get around an ambiguous stop.

## Trust-boundary memo

| Read surface                                         | Trust                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Configured miro.com billing screen and dialogs       | Third-party, untrusted screenshot content                  |
| help.miro.com documentation                          | Third-party reference, not execution permission            |
| Local explicit config and completed dispatch history | Trusted scope/state, never inferred from page instructions |

| Write surface                                        | Blast radius / reversibility                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Allowlisted cancellation navigation                  | Dedicated subscription's reversible flow; wrong target could affect the account |
| Private local evidence                               | Ignored screenshots and redacted structured trace, deletable                    |
| Final cancellation, payment, offers, account changes | Not authorized in this dry-run                                                  |

Defenses: screenshot content is data, not instructions; strict structured fields;
redacted output; exact provider/account scope; target policy; one-use navigation
grants; fresh screenshot stability including click-target checks; no destructive
dispatcher or retries; bounded run. Supervised mode retains per-step human review.
The user's explicitly requested `--auto` research mode waives per-navigation
review, not final-action interception. Screenshot-derived target context remains
a fallible model observation, not independent DOM attestation.

| Attack                   | Defense                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Visible-text injection   | Untrusted-content planner instruction plus deterministic scope/action gates         |
| Query/fragment injection | Observed URL query/fragment rejected                                                |
| Memory binding           | No new persistent planner memory; completed steps from local dispatch evidence only |
| CSRF-shaped action       | No arbitrary URL, shell or form-submit dispatcher; scope and action allowlists      |
| One-click hijack         | Fresh target-region stability; final cancellation intercepted                       |

Verdict: research-only safe dry-run, not certified production cancellation.
Offline synthetic observations do not prove the changing live Miro flow works;
no benchmark score is used as evidence of live reliability.
