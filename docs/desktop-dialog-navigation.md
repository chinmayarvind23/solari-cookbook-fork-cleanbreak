# Desktop scrolling, planner budget and trust boundary

Two saved regressions exposed different focus problems: Page Down did not move
a cancellation dialog, and a later Billing-page run made no visible movement
before four Tabs traversed billing links. The latter stopped at the old 20,000
token ceiling on its sixth screenshot. No final click was attempted.

## Narrow correction

The [installed Desktop SDK](https://docs.getsolari.com/sdk/typescript/vms)
documents absolute-coordinate `mouse.drag(from, to, button?)`. Its scroll API
does not expose a documented wheel distance or direction. The planner therefore
may propose **only a short vertical drag of a visible scrollbar thumb**, not
arbitrary dragging, wheel arguments, blank focus clicks or shell commands.

The strict `scroll` decision requires the exact label `vertical scrollbar`,
authenticated configured origin, confidence at least 0.95, observed track and
thumb geometry, and a 10–160 pixel vertical displacement. The track must be
3–20 pixels wide, at least 80 pixels tall, and below the top 80 desktop pixels.
The pointer starts inset inside the thumb; the entire displaced thumb stays in
the track. Text, keyboard chords and destination navigation are forbidden for
this action. Every drag gets an immutable, one-use policy grant. These numeric
checks constrain a visually identified scrollbar; they do not independently
prove semantic identity. A custom page control disguised as a scrollbar remains
a residual screenshot-agent risk.

Pre-dispatch comparison protects the entire drag corridor with the same
32-pixel padding used for click targets. Original screenshot hashes remain
audit evidence. No drag occurs after a changed corridor, changed dimensions,
decode failure, or material global drift. No failed/uncertain input is retried.

After an acknowledged page key or scrollbar drag, decoded-pixel comparison of
the original and settled frames reports only ratio/threshold/boolean. RGB
channel threshold is 16 and changed-pixel threshold is 0.5%. At or below 0.5%
is **no visible progress**, not evidence the page moved. A stalled page key can
be followed by a separately planned scrollbar drag. A stalled drag cannot be
repeated on that unchanged screen. At most two focus-only Tab/Shift+Tab moves
are allowed while stalled; Enter/Space remain blocked. One read-only replan
after a blocked no-progress proposal is allowed **per run**; the next stops
`NAVIGATION_NO_PROGRESS`. Material movement clears stalled input flags, but
does not establish cancellation success or restore that replan allowance.

## Bounded planning and safe accounting

The default total budget is 5,000 tokens × configured max steps (20 steps means
100,000 tokens), capped at 200,000. `CLEANBREAK_DESKTOP_MAX_TOKENS` can explicitly
set a 5,000–200,000 ceiling, including the former 20,000 limit. Invalid values
fail before connecting. This increases the possible model cost; it is not an
unlimited retry mechanism. The max-step bound remains 1–30, default 20.

All reported input **and** output usage, including schema retries, counts.
Per-step and run evidence stores numeric usage/budget only. Known usage is
retained on sanitized planner failures; API errors without returned usage
cannot be measured here. A response can cross the remaining budget because
input cost is known only after the response; its action is then blocked before
dispatch. No credentials, raw responses or additional screenshots are added to
logs or evidence. Model, output ceiling and final authorization are unchanged.

Worked synthetic trace:

| Observation                                  | Proposed action        | Result                                              |
| -------------------------------------------- | ---------------------- | --------------------------------------------------- |
| Clipped Billing/dialog; wrong keyboard focus | Page Down              | Acknowledged, NO_VISIBLE_PROGRESS                   |
| Same screen; visible scrollbar thumb         | Bounded scrollbar drag | Policy/review/corridor checks, one dispatch         |
| Fresh screen reveals clipped controls        | Reversible control     | Existing target and provider policy                 |
| Final cancellation boundary                  | Final candidate        | Intercept for existing scoped one-shot product gate |

## Trust-boundary memo

The full read/write tables and five-attack defense checklist in
[Desktop auto trust boundary](desktop-auto-trust-boundary.md) still apply.

| Read surface                                                      | Trust                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| Provider screenshots, labels, scrollbar geometry, model proposals | Untrusted observations, never authorization            |
| Solari/OpenAI transport and private evidence                      | Scoped authorized infrastructure; credentials withheld |

| Write surface                                         | Blast radius                       | Reversible?                                         |
| ----------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Visible scrollbar thumb and existing focus keys       | Dedicated Desktop scroll/focus     | Intended yes; custom event handlers remain a risk   |
| Existing private evidence plus numeric progress/usage | Ignored per-run artifacts          | No new private text or image persistence            |
| Final cancellation                                    | Existing exact one-shot scope only | Irreversible; unchanged execution/verification gate |

Supervised mode retains NAVIGATE. The explicitly requested autonomous product
mode remains the scoped exception described in [product boundary](one-click-product.md).
Provider content cannot extend permissions. No session, profile, Miro-specific
entry rule, financial scope or final-click authorization was changed. The agent
loop skill's general turn guidance is not substituted for this financial
workflow's stricter limits. No persistent planner memory or new tool framework
was introduced.

Deployment verdict: **research-only, not proof of live Miro reliability**.
An offline native Chromium scrollbar test demonstrates actual page movement,
revealed controls and no button/keyboard activation. Runtime tests cover policy,
stable corridors, no-progress limits, failed usage accounting and unchanged
final interception. No live provider or Solari Desktop is exercised by them.

Before another live attempt, the configured amount and billing interval must
match the provider. The inspected screenshot indicated yearly billing while
the existing authorization UI said monthly. This patch does not silently
correct or reuse authorization with different financial terms.
