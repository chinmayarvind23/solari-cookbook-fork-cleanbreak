# Dialog navigation regression and trust boundary

The observed Miro run opened a cancellation dialog with clipped bottom controls,
sent Page Down three times without moving it, then exhausted the planner budget.
The wrapper incorrectly flattened TOKEN_BUDGET into FINAL_BOUNDARY_NOT_ESTABLISHED.

## Narrow correction

The installed Desktop SDK's `ScrollOptions` has button/humanize, not a distance
or direction. No invented wheel arguments, shell, blind focus clicks or new
dispatcher are added. The planner prefers existing safe Tab/Shift+Tab navigation
to reveal clipped dialog controls, then must inspect a fresh screenshot before
identifying their labels, coordinates and consequences. Enter/Space stay blocked.

After an acknowledged Page_Down/Page_Up, decoded-pixel comparison of the original
and settled frames reports only ratio/threshold/boolean. RGB channel threshold is
16, changed-pixel threshold is 0.5%. At or below 0.5% is **no visible progress**;
decode/dimension failures stop. Material movement clears the page-key block but
is not semantic evidence of cancellation progress. Original screenshot hashes,
independent pre-dispatch stability and padded click-target checks are unchanged.

The strict Responses observation includes fixed no-progress feedback. Repeated
page keys on that unchanged screen receive no grant/input. One read-only replan
is allowed per run; a second blocked proposal stops NAVIGATION_NO_PROGRESS.
Final interception remains the primary stop; guard failures, interruption,
unknown input outcome, 20 default steps (configured 1–30), and 20,000 reported
tokens remain safety belts. The agent-loop skill's general 200-turn suggestion
is not applied to this narrow financial workflow. Existing message/schema,
typed tool registry and redacted traces are reused, not a new architecture.
There is no OTel runtime or persistent planner memory to extend.

Worked synthetic trace:

| Observation                            | Proposed action | Result                                                  |
| -------------------------------------- | --------------- | ------------------------------------------------------- |
| Clipped dialog; background focused     | Page_Down       | Acknowledged, NO_VISIBLE_PROGRESS                       |
| Same screen; fixed feedback            | Page_Down       | BLOCK; no input; read-only replan                       |
| Same dialog; no activation permitted   | Tab             | Existing policy, review and stability gates; focus only |
| Fresh screenshot reveals final control | Final candidate | INTERCEPT; no navigation dispatcher                     |

The product now preserves token/step/no-progress failures as fixed public codes
and actionable messages. Existing failed jobs, idempotency keys, profiles,
session handling, budgets and final-click authorization are not modified.

## Trust-boundary memo

The complete read/write tables, defense stack and five-attack checklist in
[Desktop auto trust boundary](desktop-auto-trust-boundary.md) still apply.

| Read surface                                                         | Trust                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| Configured Miro origin, screenshots, URLs, labels, planner proposals | Out-of-trust, never permission                   |
| Existing Solari/OpenAI transports and private local evidence         | Authorized infrastructure; capabilities withheld |

| Write surface                           | Blast radius                                | Reversible?                                                |
| --------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Existing safe focus keys                | Dedicated Desktop focus/scroll position     | Intended yes; custom provider handlers are a residual risk |
| Existing evidence plus numeric progress | Ignored per-run artifacts                   | Deletable; no additional images or private text            |
| Final cancellation                      | Existing scoped one-shot authorization only | No new authorization or dispatcher                         |

Supervised mode retains NAVIGATE review. The user's explicit autonomous mode
and one-shot product requirements remain the scoped exceptions in the
[product boundary](one-click-product.md), not broader write authority. Fresh
stability, exact keys/target policy, immutable one-use grants, dedicated session,
safe evidence and zero unknown-outcome/destructive retries remain mandatory.
The skill review did not add permission from provider content or persist private
reasoning. No persistent planner memory means memory-canary changes are not
applicable; adding such memory requires a separate review.

Deployment verdict: **research-only**, not live Miro reliability. A real local
Chromium test with synthetic dialog markup proves Tab reveals the clipped control
without activating it after ineffective Page Down. Offline runtime tests cover
feedback, blocked repeats, bounded replanning, genuine movement, review/stability,
final interception and no retries. No provider was contacted by these tests.

What to read next: the agent-loop skill's Lesson 27 (prompt injection) and the
linked trust boundaries before expanding tools or scope.
