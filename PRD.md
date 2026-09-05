
# CleanBreak — Product Requirements Document

**Version:** 0.1
**Status:** MVP implementation source of truth
**Product:** CleanBreak
**Tagline:** Make this the last charge.
**One-line pitch:** CleanBreak is an AI browser agent that cancels subscriptions for you and independently verifies that future billing has actually stopped.

## One-click product amendment

The primary dashboard now treats the initial Cancel action as a short-lived,
immutable, provider/subscription-scoped one-shot authorization. It does not ask
for a second approval. A separate durable commit gate revalidates original scope
and material terms, consumes the one permitted dispatch, never retries an unknown
outcome, and requires fresh independent verification before a receipt. Live Miro
remains explicitly opt-in and offline-tested only. The two-stage approval flow
described below remains the Browser/StreamMax regression/demo path, not the new
primary UX. See `docs/one-click-product.md` for current state/schema and operations.

---

# 1. Product Thesis

Canceling a subscription should be a simple transaction:

1. Find the cancellation setting.
2. Cancel.
3. Confirm no more charges will happen.

Instead, many services introduce account menus, retention offers, misleading buttons, multiple confirmation screens, cancellation fees, alternative plans, or unclear confirmation states.

Most existing subscription tools help users **find** subscriptions.

Some newer tools also claim to **cancel** them automatically.

CleanBreak focuses on the remaining trust problem:

> How does the user know the cancellation actually worked?

CleanBreak does not consider an agent saying “done” to be proof.

A cancellation is successful only after a separate verification run confirms the subscription is no longer scheduled to renew.

The primary product artifact is therefore not the AI agent.

It is the **CleanBreak Receipt**: an evidence-backed record showing what changed, when it changed, and why CleanBreak believes future billing has stopped.

---

# 2. Primary User

A consumer who:

- has a subscription they want to stop,
- knows the service they want canceled,
- can log into the service,
- does not want to manually navigate the cancellation flow,
- wants evidence that cancellation succeeded.

For the challenge MVP, this is intentionally a single-user product.

No organizations, teams, permissions, bank connections, or financial-account aggregation are required.

---

# 3. Core User Promise

The user supplies:

- subscription name,
- account/billing URL,
- recurring price,
- billing frequency,
- optional next renewal date,
- an authenticated Solari browser profile.

CleanBreak:

1. opens the service in a Solari browser,
2. navigates toward cancellation,
3. rejects or bypasses retention flows without accepting alternative offers,
4. pauses before the irreversible cancellation action,
5. shows the user what will happen,
6. receives explicit approval,
7. executes the cancellation,
8. opens a fresh browser session,
9. independently verifies the resulting account state,
10. produces a CleanBreak Receipt.

The UI must distinguish:

**Agent says it finished**

from:

**Cancellation independently verified**

Only the second is success.

---

# 4. MVP Scope

## Included

The MVP must support:

- manually adding a subscription,
- manually providing its URL,
- manually providing recurring cost,
- one configured Solari browser profile,
- autonomous browser navigation,
- retention-flow navigation,
- screenshot/evidence capture,
- human approval before final cancellation,
- execution of the approved action,
- fresh-session post-cancellation verification,
- verified / inconclusive / failed outcomes,
- CleanBreak Receipt generation,
- cancellation history,
- annualized savings calculation,
- deterministic demo subscription portal,
- live Solari execution,
- replay/evidence links when available.

## Explicitly excluded

Do NOT implement:

- Plaid,
- bank account connections,
- credit-card connections,
- Gmail discovery,
- Outlook discovery,
- automatic subscription discovery,
- mobile apps,
- browser extensions,
- price negotiation,
- plan downgrades,
- refunds,
- chargebacks,
- payment blocking,
- virtual cards,
- phone-call cancellation,
- email cancellation,
- live human support escalation,
- a marketplace of cancellation instructions,
- multi-user authentication,
- teams,
- enterprise permissions,
- blockchain,
- cryptocurrency,
- unnecessary microservices,
- desktop VMs merely to demonstrate another Solari product,
- generalized “computer use agent” infrastructure.

The challenge entry should perform one job extremely well.

---

# 5. Competitive Differentiation

CleanBreak is NOT:

> “A dashboard that tracks your subscriptions.”

CleanBreak is NOT:

> “An AI that clicks the cancel button.”

CleanBreak IS:

> “A cancellation transaction with independent verification.”

The product should repeatedly emphasize:

**Execution is not proof. Verification is proof.**

This is the defining product distinction.

---

# 6. Primary Demo Story

The entire product must be understandable in approximately 60–90 seconds.

## Starting dashboard

Display:

**3 Active Subscriptions**

**$69.99 / month**

**$839.88 / year**

Example subscriptions:

- StreamMax — $29.99/month
- DesignPro — $24/month
- NewsPlus — $16/month

Each card has:

- service name,
- recurring cost,
- renewal information,
- current status,
- `Cancel with CleanBreak` button.

The user selects:

**StreamMax — $29.99/month**

Annual potential savings:

**$359.88/year**

---

## Cancellation run

The UI transitions to a cancellation job screen.

Timeline:

1. Opening account
2. Finding billing settings
3. Finding cancellation path
4. Retention offer detected
5. Continuing cancellation
6. Final cancellation detected
7. Waiting for approval

The UI should show the latest browser screenshot throughout the run.

Example retention screens:

- “Pause your membership instead”
- “Get 30% off”
- “Tell us why you're leaving”
- “Are you sure?”

CleanBreak continues through these without accepting an offer.

---

## Human approval

Before the final action, display:

**Ready to cancel**

Service: StreamMax
Current plan: Premium
Current price: $29.99/month
Expected result: Auto-renewal disabled
Access until: September 28
Cancellation fee: None detected

Exact proposed action:

**Click “Confirm cancellation”**

Buttons:

`Approve cancellation`

`Abort`

CleanBreak MUST NOT execute the final action before explicit approval.

---

## Verification

After the user approves:

Status:

**Cancellation submitted**

Then:

**Verifying independently…**

A completely fresh browser session is opened.

The verifier checks the subscription account again.

Evidence might show:

- Membership: Canceled
- Auto-renew: Off
- Next charge: None
- Access until: September 28

The UI updates to:

**Verified canceled**

**$359.88/year eliminated**

Then display:

`View CleanBreak Receipt`

---

# 7. CleanBreak Receipt

Every VERIFIED cancellation generates a receipt.

The receipt is one of the most important challenge-demo surfaces.

It must contain:

## Identity

- cancellation job ID,
- service name,
- service domain,
- timestamp,
- recurring price,
- recurring interval.

## Before state

Example:

Plan: Premium
Status: Active
Auto-renew: Enabled
Price: $29.99/month
Next billing date: September 28

Include:

- evidence text,
- page URL,
- screenshot reference.

## Action

Example:

Final approved action:

`Confirm cancellation`

Approved at:

`2026-09-02T18:14:32Z`

Executed at:

`2026-09-02T18:14:35Z`

## After state

Example:

Status: Canceled
Auto-renew: Disabled
Next charge: None
Access until: September 28

## Verification

Display:

**VERIFIED**

Verification session must be different from the browser session that performed the cancellation.

Include:

- verification timestamp,
- verification criteria satisfied,
- verification screenshot,
- verification URL.

## Replay

If a Solari replay URL is available, show:

`Replay cancellation`

## Tamper-evident digest

Generate a SHA-256 digest over the canonical receipt JSON.

Display:

`Receipt SHA-256`

Do not call this a digital signature.

It is a tamper-evident digest only.

---

# 8. Cancellation State Machine

Use an explicit state machine.

Required states:

`DRAFT`

`READY`

`NAVIGATING`

`NEEDS_LOGIN`

`AWAITING_APPROVAL`

`COMMITTING`

`VERIFYING`

`VERIFIED`

`INCONCLUSIVE`

`FAILED`

`ABORTED`

Allowed major transitions:

DRAFT → READY

READY → NAVIGATING

NAVIGATING → NEEDS_LOGIN

NAVIGATING → AWAITING_APPROVAL

NAVIGATING → FAILED

NEEDS_LOGIN → NAVIGATING

AWAITING_APPROVAL → COMMITTING

AWAITING_APPROVAL → ABORTED

COMMITTING → VERIFYING

VERIFYING → VERIFIED

VERIFYING → INCONCLUSIVE

VERIFYING → FAILED

The UI must derive its labels from this state rather than maintaining separate arbitrary status strings.

---

# 9. Critical Crash-Safety Rule

A cancellation action may be irreversible.

Therefore:

> Never automatically execute the final cancellation click twice.

Immediately before performing the approved final action, persist the action intent.

Immediately after attempting the action, persist:

`finalActionAttemptedAt`

If the process crashes after this point, restarting the job MUST NOT automatically click the cancellation button again.

Recovery flow:

`COMMITTING → VERIFYING`

The system first checks whether the cancellation already succeeded.

Only a user may authorize another final attempt if verification proves it did not occur.

---

# 10. Browser Agent

The browser agent uses Solari Browser as the execution environment.

Solari must be a real dependency in the production path.

Do not build the challenge demo around a fake browser abstraction while merely mentioning Solari in the README.

## Browser requirements

Use:

`@solarisdk/browser`

The backend owns the Solari API key.

Never expose the Solari API key to the browser frontend.

Use a configured Solari profile for persisted authenticated sessions.

Support browser recording where available.

Take screenshots throughout important transitions.

---

# 11. Browser Agent Decision Contract

The model must not directly execute arbitrary code.

It should receive a simplified representation of the current page and return one structured action.

Use a constrained schema similar to:

```ts
type BrowserDecision =
  | {
      type: "click";
      target: Target;
      reasoning: string;
      confidence: number;
    }
  | {
      type: "fill";
      target: Target;
      value: string;
      reasoning: string;
      confidence: number;
    }
  | {
      type: "navigate";
      url: string;
      reasoning: string;
      confidence: number;
    }
  | {
      type: "wait";
      milliseconds: number;
      reasoning: string;
    }
  | {
      type: "final_cancel_candidate";
      target: Target;
      extractedTerms: CancellationTerms;
      reasoning: string;
      confidence: number;
    }
  | {
      type: "needs_human";
      reason: string;
    }
  | {
      type: "failure";
      reason: string;
    };
```

Target should contain the strongest available browser locator:

- accessible role,
- accessible name,
- visible text,
- CSS locator only as fallback.

Do not have the model generate executable JavaScript.

---

# 12. Agent Goal

The navigation agent's system objective is:

> Reach the final subscription cancellation action without committing an irreversible action.

The agent should prefer actions semantically associated with:

- Account
- Settings
- Billing
- Subscription
- Membership
- Manage plan
- Cancel
- End subscription
- Turn off renewal
- Continue cancellation
- No thanks
- Continue
- Confirm

The agent should reject retention alternatives such as:

- discounts,
- pauses,
- upgrades,
- downgrades,
- free months,
- promotional offers.

The product user requested cancellation.

The agent must not silently substitute another action.

---

# 13. Irreversible-Action Boundary

Any action that appears capable of:

- canceling the subscription,
- disabling auto-renew,
- ending membership,
- deleting the paid plan,

must be treated as a final-action candidate.

Before executing it:

1. capture screenshot,
2. extract visible cancellation terms,
3. store proposed locator,
4. store proposed button text,
5. change job state to `AWAITING_APPROVAL`,
6. show the user the terms,
7. wait for explicit approval.

---

# 14. Financial-Safety Boundary

If the final screen indicates:

- cancellation fee,
- early termination fee,
- remaining contractual balance,
- immediate loss of paid access,
- a refund waiver,
- another monetary commitment,

the agent must highlight it.

For the MVP:

If a non-zero cancellation fee is detected, DO NOT automatically execute cancellation.

Return:

`NEEDS_HUMAN`

with the detected fee and evidence.

Later versions may allow a second explicit fee acknowledgement.

---

# 15. Account-Safety Boundary

CleanBreak must not:

- delete the entire user account unless canceling the subscription necessarily requires it and the user separately approves,
- accept a new subscription,
- purchase something,
- change payment information,
- change passwords,
- disable security,
- bypass MFA,
- bypass CAPTCHAs outside supported Solari functionality,
- impersonate another person,
- operate an account the user is not authorized to control.

---

# 16. Independent Verification

Verification must be implemented as a separate system component.

Do not reuse the navigation agent's statement that cancellation succeeded.

## Required independence

After the cancellation attempt:

1. close or detach from the execution browser,
2. create a fresh Solari browser session,
3. attach the same authenticated profile,
4. revisit the service/account,
5. independently determine billing status.

The verification run must not rely on the execution agent's conclusions.

---

# 17. Verification Contract

Return:

```ts
type VerificationResult = {
  status: "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE";
  subscriptionStatus:
    | "ACTIVE"
    | "CANCELED"
    | "CANCELS_AT_PERIOD_END"
    | "UNKNOWN";
  autoRenew: boolean | null;
  nextChargeDate: string | null;
  nextChargeAmount: number | null;
  accessUntil: string | null;
  evidence: EvidenceItem[];
  satisfiedCriteria: string[];
  explanation: string;
};
```

---

# 18. Verification Rules

A cancellation may be VERIFIED when authoritative account evidence strongly demonstrates that future renewal has stopped.

Examples:

- explicit account status = canceled,
- explicit auto-renew = off,
- explicit “membership ends on…” state,
- next renewal removed,
- next charge removed,
- explicit cancellation confirmation displayed in the account.

Do not require every field because providers expose different information.

However:

**absence of a cancel button alone is never sufficient evidence.**

**the previous agent saying cancellation succeeded is never evidence.**

**a generic success toast alone is weak evidence and should not independently produce VERIFIED.**

If evidence conflicts, return INCONCLUSIVE.

If the account still clearly shows future renewal, return NOT_VERIFIED.

Fail closed.

---

# 19. Evidence Model

Every meaningful browser event should be capable of generating:

```ts
type EvidenceItem = {
  id: string;
  jobId: string;
  phase: "BEFORE" | "NAVIGATION" | "APPROVAL" | "AFTER" | "VERIFICATION";
  capturedAt: string;
  url: string;
  pageTitle?: string;
  visibleTextExcerpt?: string;
  screenshotPath?: string;
};
```

Do not store credentials.

Do not store full browser profile state in CleanBreak.

The Solari profile remains the authentication source.

---

# 20. Subscription Data Model

```ts
type Subscription = {
  id: string;
  name: string;
  url: string;
  domain: string;
  amount: number;
  currency: string;
  interval: "MONTHLY" | "YEARLY";
  nextRenewalDate?: string;
  status: "ACTIVE" | "CANCELED";
  createdAt: string;
  updatedAt: string;
};
```

Calculated values:

```ts
annualCost =
  interval === "MONTHLY"
    ? amount * 12
    : amount;
```

---

# 21. Cancellation Job Data Model

```ts
type CancellationJob = {
  id: string;
  subscriptionId: string;
  state: CancellationState;

  startedAt?: string;
  approvedAt?: string;
  finalActionAttemptedAt?: string;
  verificationStartedAt?: string;
  completedAt?: string;

  executionSessionId?: string;
  verificationSessionId?: string;
  replayUrl?: string;

  proposedAction?: ProposedAction;
  failureReason?: string;
};
```

---

# 22. Persistence

For the challenge MVP, prefer simplicity.

Use:

- SQLite,
- a small repository/data-access layer,
- migrations committed to the repo.

Do not add a distributed database or remote database dependency unless deployment later requires it.

Required persisted entities:

- subscriptions,
- cancellation jobs,
- browser steps,
- evidence,
- approvals,
- verification results,
- receipts.

---

# 23. API Requirements

Suggested endpoints:

`GET /api/subscriptions`

`POST /api/subscriptions`

`GET /api/subscriptions/:id`

`POST /api/subscriptions/:id/cancel`

`GET /api/jobs/:id`

`POST /api/jobs/:id/approve`

`POST /api/jobs/:id/abort`

`POST /api/jobs/:id/resume`

`GET /api/jobs/:id/evidence`

`GET /api/jobs/:id/receipt`

`POST /api/demo/reset`

Streaming/polling implementation may use:

- Server-Sent Events,
- WebSockets,
- or short polling.

Prefer the simplest implementation that produces a responsive demo.

---

# 24. Frontend Screens

Only four primary surfaces are required.

## `/`

Dashboard.

Contains:

- CleanBreak logo/name,
- annual subscription spend,
- potential annual savings,
- verified savings,
- subscription list,
- Add subscription,
- Cancel with CleanBreak.

## `/jobs/[id]`

Live cancellation execution screen.

Contains:

- service,
- cost,
- annual savings,
- current state,
- timeline,
- latest screenshot,
- agent action description,
- approval UI when required.

## `/receipts/[id]`

Evidence receipt.

Contains:

- before state,
- approved action,
- after state,
- verifier result,
- screenshots,
- replay,
- SHA-256 digest.

## `/demo`

Resettable deterministic cancellation fixture.

Can also contain controls that alter demo difficulty.

---

# 25. Demo Fixture

Build a deterministic fake subscription service inside the repository.

Call it something clearly fictional such as:

**StreamMax**

The demo fixture must emulate real cancellation friction.

Starting state:

- Premium plan,
- $29.99/month,
- auto-renew = on,
- next billing date,
- active status.

Cancellation sequence:

1. Account
2. Billing
3. Manage subscription
4. Cancel
5. “Pause instead?”
6. “Take 30% off?”
7. “Why are you leaving?”
8. “Continue cancellation”
9. final terms screen
10. Confirm cancellation

After confirmation:

- status = canceled,
- auto-renew = off,
- next charge = none,
- access-until date remains visible.

The state must persist so the verification browser sees the authoritative changed state.

Provide a `Reset demo subscription` control.

---

# 26. Demo Difficulty Variants

The fixture should support at least these deterministic scenarios.

## Variant A — Happy path

Straightforward cancellation.

Expected:

VERIFIED.

## Variant B — Dark pattern

Multiple retention offers and misleading “Keep subscription” buttons.

Expected:

agent refuses offers and eventually reaches final cancellation.

## Variant C — Cancellation fee

Final screen displays a non-zero cancellation fee.

Expected:

agent stops.

No cancellation executed.

## Variant D — Ambiguous confirmation

Cancellation click displays only:

“Request received.”

Account status does not clearly change.

Expected:

INCONCLUSIVE.

## Variant E — Already canceled

Account is already canceled.

Expected:

verifier detects canceled status without attempting another destructive action.

---

# 27. Browser Screenshots

Capture at minimum:

1. account/billing state before navigation,
2. every retention screen,
3. final pre-approval screen,
4. immediately after cancellation attempt,
5. verification account state.

Screenshots should be associated with evidence records.

The UI should display them without requiring filesystem browsing.

---

# 28. Solari Requirements

Production execution MUST use Solari.

Required:

- `@solarisdk/browser`
- Playwright-compatible interaction
- server-side API key
- Solari browser sessions
- screenshot capture
- persisted profile support
- fresh verification session

Recommended:

- session recording,
- replay URL,
- stealth mode if available on the user's Solari plan,
- captcha support only when needed.

Do not make paid-only capabilities mandatory for the entire app to boot.

Configuration should allow them to be enabled.

Example environment configuration:

```env
SOLARI_API_KEY=
SOLARI_PROFILE_ID=
SOLARI_STEALTH=false
SOLARI_RECORDING=true

OPENAI_API_KEY=
OPENAI_MODEL=

CleanBreak_BASE_URL=http://localhost:3000
DATABASE_URL=
```

The Solari profile is sensitive and must be treated like a credential.

---

# 29. LLM Requirements

The application may use an LLM as the browser-navigation planner.

Use structured output.

The LLM may decide:

- which visible UI element to interact with,
- whether the flow is a retention offer,
- whether a final cancellation boundary has been reached,
- what cancellation terms appear on screen.

It may NOT directly execute arbitrary browser code.

All proposed actions must pass through deterministic application policy.

This allows CleanBreak—not the LLM—to enforce:

- approval,
- fee blocking,
- irreversible-action boundaries,
- retries,
- crash recovery.

---

# 30. UI Design Direction

The product should look like a financial control center, not a chatbot.

Avoid a giant chat interface.

Primary visual language:

- clean,
- sparse,
- high information density,
- strong status states,
- evidence-first.

Recommended dashboard hierarchy:

**$839.88/year recurring**

then:

**$359.88 currently cancellable**

then subscription cards.

Status vocabulary:

Active

Navigating

Approval required

Verifying

Verified canceled

Inconclusive

Failed

Do not label a job “Canceled” before verification finishes.

---

# 31. Product Copy

Hero:

**Make this the last charge.**

Subheading:

**CleanBreak cancels subscriptions in a real browser, then checks again to prove they actually stopped renewing.**

Primary CTA:

**Cancel with CleanBreak**

Approval title:

**CleanBreak is ready to cancel this subscription.**

Verification title:

**Checking that billing actually stopped…**

Success:

**Cancellation verified.**

Supporting success text:

**Auto-renew is off and no future charge was found.**

Failure:

**Cancellation could not be verified.**

Supporting text:

**CleanBreak will never mark a cancellation successful without evidence.**

---

# 32. Annual Savings

For every verified cancellation calculate eliminated recurring cost.

Monthly:

`amount × 12`

Yearly:

`amount`

Do not count:

- failed jobs,
- inconclusive jobs,
- aborted jobs,

toward verified savings.

Dashboard should distinguish:

**Potential savings**

from:

**Verified savings**

This distinction reinforces the core product concept.

---

# 33. Metrics

Instrument these from day one.

## Product metrics

`jobs_started`

`jobs_reached_final_action`

`jobs_approved`

`jobs_verified`

`jobs_inconclusive`

`jobs_failed`

`jobs_aborted`

`annual_dollars_verified`

`time_to_approval_ms`

`time_to_verified_ms`

`agent_steps`

`retention_screens_encountered`

`human_actions_required`

## Challenge benchmark metrics

Report:

### Cancellation completion rate

`verified jobs / started jobs`

### Human attention

How many user interactions were required?

Target:

**1 approval click after starting the job.**

### Dark-pattern depth

How many retention screens did CleanBreak successfully navigate?

### Verification coverage

Target:

**100% of successful cancellations independently verified.**

### False-success rate

Against deterministic fixture truth:

Target:

**0 cases where CleanBreak reports VERIFIED while fixture remains active.**

### Annual recurring spend eliminated

Sum of verified annual savings.

---

# 34. Benchmark Suite

Create a script:

```bash
npm run benchmark
```

It should run the deterministic fixture variants repeatedly.

Suggested:

5 variants × 5 runs = 25 runs.

Generate:

```text
artifacts/benchmark-results.json
```

Include:

```json
{
  "runs": 25,
  "verified": 0,
  "inconclusive": 0,
  "failed": 0,
  "falseVerified": 0,
  "successRate": 0,
  "medianTimeToApprovalMs": 0,
  "medianTimeToVerifiedMs": 0,
  "medianAgentSteps": 0,
  "totalRetentionScreensNavigated": 0
}
```

Values must come from actual test execution.

Never fabricate benchmark numbers.

---

# 35. Required Tests

Implement automated tests for at least:

1. annual savings calculation,
2. allowed state transitions,
3. invalid state transitions,
4. final action cannot run without approval,
5. fee screen blocks execution,
6. aborted job cannot commit,
7. receipt only created after successful verification,
8. verifier marks active subscription NOT_VERIFIED,
9. ambiguous fixture is INCONCLUSIVE,
10. canceled fixture is VERIFIED,
11. already-canceled subscription is not canceled twice,
12. crash after final-action attempt resumes at VERIFYING,
13. second automatic destructive click is prohibited,
14. evidence is associated with job,
15. digest changes when receipt content changes.

---

# 36. Definition of VERIFIED

This word has strict semantics.

A job may display `VERIFIED` only when:

1. a cancellation action was executed or the subscription was already canceled,
2. a fresh verification session was created,
3. that session observed authoritative post-cancellation account state,
4. verification policy classified the state as sufficiently strong,
5. the evidence was persisted,
6. the receipt was generated.

If any requirement is missing, do not display VERIFIED.

---

# 37. Logging

Use structured logs.

Every log line should include when available:

- `jobId`
- `subscriptionId`
- `phase`
- `state`
- `sessionId`
- `actionType`
- `durationMs`

Never log:

- passwords,
- cookies,
- auth headers,
- full Solari profile state,
- API keys.

---

# 38. Error Handling

Important error categories:

`SOLARI_CONFIGURATION_ERROR`

`SOLARI_SESSION_ERROR`

`LOGIN_REQUIRED`

`NAVIGATION_TIMEOUT`

`AGENT_LOW_CONFIDENCE`

`FINAL_ACTION_NOT_FOUND`

`CANCELLATION_FEE_DETECTED`

`USER_ABORTED`

`EXECUTION_UNKNOWN`

`VERIFICATION_FAILED`

`VERIFICATION_INCONCLUSIVE`

Store machine-readable error code and human-readable message.

---

# 39. Authentication

Do not build CleanBreak account authentication in MVP.

This is a local/single-user challenge project.

Authentication into target subscription providers should occur through the configured Solari profile.

The README must clearly explain that browser profiles contain authenticated account state and should be treated like credentials.

---

# 40. Repository Structure

Prefer a simple structure like:

```text
examples/
  CleanBreak-ts/
    app/
    components/
    lib/
      agent/
      browser/
      verification/
      policy/
      receipts/
      db/
    fixture/
    tests/
    scripts/
    artifacts/
    public/
    README.md
    .env.example
```

Adjust to the cookbook's existing conventions if necessary.

Do not restructure the entire upstream repository.

---

# 41. Important Internal Interfaces

Create interfaces around responsibilities, not unnecessary infrastructure.

Suggested:

```ts
interface BrowserNavigator {}

interface CancellationPolicy {}

interface CancellationVerifier {}

interface ReceiptBuilder {}

interface JobRepository {}

interface EvidenceRepository {}
```

The Solari implementation should sit behind browser execution code, but the real application path must invoke it.

---

# 42. Implementation Order

Implement vertically.

## Milestone 1 — Fixture + dashboard

Deliver:

- CleanBreak branding,
- dashboard,
- subscription model,
- demo data,
- deterministic StreamMax fixture,
- reset button.

No agent yet.

Definition of done:

User can manually navigate fixture and cancel it.

---

## Milestone 2 — Solari browser execution

Deliver:

- Solari configuration,
- browser session creation,
- page navigation,
- screenshots,
- basic browser actions,
- job timeline.

Definition of done:

CleanBreak can open StreamMax through a real Solari browser.

---

## Milestone 3 — Agent navigation

Deliver:

- page observation,
- structured LLM decisions,
- policy validator,
- iterative navigation,
- retention-screen handling.

Definition of done:

Agent reaches final cancellation screen without clicking final action.

---

## Milestone 4 — Approval boundary

Deliver:

- AWAITING_APPROVAL state,
- latest screenshot,
- extracted final terms,
- approve,
- abort,
- commit logic.

Definition of done:

Final cancellation cannot happen without explicit user approval.

---

## Milestone 5 — Independent verifier

Deliver:

- fresh Solari session,
- account revisit,
- structured verification,
- VERIFIED / NOT_VERIFIED / INCONCLUSIVE.

Definition of done:

StreamMax cancellation is only reported successful after independent verification.

---

## Milestone 6 — Receipt

Deliver:

- before evidence,
- action evidence,
- after evidence,
- verification evidence,
- replay link if available,
- SHA-256 digest,
- receipt UI.

Definition of done:

User can open a clear CleanBreak Receipt after successful cancellation.

---

## Milestone 7 — Benchmark suite

Deliver:

- deterministic variants,
- automated scenario runner,
- JSON output,
- metrics summary.

Definition of done:

Actual measured benchmark file is produced locally.

---

## Milestone 8 — Real-account test

Use only an account the developer owns or is authorized to manage.

Prefer:

- a free trial,
- inexpensive disposable subscription,
- or service that permits immediate reactivation.

First run in dry-run mode where possible.

Release gate:

At least one real provider flow reaches the approval boundary through Solari.

Ideal challenge evidence:

At least one real provider is canceled and independently verified.

Do not fake this result.

---

# 43. Dry-Run Mode

Support:

```env
CleanBreak_DRY_RUN=true
```

In dry-run mode:

- navigate normally,
- identify final cancellation action,
- collect terms,
- request approval if desired,
- NEVER execute the irreversible action.

This enables safe real-world testing.

Clearly label the UI:

**DRY RUN — cancellation will not be submitted**

---

# 44. Success Criteria for the Challenge Entry

The project is ready to submit when all are true:

- CleanBreak launches with one documented command,
- UI is visually polished,
- Solari is clearly used in the actual product flow,
- deterministic fixture works,
- cancellation agent handles retention screens,
- final cancellation requires explicit approval,
- verifier uses a fresh browser session,
- VERIFIED cannot occur without evidence,
- receipt is generated,
- replay is shown when available,
- benchmark suite runs,
- tests pass,
- README explains architecture in simple language,
- architecture diagram exists,
- demo GIF/video exists,
- screenshots exist,
- setup requires minimal steps,
- no fake benchmark results appear,
- no unnecessary TODO language remains in the submission README.

---

# 45. Architecture Explanation for README

Keep the explanation this simple:

```text
User
  |
  v
CleanBreak Dashboard
  |
  v
Cancellation Job
  |
  v
Solari Browser #1
  |
  | navigate account
  | reject retention flows
  v
Human Approval
  |
  v
Final Cancellation
  |
  v
Solari Browser #2
  |
  | fresh independent check
  v
Verification Policy
  |
  +----> Inconclusive / Failed
  |
  v
VERIFIED
  |
  v
CleanBreak Receipt
```

---

# 46. Challenge Pitch

Use this exact conceptual framing:

**Subscription tools tell you what you're paying for. CleanBreak actually ends the subscription—and then checks its own work.**

The technically interesting part is not merely browser automation.

It is the transactional boundary:

**navigate → ask permission → commit → independently verify → produce evidence**

That is what should be obvious when someone opens the repo.

---

# 47. Final Scope Rule

If a proposed feature does not improve one of these five things:

1. cancellation execution,
2. human safety,
3. independent verification,
4. evidence quality,
5. demo clarity,

do not build it before submission.

Ship the smallest version that makes this flow undeniable.
