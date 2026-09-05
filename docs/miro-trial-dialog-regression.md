# Miro trial benefits dialog regression

The saved run reached Billing, scrolled, dispatched the cancellation entry,
waited for loading, and scrolled the dialog. It stopped before Continue with
`MIRO_AMBIGUOUS_STEP`, with zero destructive actions. The next run began inside
that dialog and correctly stopped with `MIRO_ENTRY_CONTEXT_NOT_ESTABLISHED`:
completed entry history is local to a job, not imported from an expired one.

The existing Continue rule required cancellation wording in the current frame.
Scrolling the benefits list clipped the cancellation heading. The visible
trial-expiry paragraph and Continue/Keep controls remained, but none contained
the required cancellation keyword.

## Narrow provider rule

Miro's [Business trial instructions](https://help.miro.com/hc/en-us/articles/15392587152786-Business-plan-14-day-free-trial)
place the first Continue before separate choice, reason and final submission
steps. This is distinct from the Starter/legacy-trial downgrade route, which
is not authorized by this product. See also the separate
[subscription cancellation instructions](https://help.miro.com/hc/en-us/articles/360011986179-How-to-cancel-your-subscription).

`MIRO_CONTINUE_TRIAL_BENEFITS` recognizes only the Continue button in an
authenticated cancellation dialog at the exact configured Miro Billing URL,
after exactly one completed ENTRY in this job. Confidence must be at least
0.95 and pass the configured threshold. Visible context must establish all
three: Business trial benefits lasting until expiry, account expiry at the end
of the trial period, and the Keep Business Plan alternative. Missing text,
wrong surface, a reused stage or missing entry history still intercepts.
Financial/account-change warnings and final consequences are checked before
this exception. Generic provider rules remain unchanged.

The rule consumes the existing CONTINUE_DIALOG stage and the existing one-use
navigation grant; it is not a final-cancellation dispatcher. Pre-dispatch
pixel/target stability, explicit review mode, bounded planning, and no
unknown-outcome retry remain intact. Planner instructions require visible text,
never a fabricated off-screen heading. Evidence retains an enum marker only.

## Trust-boundary memo

| Read surface                       | Trust                                                       |
| ---------------------------------- | ----------------------------------------------------------- |
| Private saved provider screenshots | Untrusted UI observations, not authorization                |
| Miro help documentation            | External flow reference, not account-specific authorization |
| Current-job completed rules        | Trusted runtime history of acknowledged navigation only     |

| Write surface                          | Blast radius                                        | Reversible?                                     |
| -------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| First documented trial-dialog Continue | Dedicated Miro cancellation funnel position         | Intended yes; custom UI handlers remain a risk  |
| Safe diagnostic marker                 | Existing ignored job evidence                       | Yes                                             |
| Final cancellation                     | No new authority; existing scoped product gate only | Irreversible, outside this navigation exception |

The [existing defense stack](desktop-auto-trust-boundary.md) and
[one-click product authorization](one-click-product.md) still apply. The user's
explicit autonomous one-shot workflow is the scoped exception to the skill's
usual per-navigation review; no broader write authority is inferred. Screenshots
and model interpretations cannot prove target semantics independently.

| Attack                 | Defense                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Visible-text injection | Strict target/role/surface/history/signature checks, final and financial guards           |
| URL/query injection    | Exact configured Billing URL; queries, fragments, credentials and other accounts rejected |
| Memory binding         | No cross-job planner memory or imported completed-flow history                            |
| CSRF-shaped write      | Scoped dedicated session, no arbitrary form submission, one-use action grant              |
| One-click hijack       | Fresh padded target stability; no reuse or retry of uncertain input                       |

Deployment verdict: **research-only**. Synthetic tests reproduce the visible
clipped-heading text and then exercise modeled later choice/reason/final stages.
They prove policy/dispatch behavior, not the current live later screens or a
completed real cancellation. No live Miro input was executed while implementing
this patch. A new attempt must begin at Billing, not inside the failed dialog,
and requires fresh authorization. No benchmark score is a success claim.
