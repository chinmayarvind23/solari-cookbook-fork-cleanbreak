# One-click cancellation: operator guide and trust boundary

The primary dashboard uses an initial, scoped Cancel authorization. There is no
second approval. The existing Browser/StreamMax demo lab, approval flow, benchmark
and safe Desktop dry-run remain available. Real execution is **off by default**.
This is a single-operator, persistent Node/SQLite deployment, not a multi-tenant
or ephemeral/serverless service. Miro execution is offline-tested, not live-proven.

**To test the entire transaction, including the irreversible click:** use
`npm run test:one-click` for the local StreamMax fixture, or explicitly enable
live mode and use the Miro dashboard button / `real-provider:desktop-live` as
documented below. `real-provider:desktop-dry-run -- --auto` intentionally cannot
submit the final click, verify a cancellation, or issue a cancellation receipt.
`--auto` removes navigation prompts; it does not turn a dry-run into live execution.
Enabling live mode does not override ambiguous targets or changed financial terms.

## State and durable authorization

```text
AUTHORIZED → CONNECTING → NAVIGATING → CANCELLATION_FLOW
    → COMMIT_ARMED → COMMITTING → VERIFYING
    → VERIFIED | NOT_VERIFIED | INCONCLUSIVE
Before claim: any failed guard → FAILED
```

The TypeScript `Job` schema in `lib/cancellations/state.ts` documents full state.
`edges` defines allowed transitions; SQLite stores a full checkpoint at every
transition, including failure, with captured timestamps/version. Linear graph
nodes are navigation, pre-commit revalidation, atomic claim, dispatch, verification
and receipt; there are no swarm or delegated actors. This adapts the state-graph
skill to the existing TypeScript runtime instead of adding a Python graph stack.

Authorization payload (immutable SQLite trigger): id, intent, provider/origin,
hashed subscription/account binding, hashed dedicated session binding, plan name,
expected amount/currency/interval, preserved-prepaid-access policy, authorizedAt,
15-minute expiresAt, maxDestructiveActions=1. Status and use count are separate
mutable columns, atomically changed on claim. A changed environment/session/plan
does not transfer an existing authorization to that new scope.

POST requires operator authentication in live mode, exact same-origin JSON, a
bounded strict provider-only body and an Idempotency-Key. Caller-supplied prices,
account IDs, target coordinates, grants or action counts are never accepted.
Unique indexes serialize active requests by subscription AND Desktop resource.
Browser reload stores only non-secret request/job IDs and polls the same job.

Workers acquire a 120-second lease, refreshed every 20 seconds. A versioned CAS
and `BEGIN IMMEDIATE` protect every checkpoint and the authorization claim across
workers. COMMIT_ARMED persists the fresh action fingerprint/evidence before the
one-shot claim. Claim atomically consumes authorization, sets attempted=1 and
COMMITTING. The dedicated dispatcher invokes exactly one callback, never retries.
Executed=1 means the SDK acknowledged the click; a lost response never invents it.
The gate also mints an immutable, one-use in-memory grant bound to the job and
exact observation. Neither a raw decision, a copied grant nor direct driver call
can reach a destructive mouse input.

Recovery from COMMIT_ARMED reconnects and revalidates, never replays stale pixels.
Recovery from COMMITTING only verifies (or returns INCONCLUSIVE). Interrupted
navigation fails rather than retrying an unknown-outcome navigation click.
Consumed subscriptions/Desktops remain locked even after terminal outcomes;
another POST returns the existing job. Do not remove that lock to retry an
uncertain real cancellation. A new attempt needs operator reconciliation and a
new scoped authorization, not automatic recovery. Unclaimed failures release the
resource lock, but the original request key remains idempotent. Explicit
StreamMax reset releases only terminal fixture locks; use a fresh browser storage
ticket for a new fixture test, or use the isolated smoke command below.

## Pre-commit and verification contracts

The navigation loop still cannot execute final candidates. Product navigation
calls the same Miro adapter without a viewer/terminal, preserving origin/auth
policy, bounded planning, target-aware pixel stability and zero action retries.

Fresh structured extraction checks the visible full configured account Billing
URL, exact plan/currency/interval, unique final target, coordinates/dimensions,
confidence ≥0.95, explicit no fee/no new charge, prepaid access preservation,
and no unrelated change. Before-state charge must equal the authorized amount.
Missing/truncated URLs or missing terms fail closed; nothing is inferred merely
from a familiar button label. A second fresh extraction and padded target pixel
comparison must agree, then a canonical SHA-256 fingerprint binds the authority,
scope, target, terms, timestamp/version and screenshot hash. Immediately before
the click there is another target-stability check. Screen changes spend no click
and never trigger an action retry (a previously claimed grant remains consumed).

The Miro extractor uses the repo's Zod/strict JSON contract, not free-text model
reasoning or a new Python runtime. All fields are required; nested objects reject
additional properties. Typed refusal categories: safety, input_mismatch,
insufficient_info. Refusal/parse failure is final. Only transient read errors may
retry twice; no automatic model escalation, action retry, or arbitrary tool use.
Ten-plus extraction vectors cover happy path, scope mismatches, missing fields,
query injection and refusal. Planning has its existing 20,000-token ceiling;
additional extraction has a shared 10,000 reported-token ceiling and SDK timeouts.

After control closure, verification reconnects a separate SDK handle and opens a
new Chrome window at configured Billing using the same authenticated VM profile.
Chrome may reuse its process; **this is not a separate authenticated identity or
independently attested browser process**. The verifier has no input dispatcher:
it reads two screenshots and requires agreeing billing fields. Its extraction
requests contain no planner history, commit result or expected billing answer.
The service, not the executor, computes the result. Context IDs/timestamps must
be fresh and the verification screenshot must differ from the pre-commit image.

- VERIFIED: authenticated matching Billing page; canceled or scheduled; renewal
  off; explicitly no next charge, amount or date; scheduled cancellation requires
  an access-through date. Exactly one acknowledged click and one authorization
  use are also required for the receipt. For a configured $240 yearly plan, the
  prior $240 charge must have been established and future renewal must now be off.
- NOT_VERIFIED: matching active plan, renewal on and a definite future charge/date.
- INCONCLUSIVE: login/challenge, missing/contradictory fields, unknown click,
  mismatched identity/plan, ambiguous terms or timeout. Never retry cancellation.

Only VERIFIED gets a receipt. Existing canonical JSON/SHA-256 machinery is reused
for safe authorization, navigation, before/after evidence, fingerprint, provenance,
counters and defensible avoided-charge totals. Savings are projected recurring
charges avoided, not cash recovered. The digest is tamper-evident against a held
copy, not a signed provider attestation. Receipt routes validate it on read.
Screenshot artifacts remain private under ignored `artifacts/cancellations/`.
Build sanitization removes only generated standalone copies of environment files,
developer state, evidence and databases. Supply runtime environment/volumes after
deployment; source `.env` and local state are not changed.
Full observed URLs, account email/card details and model reasoning are discarded.

## Trust-boundary memo

Deployment verdict: **research-only for Miro**, local fixture regression proven.
The user explicitly replaced final-step HITL with initial scoped authorization.
That is the only override of the trust-boundary skill; changed terms receive no
new authority. Dedicated, narrowly scoped provider identity/VM is required.

| Read surface                                                   | Trust                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Operator dashboard / configured loopback StreamMax             | First-party; validate HTTP input                                        |
| Configured Miro Billing origin; any displayed external content | Untrusted, including labels and screenshot address bars                 |
| Configured Solari gateway and SDK controls                     | Credential-bearing infrastructure; never expose capabilities            |
| Configured OpenAI extraction endpoint                          | Authorized screenshot processor; model output remains untrusted         |
| SQLite checkpoints                                             | Local authority; never replay raw provider text as planner instructions |

| Write surface                                                         | Blast radius                                                                 | Reversible                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------- |
| Navigation/reason selection                                           | Dedicated provider session                                                   | Intended yes, still guarded |
| One cancellation click                                                | Exactly the authorized account subscription; loss/charges if UI is deceptive | No                          |
| Authorization/checkpoints/receipt                                     | Local persistent SQLite                                                      | Audit records retained      |
| Private screenshots/recording, window open and local connection close | Dedicated VM and local ignored evidence                                      | Yes; VM remains running     |

Defense stack: Basic operator authentication (username `cleanbreak`, ≥24-character
secret), HTTPS except loopback, exact Origin/Host JSON CSRF checks, strict schemas,
enum-only extraction persistence, scoped session, deterministic allowlists,
one-shot atomic claim, immutable authority, independent verification, fail-closed
terms checks and retained consumed-job locks. No exported storage state. No
cross-run agent memory exists, so memory canaries are not applicable; adding
replayed untrusted memory needs a separate review.

| Attack                       | Defense / residual risk                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Visible injection            | Untrusted-screen instruction, strict schema, exact scope/terms gate; model misinterpretation still possible |
| URL query/fragment injection | Exact configured URL match; queries/fragments unsupported                                                   |
| Memory binding               | No persistent planner memory or raw-text replay                                                             |
| CSRF-shaped action           | Operator authentication, same-origin POST, server-built authorization, unique resource locks                |
| One-click hijack             | Fresh pixel/target check and one-shot dispatch; stable deceptive UI or post-capture race cannot be excluded |

The deterministic benchmark demonstrates fixture/control invariants, not Miro
page-distribution reliability. Screenshot origin/account claims are not DOM or
network attestation. Do not advertise this as independently proven production
financial automation; missing evidence deliberately prevents a click.

## Commands and operation

Install the already-used local Chromium if needed:

```powershell
npm run profile:install
```

Exact isolated StreamMax end-to-end test (no keys/providers required):

```powershell
npm run test:one-click
```

It starts an isolated loopback app and database, clicks the dashboard once,
reloads/polls, executes once, verifies in a fresh browser, checks the digest, and
saves receipt JSON + PNG under `.cleanbreak/one-click-smoke-*/`. No existing
provider or demo database is mutated. Expected: `STREAMMAX_ONE_CLICK_OK`.

Safe Miro validation, after manual authentication with `desktop:open`:

```powershell
$env:CLEANBREAK_DRY_RUN = "true"
$env:CLEANBREAK_REAL_PROVIDER_AUTHORIZED = "true"
$env:CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL = "false"
npm run real-provider:desktop-dry-run -- --auto
```

For **one real cancellation**, first inspect the configured plan/price/interval,
account Billing URL and saved dedicated Desktop; the helper never logs you in.
Then deliberately set these process variables (do not run them for a dry-run):

```powershell
$env:CLEANBREAK_DRY_RUN = "false"
$env:CLEANBREAK_REAL_PROVIDER_AUTHORIZED = "true"
$env:CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL = "true"
$env:CLEANBREAK_OPERATOR_PASSWORD = [Net.NetworkCredential]::new("", (Read-Host "New CleanBreak operator secret (24+ characters)" -AsSecureString)).Password
$env:CLEANBREAK_APP_ORIGIN = "http://localhost:3000"
```

Choose **one** authorization method, not both:

- Dashboard: set `$env:CLEANBREAK_CANCELLATION_WORKER = "true"`, then `npm run dev
-- --hostname 127.0.0.1`. Visit localhost:3000, authenticate as `cleanbreak` with
  the operator secret, review configured Miro terms, click Cancel subscription
  once. The initial click is the only cancellation approval.
- CLI: `npm run real-provider:desktop-live`. This command itself creates the
  initial authorization and uses exactly the same service as the dashboard.

Persistent production deployment: use `npm run build` then `npm start`; keep the
database and private artifacts on a persistent volume, TLS/auth in front of it,
and `CLEANBREAK_CANCELLATION_WORKER=true` for restart recovery. Alternatively run
`npm run cancellation:worker` alongside the server with identical environment and
database. Do not use a public shared or ephemeral instance. GET polling also
schedules persisted pending work, but is not a replacement for a durable worker.

Follow the returned job ID using the dashboard or GET `/api/cancellations/:id`.
Only VERIFIED exposes View receipt. Download its JSON and retain the displayed
digest separately; record the receipt page for demo evidence. Retain private
screenshots locally, review/redact them before sharing. When finished, restore
`CLEANBREAK_DRY_RUN=true` and `CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL=false`.

What to read next: existing `desktop-auto-trust-boundary.md`, the typed transition
map and SQLite repository. For a future multi-worker redesign, the state-graph
skill's actor-model/guardrail/telemetry follow-ups apply; they are not required for
this deliberately single-operator product path.
