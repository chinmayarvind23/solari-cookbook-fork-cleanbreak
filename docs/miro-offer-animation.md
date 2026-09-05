# Miro extension-offer animation boundary

The observed failure occurred before the offer-dialog scrollbar drag. The moving
diagram changed 0.9–9.7% of the screen between read-only samples, despite the
scrollbar remaining unchanged. Waiting for an identical-enough frame did not
find a match within the bounded observation window. No cancellation was attempted.

## Scoped fix

The user explicitly approved excluding the non-interactive preview for **scrolling
and explicit offer rejection only**. This is not an increased global tolerance.
The ordinary/final comparison remains 0.5% changed pixels, channel difference >16,
with 32-pixel protected targets. Original screenshot hashes are preserved.

The exception requires the exact configured authenticated Miro Billing URL,
confidence >=0.95, RETENTION/CANCELLATION_DIALOG, this run's completed ENTRY then
CONTINUE_DIALOG, and visible extra-14-days Business trial offer copy. After an
acknowledged scroll on that offer, a trusted boolean permits recognizing clipped
headings only while remaining offer copy is still visible. No old screen text or
cross-job history is replayed. Once the offer is declined this scope ends.

The planner reports the tight visible illustration rectangle, never terms,
buttons, links, inputs, or browser chrome. Deterministic bounds exclude at most
20% of the viewport and prohibit overlap with the full padded scrollbar track or
decline target. Outside that rectangle the same 0.5% threshold applies using the
unmasked area as denominator. A second read-only sample after 250ms must show
motion inside that same rectangle; both fresh frames must preserve the controls
and surrounding page. Decode errors, resized images, target changes, or changed
terms outside the preview stop. Metadata contains only numeric metrics/rectangle,
booleans and enums; fresh comparison images stay in memory. A moving preview alone
does not count as scroll progress.

Only an already policy-allowed scrollbar drag or an explicit **No thanks / Not now**
button can use this exception. Entry, Continue, keys, reason inputs, cancel-labelled
controls, offer acceptance, and final commit cannot. No click retry is introduced.
The one-click product's separate authorization/commit/verification gates remain
unchanged; the navigation dry-run still cannot execute a final click.

## Trust-boundary review

| Read surface                                                         | Trust                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Configured Miro Billing screen, labels, illustration and address bar | Untrusted third-party pixels; model interpretations are not attestation       |
| Solari control connection / dedicated VM                             | Scoped credential-bearing infrastructure; no credentials in planner text/logs |
| OpenAI screenshot processor                                          | Authorized processor; returned observation remains untrusted                  |
| Current-job completed action records                                 | Application-owned enums and booleans; no cross-run planner memory             |

| Write                        | Scope / reversibility                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Scroll and decline extension | Dedicated subscription dialog; intended reversible; never accept extra days                                                 |
| Evidence                     | Existing ignored private screenshots plus safe aggregate metadata                                                           |
| Product final commit         | Original short-lived provider/subscription/terms authorization only; one irreversible attempt, never retried on uncertainty |

The user-requested autonomous mode overrides the skill's default per-navigation
human review only for deterministic allowlisted navigation. The original web-app
click remains the required scoped one-shot authorization for the final action.
Session isolation, sanitized evidence, strict schema, target/origin/terms policy,
immutable single-use grants and fresh final revalidation remain required.

| Attack                       | Defense / limit                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Visible-text injection       | Page text cannot authorize writes; schema and exact policy gates precede region comparison. Model misidentification remains a risk.   |
| URL query/fragment injection | Exact credential/query/fragment-free configured Billing URL; no page-supplied commands                                                |
| Memory binding               | No persistent planner memory; in-run boolean derives only from returned offer scrolls. Canaries are not applicable.                   |
| CSRF-shaped action           | No new dispatcher or payloads; forbidden offer/account changes blocked; final one-shot gate separate                                  |
| One-click hijack             | Two fresh comparisons, protected track/target, small bounded illustration; stable deception and post-capture races cannot be excluded |

Deployment verdict: **research-only**, dedicated opt-in Desktop. Tests include a
real local Chromium scrollbar and animated synthetic offer, mock Miro navigation
to final interception, and the separate local StreamMax one-shot/receipt smoke.
These do not prove live Miro cancellation or general production reliability.
