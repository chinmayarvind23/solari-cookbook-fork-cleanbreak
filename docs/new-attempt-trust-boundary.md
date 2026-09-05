# Explicit new-attempt boundary

Deployment verdict: research-only/single operator. This change makes the existing
fresh-authorization workflow reachable from an eligible failed card; it does not
establish live Miro reliability or authorize autonomous action retries.

## Read surfaces

| Surface                                                               | Trust                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| CleanBreak exact configured origin, operator UI, persisted SQLite job | First-party; browser request/storage remain untrusted inputs                |
| Miro configured origin, Solari transport, OpenAI screenshot processor | Existing surfaces only, unchanged; provider pixels/text remain out-of-trust |

## Write surfaces

| Action                      | Blast radius                                                     | Reversible?                                                         |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Explicit new-attempt button | One newly scoped, expiring cancellation authorization            | Authorization may lead to an irreversible subscription cancellation |
| New request ticket and job  | Browser-local IDs and new SQLite record                          | Old job/history preserved; no reset of consumed locks               |
| Provider actions            | Existing dedicated session and deterministic one-shot dispatcher | No additional action capability or automatic retry                  |

## Defenses

- The operator's button click is fresh human authorization. Page content, polling,
  reloads, server startup and failure alone cannot create the new attempt.
- Authenticated exact-origin JSON POST and strict body validation remain. Optional
  `retryOf` is a lookup identifier, never caller-supplied eligibility or scope.
- Eligibility is rechecked inside BEGIN IMMEDIATE: FAILED, EXPIRED, every safety
  counter zero, allowlisted navigation failure, exact current configured scope.
  Unknown/generic failures and possibly dispatched actions remain ineligible.
- The existing idempotency and subscription/Desktop locks still govern creation;
  no record, authorization or consumed lock is cleared. Response loss retains the
  pending request key. Concurrent fresh keys resolve to the same active job.
- Existing dedicated session, bounded planner, target policy, fresh final
  extraction/stability, one-use dispatch and independent verification remain.
  The user's original one-shot consent model overrides the skill's per-action
  approval default only within that already documented scope.
- No credentials or provider state added to local storage/logging. No new planner
  persistent memory: memory-canary requirements do not apply to request IDs.

## Known-attack checklist

| Attack                 | Defense                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Visible-text injection | No new decision authority from page text; existing strict planner/policy checks                       |
| URL/query injection    | Retry ID cannot select an origin or change configured scope                                           |
| Memory binding         | Storage IDs are untrusted; server loads the actual record and checks eligibility                      |
| CSRF-shaped writes     | Operator authentication, exact-origin JSON check, strict request shape                                |
| One-click hijack       | Explicit authorization copy, immutable scope, existing final target revalidation and single-use claim |

Offline checks exercise the actual component handler, transaction/routes and a
local Chromium restored-failure-to-receipt flow. These are not real-provider
distribution evidence. No live job is submitted or restarted during implementation.
