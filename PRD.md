# CleanBreak product requirements

Status: current product contract. Implemented behavior and measured evidence are
tracked in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). Earlier milestone
plans and superseded two-approval UX are retained in Git history, not as current
requirements.

## Product promise

A user authorizes cancellation of a specific subscription. CleanBreak navigates
the provider, attempts the final action at most once, independently checks future
billing and produces a receipt only when the outcome is verified.

**Execution is not proof.** A click acknowledgement, success toast, model claim or
recording does not establish that future renewal stopped.

## Scope

The current product serves one operator using an account they own or control.

- A configured Miro Business Trial in a dedicated authenticated Solari Desktop.
- A fictional StreamMax provider for repeatable local tests and Browser regressions.
- Server-side authorization, durable jobs, guarded execution, independent
  verification, receipts and private recordings.
- Manual subscription information and provider authentication; no credential
  automation is required to demonstrate cancellation.

Out of scope: subscription discovery, bank/email integrations, refunds,
negotiation, downgrades, extensions, purchases, payment/security changes, account
deletion, CAPTCHA/MFA bypass, multi-tenant operation and universal provider support.
Adding an arbitrary subscription to the dashboard does not add a cancellation adapter.

## User journey

1. The user manually authenticates the dedicated provider session.
2. CleanBreak displays provider, plan, renewal amount, currency and interval,
   together with the one-attempt authorization and preserved-access policy.
3. The user clicks **Cancel subscription** once. The server creates an immutable,
   expiring authorization from trusted configuration, not client-supplied terms.
4. Navigation follows recognized reversible steps and rejects retention offers.
5. A separate commit gate revalidates identity, material terms and final target.
6. The durable authorization claim permits at most one final dispatch.
7. Independent verification checks the provider's current billing state.
8. The dashboard shows a terminal result, with a receipt only for VERIFIED.

No second approval is required in the primary product path. Dry-runs remain
non-destructive and never acquire final-click authority. The older Browser/demo
approval screen is a separate regression workflow.

## Authorization and execution invariants

- Scope includes provider/account binding, plan, amount/currency/interval,
  dedicated session binding, preserved-access policy and a 15-minute expiry.
- A changed provider, subscription or financial term cannot reuse old authority.
- The navigator cannot execute final cancellation. Only the separate one-use gate
  may dispatch it after fresh revalidation.
- Unexpected fees, new charges, immediate access loss, unrelated changes,
  ambiguous controls and unknown authentication stop the job.
- The claim is persisted before dispatch. Uncertain delivery consumes authority;
  neither process recovery nor a new request key permits an automatic retry.
- Concurrent/idempotent requests cannot create duplicate destructive actions.
- Opening the dashboard does not authorize work or create a replacement job.

## State and recovery

The canonical state/transition definitions live in
[lib/cancellations/state.ts](lib/cancellations/state.ts):

```text
AUTHORIZED → CONNECTING → NAVIGATING → CANCELLATION_FLOW
  → COMMIT_ARMED → COMMITTING → VERIFYING
  → VERIFIED | NOT_VERIFIED | INCONCLUSIVE
```

Failed guards before dispatch lead to FAILED. Recovery from a possibly dispatched
action proceeds only toward verification, never back to another click.
An eligible unclaimed navigation failure may receive a fresh explicit
authorization; the old job remains intact. Consumed/uncertain locks are not reset
to make another attempt possible. Exact rules: [security](docs/security.md).

## Verification and receipts

| Result       | Required interpretation                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VERIFIED     | Fresh matching authenticated billing evidence establishes canceled/scheduled status, renewal off and no next renewal charge; scheduled cancellation has an access-through date |
| NOT_VERIFIED | Matching account remains active with renewal on and a definite next charge/date                                                                                                |
| INCONCLUSIVE | Missing, conflicting, unauthenticated, mismatched or uncertain evidence                                                                                                        |
| FAILED       | The workflow could not complete its required guarded steps                                                                                                                     |

A product success receipt additionally requires one acknowledged final click and
one authorization use. A read-only observation that an account is already canceled
does not prove CleanBreak executed its cancellation.

Miro verification uses a new page/control observation plus reload in the same
authenticated Chrome profile and agreeing account-bound billing GET responses.
It does not claim a separate authenticated browser process. The local StreamMax
test uses a separate verification browser.

Receipts contain safe authorization and before/after facts, evidence hashes,
provenance, counters and recurring-charge calculations. Canonical SHA-256 is a
tamper-evident digest against a retained copy, not a provider signature. Recording
availability is independent of billing success and cannot authorize a retry.

## Privacy and lifecycle

- Screenshot-model uploads default off. The Miro product uses local deterministic
  DOM extraction; it does not replace images with private OCR/text sent to a model.
- Local screenshots may protect target stability. Recordings and evidence stay
  in ignored private storage with authenticated download routes.
- No passwords, API keys, cookies, storage state, card details or capability URLs
  in logs, source, public artifacts or browser bundles.
- Profile attachment and profile persistence are separate permissions.
  Unauthenticated/challenge state must not overwrite working credentials.
- Authentication refresh is explicit, positively checked and in-memory.
- Normal Desktop cleanup closes owned handles, not the shared VM. The operator
  controls pause; automatic VM destruction is not a recovery strategy.

## UI and persistence

The dashboard derives status from the durable server job. It distinguishes live
authorization, dry-run navigation, failed attempts, verification and verified
outcomes. Keep original history visible; never erase uncertainty to show a fresh
Cancel button.

Current product routes are defined under [app/api/cancellations](app/api/cancellations)
and the receipt page under [app/cancellations](app/cancellations).
SQLite owns authorizations/jobs/receipts; private files hold screenshots/recordings.
Use a single application instance with persistent database and artifact storage.
Authentication profiles are not job databases.

## Business measurements

Report only measured values, clearly distinguishing live-provider, fixture and
synthetic results.

- Verified annualized renewal charges avoided, counted once per subscription.
  Monthly amount × 12; yearly amount unchanged. This is not cash recovered.
- Time from user authorization to terminal result, including failures; recording
  length or synthetic benchmark timing is not the same measurement.
- Required user interventions and manual follow-up, measured against an explicit
  baseline before claiming a percentage reduction.
- Verified completion rate with a defined denominator; do not hide failed attempts.
- Duplicate/unauthorized actions, false success claims and uncertain outcomes.

Demo balances are fictional. Forecasts, hypothetical outcomes, pilot-user counts
and unmeasured cost/time improvements must not appear as achieved results.

## Acceptance criteria

- The documented local test reaches a valid receipt without provider keys.
- Real execution uses the configured Solari Desktop, never a simulated substitute.
- The initial authorization, final revalidation and one-use dispatch are enforced
  server-side, including concurrency and crash recovery.
- Verification can reject active, missing and conflicting billing evidence.
- Failed/uncertain jobs receive no success receipt and no automatic final retry.
- Authentication survives normal handle cleanup; profile overwrite protections hold.
- No sensitive data appears in logs/client bundles; private recording copies are
  reviewed/redacted before sharing.
- Tests, typecheck, formatting, build and secret audit pass; measured claims point
  to real evidence. Documentation describes the current implementation honestly.
