# Implementation status

Last reviewed: September 6, 2026. This is the current snapshot, not a milestone
changelog. Implementation history is available in Git.

## Supported paths

| Path                                        | Current status                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Miro Business Trial, one-click product      | One actual web-app cancellation completed and independently verified        |
| Local StreamMax one-click test              | Repeatable dashboard-to-receipt test without external provider calls        |
| Legacy Browser agent/benchmark              | Typed model/planning and two-stage approval regression path                 |
| Legacy Desktop visual dry-run               | Reversible navigation only; final action intercepted; image opt-in required |
| Arbitrary real providers/Miro plan variants | Not established by the current adapter                                      |
| Public multi-tenant deployment              | Not implemented or validated                                                |

## Verified live outcome

The authorized Miro trial run completed entry, benefits, extension rejection,
cancellation selection, reason continuation and neutral reason input. The separate
commit gate acknowledged **one final click**, with **one authorization use**,
**zero destructive retries** and **zero unsafe actions**.

Fresh Billing-page/reload observations and matching account-bound provider
responses established cancellation scheduled, renewal OFF and no future renewal
charge, with access through September 18, 2026. The configured charge was
**$240 yearly**: $240 in annualized avoided renewal charges, not a refund.

A receipt was persisted and its digest validated. A full 38.7-second private MP4
was saved; a separate card-blurred sharing copy was subsequently produced.
The public [Miro walkthrough](docs/media/miro-cancellation.mp4) now contains the
full-page recording with only credit-card details blurred. Its 64.5-second
duration is the 38.7-second original slowed to 0.6x for readability.
Original evidence stays private. [Public outcome summary](docs/media/proof-summary.json).

Explicit VM-local authentication migration preserved the original Chrome
directory. A separate in-memory profile refresh populated the configured Solari
profile at version 2 / 14,828 bytes. That records one successful save, not automatic
bidirectional synchronization or a guarantee against future login expiry.

## Engineering validation

Last full code validation: **951 tests across 42 files passed**, plus typecheck,
format check, production build and secret audit. The deterministic Browser
benchmark records **100/100 runs across 20 scenarios**, with zero false VERIFIED,
unsafe actions or automatic destructive retries.

Coverage includes one-shot claims, concurrent requests, uncertain delivery,
recovery, changed terms/targets, profile protection, private CDP cleanup, Miro DOM
navigation and two-read billing verification. These are bounded test results, not
a production reliability percentage or evidence of a user pilot.

## Known limits

- The current adapter recognizes the observed Miro Business Trial layout; changed
  copy, structures, plans or terms may stop it safely.
- Provider login/MFA is manual. Browser storage-state transfer does not guarantee
  remote authentication, and Desktop/named profiles remain separate stores.
- Miro verification is a fresh page/control observation within the same Chrome
  profile, not a separately authenticated browser process.
- The Miro DOM path makes no model requests, but the shared Desktop configuration
  validator still requires a server-side `OPENAI_API_KEY`.
- Dashboard savings now use validated one-click receipts, counted once per
  subscription and grouped by currency. StreamMax and legacy demo totals are
  excluded. The completed Miro receipt contributes $240/year.
- A prior Canva Browser dry-run stopped at an anti-bot challenge. It did not prove
  Canva compatibility; failed external runs now cannot overwrite authentication.
- SQLite and local private files require persistent storage and one application
  instance. The included deployment scaffold is not a validated public live service.
- No measured pilot-user count, manual-follow-up reduction, operating-cost reduction
  or average live cancellation latency has been established.

## Source

The [README](README.md) provides the public walkthrough and local entry points.
The [source guide](docs/code-map.md) explains the implementation layout.
