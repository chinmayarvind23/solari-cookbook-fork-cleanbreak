# No-image Miro cancellation and verification

The operator prohibited sending screenshots and explicitly authorized completion
of the configured Miro cancellation. No screenshots, video, OCR, full page text,
cookies, storage state or credentials are sent to a model. Images remain local
only for the existing pixel stability guard and private operator recording.
Verification never takes a screenshot and never uses the recording as proof.

## Observed outcome

One real web-app Cancel button request completed the configured Business Trial
flow: one authorization use, exactly one acknowledged final click, zero retries
and zero unsafe actions. A fresh Billing tab and reload independently observed
matching provider non-renewal state. The persisted job is VERIFIED, with an
integrity-checked receipt and a valid private full-flow MP4. The configured named
Solari profile was separately populated through an explicit authenticated refresh.
This establishes one observed trial flow, not every Miro plan or layout.

## Trust boundary

| Surface                                      | Authority and defense                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Local configuration and SQLite authorization | Trusted scope; page content cannot change provider/account, price, interval, access policy or one-click limit                 |
| Solari Desktop infrastructure                | Authenticated SDK transport; guest debugging must bind to loopback only                                                       |
| Miro Billing DOM                             | Untrusted content; exact configured account path, recognized structure, target hit test, local hash and pixel guard           |
| Naturally loaded billing GET response        | Exact HTTPS origin/account receiver path, GET/200/JSON, bounded body and schema projection; no API write/request is generated |
| VM-local auth migration                      | Explicit operator opt-in; original and prior dedicated directories preserved, only selected login stores copied inside the VM |
| Named Solari profile upload                  | Explicit separate command; exact profile name and two positive auth checks, IndexedDB-capable state in memory only            |
| Local artifacts                              | Private ignored paths; screenshots and recording are never model inputs or public assets                                      |

The initial web-app authorization covers reversible navigation, offer rejection,
a fixed neutral reason and one final cancellation attempt. It does not cover
retention acceptance, downgrade, extension, new charges, payment changes, account
deletion, arbitrary credential entry or challenge bypass. Failed/uncertain jobs
cannot obtain new destructive authority from cleanup or verification.

| Attack                       | Defense                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visible-text injection       | Static local extraction and ordered recognized controls; unknown surfaces fail closed, no model executes page instructions                                                                                   |
| URL query/fragment injection | Billing page requires exact configured HTTPS origin/path without credentials/query/fragment. The observed billing GET may have a query, but it is never logged, followed or used to broaden the account path |
| Memory binding               | No planner instruction memory; durable history records completed stages, never instructions or authority to retry                                                                                            |
| CSRF-shaped actions          | Operator/same-origin gates, immutable scope, resource lock and atomic one-use final claim                                                                                                                    |
| One-click hijack             | Fresh local DOM/material-term hash, coordinate hit test and 0.5% pixel stability with padded target protection; unknown final outcomes never retry                                                           |

Residual risks include provider UI/API changes, malicious same-origin content,
the shared authenticated browser context and the unavoidable interval between
revalidation and input. This remains a dedicated opt-in, research-only integration;
neither offline benchmarks nor this single live result establish general reliability.
No persistent planner-memory canaries apply because no such memory is used.

## Bounded deterministic flow

The product path defaults to this DOM adapter when
`CLEANBREAK_ALLOW_SCREENSHOT_MODEL_UPLOADS` is not explicitly `true`. The legacy
image planner is not a fallback. No model calls or planner token budget are used.

1. Authenticate and match the configured Miro Business Trial, amount, currency,
   interval and term against recognized Billing DOM plus its account response.
2. Traverse the observed entry, benefits, extension decline, cancellation radio
   (not the default downgrade), reason continuation and neutral reason input.
3. Stop the navigation loop at the final reason-submit control. Only the existing
   separate final dispatcher may consume the scoped one-use authorization.
4. Revalidate the final target and unchanged material terms, atomically claim the
   attempt and send one click. An unknown result is never replayed.
5. Independently verify using a new read-only page and a reload; only VERIFIED
   creates a receipt. Recording success is not billing success.

The loop has at most eight turns with bounded read-only settling polls. Each
input stage occurs at most once; polling does not retry clicks. Unexpected stage
order, labels, fees, immediate access loss, duplicate targets or instability stop
the job. Crash recovery does not reconstruct/replay unproven DOM navigation.
The free-trial terms basis is specifically Miro's documented no-charge cancellation
with access through the trial end, not a generic inference that cancellation is free.

Primary flow reference: [Miro Business Plan 14-day trial documentation](https://help.miro.com/hc/en-us/articles/15392587152786-Business-plan-14-day-free-trial).
The actual observed trial has a reused “Cancel subscription” continuation before
the distinct reason-submit control; ordered history and exact structure distinguish
them. Other paid-plan/downgrade flows are outside this adapter's scope.

## Private connection and verification

Installed standard `playwright-core` connects with `noDefaults: true` through a
loopback, random-credential-protected bridge over Solari's authenticated command
stdin/stdout stream. A fixed Python standard-library relay keeps protocol bytes
in memory. No guest packages, public preview URLs or auth files are exported.
Browser-originated/unauthenticated bridge connections are rejected; relay cleanup
waits for owned command termination before closing the local Desktop handle.
Patchright remains available for existing local fixtures/helpers, but is not used
for shared Desktop CDP: its Fetch interception stalled freshly opened Miro tabs.

Verification reads the provider's naturally loaded, exact-account Billing GET
response twice. Only known trial/status/currency/interval/date/renewal fields survive
schema projection. `cancelAtPeriodEnd` plus trial status establishes scheduled
non-renewal, with `periodEnd` preserving access. A missing amount or success toast
is insufficient. Both server projections and configured-account UI identity must
agree. Login, dialog, unsupported, missing or conflicting evidence is inconclusive.
The verifier opens a fresh page/control observation in the **same authenticated
Chrome profile**, not a newly authenticated browser process.

## Developer commands

- `npm run desktop:verify`: read-only verification, safe facts only, no click,
  authorization, screenshot, receipt issuance or profile save.
- `npm run desktop:verify -- --enable-dom`: explicit setup only for a positively
  identified dedicated Chrome root. Gracefully restarts it with loopback debugging;
  no force kill, profile deletion, VM pause or destruction.
- `npm run desktop:profile-migrate -- --copy-default-auth`: explicitly authorized
  one-time migration for an already-authenticated **default** Chrome profile.
  Copies only selected cookie/origin stores and bootstrap metadata inside the same
  VM, preserves original/prior dedicated directories and restarts dedicated Chrome.
  No password vault, history, payment database, downloads or browser directory
  export. Do not rerun once migration succeeded.
- `npm run desktop:profile-save`: explicitly upload the authenticated Desktop
  context's `storageState({ indexedDB: true })` directly to the exact existing
  `SOLARI_PROFILE_NAME`. Keep one recognized authenticated configured Billing tab
  open; multiple matches fail closed. No storage-state JSON on disk or in logs.
- `npm run profile:list`: safe profile name/id/version/size confirmation.

Migration/setup/save reject active cancellation jobs. Named profile refresh is
never generic browser cleanup and must not overwrite a good profile after a
login/challenge failure. Local control cleanup never pauses/destroys the VM;
pause it manually in Solari when finished to stop compute billing.

After successful cancellation, do **not** create another attempt. Start the local
app with `npm run dev:live`, open its exact printed origin and read the existing
VERIFIED card, receipt and private recording. Opening the dashboard is not a
cancellation authorization.
