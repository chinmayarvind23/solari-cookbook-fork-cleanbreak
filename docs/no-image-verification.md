# Miro DOM navigation and independent verification

The default Miro product path uses the existing Solari Desktop Chrome through
standard Playwright CDP. It makes no model calls. Screenshots, video, OCR and
private page text are not uploaded to a model; local pixels still guard input.

This adapter supports the observed **Miro Business Trial** flow, not arbitrary
plans or a universal cancellation interface. One real web-app run completed and
was independently verified; see [evidence and limits](../IMPLEMENTATION_STATUS.md).

## Scope and readiness

The configured provider must be Miro at its exact HTTPS Billing account path.
One trailing slash may differ; credentials, queries, fragments, other accounts
and unknown surfaces cannot establish identity. Recognized Billing structure,
trial/plan, currency, interval, amount and access date must match trusted scope
and the account's billing response. Login fields, ambiguity or unsafe terms stop.

The shared configuration validator requires a server-side `OPENAI_API_KEY`.
The DOM adapter itself makes no model requests.

## Ordered cancellation flow

| Stage         | Recognized action                                                      |
| ------------- | ---------------------------------------------------------------------- |
| ENTRY         | Standalone Billing “Cancel trial”                                      |
| BENEFITS      | Continue after the observed Business Trial benefits/expiry dialog      |
| DECLINE_OFFER | Continue to cancel instead of accepting extra trial days               |
| CANCEL_CHOICE | Select cancellation, explicitly not the default downgrade              |
| REASON_NEXT   | Continue to the separate reason form, despite a reused cancel label    |
| REASON_INPUT  | Fill the fixed neutral sentence: “I no longer need this subscription.” |
| FINAL         | Return the unique reason-submit candidate to the separate commit gate  |

These are fixed local structures/test IDs, labels, roles and ordered history—not
label-only permission. A completed stage is never automatically repeated.
The navigator does not dispatch FINAL; the existing scoped one-use gate owns it.

At most eight loop turns are allowed, with bounded read-only settling polls.
Each input stage occurs at most once. Duplicate/hidden/disabled targets, hit-test
failure, changed scope/terms, unknown dialogs or stage order stop the job.
The DOM adapter does not reconstruct missing navigation history after a crash.

The term basis is the documented free-plan Business Trial cancellation with no
trial charge and access through trial expiry:
[Miro Business Plan 14-day trial](https://help.miro.com/hc/en-us/articles/15392587152786-Business-plan-14-day-free-trial).
The live layout reused “Cancel subscription” before a distinct reason-submit
control. The paid Starter/legacy downgrade route is outside this adapter.

## Pre-dispatch evidence

Local readers return only recognized facts, booleans, enums, coordinates and
hashes. Selected text is hashed inside Chrome; raw private text is not persisted.
A fresh DOM/terms hash and target hit test must agree immediately before input.
Local decoded-pixel comparison retains the 0.5% threshold, RGB difference 16 and
32-pixel padded target protection. Decode/dimension/target changes fail closed.

Final screenshots remain private audit evidence with their SHA-256 hashes.
No offer-animation exception or model fallback weakens the DOM final check.
The receipt retains before/after evidence; an unknown dispatch never retries.

## Independent billing verification

After execution control closes, the verifier uses a new control observation and
fresh page in the same authenticated Chrome profile, then reloads Billing.
It does not create a new authenticated browser process or reuse the dialog's
claimed outcome.

The page's naturally loaded billing GET response is accepted only for its exact
configured account receiver path, HTTPS Miro origin, GET/200/JSON and bounded body.
The observer generates no API request or mutation. Query data is transport-only:
never logged, retained as authority or used to broaden the account scope.

A strict projection keeps only known trial, status, renewal, currency, interval
and date fields; unrelated account/payment fields are discarded. Two readings
must agree and match authenticated Billing UI identity.

- Trialing plus `cancelAtPeriodEnd=true` establishes scheduled non-renewal.
- `periodEnd` provides the remaining access date.
- Active renewal with a definite upcoming charge is NOT_VERIFIED.
- Login, missing, conflicting or mismatched evidence is INCONCLUSIVE.

A missing amount or success toast is insufficient. Safe semantic DOM-field
reading remains a supported fallback for recognized fields; it still requires
fresh agreeing identity/billing evidence and rejects login surfaces. The verified
live run used `DOM_AND_PROVIDER_BILLING`, not that fallback.

The service independently computes the verdict and requires one acknowledged
final execution before creating a product receipt. `desktop:verify` only reads
billing; it cannot authorize cancellation or issue that receipt.

## Private transport and cleanup

The installed `playwright-core` connects with `noDefaults: true`, preserving the
shared Chrome settings. Patchright is not used here because its automatic Fetch
interception stalled new tabs in this VM; it remains available for existing local
helpers/fixtures.

A fixed Python standard-library relay carries CDP bytes in memory over Solari's
authenticated command stream. The guest debugger must bind to loopback. The local
bridge uses a random credential and refuses browser-originated/unauthenticated
connections. No public preview port, guest package install or Chrome-directory
export is used. Cleanup terminates owned relays and closes local handles—not
shared Chrome or the VM.

Code: [flow](../lib/cancellations/miro-dom-flow.ts),
[navigation](../lib/cancellations/miro-dom-navigation.ts),
[billing observer](../lib/cancellations/miro-billing-response.ts),
[verification](../lib/cancellations/miro-dom-verification.ts),
[transport](../lib/desktop/private-cdp.ts).
Cross-cutting defenses and residual risks: [security](security.md).
