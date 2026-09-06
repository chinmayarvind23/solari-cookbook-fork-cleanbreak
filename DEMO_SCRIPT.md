# CleanBreak demo

Use a local StreamMax test or the already completed Miro recording. Do not cancel
another real subscription just to record a presentation.

## Prepare

- For the repeatable local demo, install dependencies and Chromium, then run
  `npm run test:one-click`. It produces isolated fixture evidence and a receipt;
  it does not use a real account.
- For the real Miro example, open the existing VERIFIED job using
  `npm run dev:live`, or use its saved recording and receipt.
- Use the **card-blurred copy** when presenting the existing recording. Also review
  names, email, company/account identifiers, URLs and notifications before sharing;
  card blurring alone is not complete privacy review.
- Do not show `.env`, terminal secrets, session capabilities, raw auth state or
  unreviewed screenshots. Keep the original recording/receipt unchanged.

## 60–90 second walkthrough

| Segment       | Show                                                    | Explain                                                                        |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Problem       | Subscription card and renewal terms                     | Cancellation is useful only if future renewal actually stops                   |
| Authorization | One-click authorization copy                            | One scoped attempt, no second approval, no uncertain-click retry               |
| Navigation    | Existing redacted Miro recording or local fixture flow  | The workflow rejects retention alternatives and reaches the real final control |
| Execution     | Recorded final action and job counters                  | One final click; navigation itself does not own destructive authority          |
| Proof         | VERIFIED result, after-billing facts and receipt digest | Fresh independent billing checks—not the click or video—establish success      |

For the completed Miro run, the accurate outcome is: one Business Trial
cancellation, renewal off, access through September 18, 2026, and a verified
$240 yearly renewal avoided. Do not present it as a refund, a customer pilot or a
general provider success rate.

## Evidence to retain

- Original recording, safe sharing copy and any redaction metadata.
- Receipt JSON and a separately retained digest.
- Job identifier and verification result for later lookup.

The web app's recording download serves the **original**, not an automatically
redacted copy. Use the separately prepared file for sharing.

If a run failed, show the failure honestly. A dry-run ending at
`AWAITING_APPROVAL` is navigation evidence, not a completed cancellation.
A StreamMax result is fixture evidence, not Miro evidence. Benchmark figures are
offline safety checks, not customer savings or provider latency.
