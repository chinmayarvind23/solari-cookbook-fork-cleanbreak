# Fresh starts, recording and profile state

The dashboard now reads current workflow state from the server. Browser tickets
are scoped to the configuration, not just the provider name. Eligible failures
before any destructive claim appear as collapsed history rather than the active
FAILED card. Reloading never creates a job. An explicit Cancel click can authorize
the same subscription in a replacement VM, without modifying the old authorization.
Provider, account/plan, price, currency, interval and access policy still match.
Locked active/uncertain outcomes survive VM replacement and block duplicates.
The submitted configuration digest prevents a stale card authorizing new terms.

The product worker opens the configured Billing URL in the existing Chrome profile
automatically; no viewer or terminal navigation is required. The shared launcher
checks a live browser process and rendered screenshot. One separate recorder
handle spans navigation, final-click revalidation/dispatch and independent
verification. Navigation no longer stops this product-owned recording. Final
cleanup saves a bounded, validated MP4 at the fixed private job path and closes
the recorder. The authenticated download route exposes no signed SDK URLs. The
UI polls while the recording is being saved, even if verification has finished.
Failed runs are labeled attempt recordings, not full successful cancellations.

## Authentication is not job state

- SQLite owns cancellation jobs, immutable authorizations and receipts. Never put
  them inside a browser authentication profile or clear them to make a retry work.
- Chrome in the dedicated Desktop owns its VM-only `/tmp/cleanbreak-chrome` login.
  Normal handle cleanup does not delete it or pause/destroy the VM.
- Solari Browser's named profile owns Playwright storage state. The installed
  Desktop SDK has no `storageState()`/browser-profile save operation; its filesystem
  is not a Playwright state object. Do not upload Chrome files as profile JSON.
- `npm run profile:login` is the existing supported local-authentication upload:
  capture IndexedDB/cookies/localStorage in memory after explicit confirmation,
  save to the exact configured named profile, never log or write state JSON.
  It does not currently import/export the Desktop's Chrome authentication.

Read-only inspection in this task found the configured named profile
at version 1 / 0 bytes, while the current Desktop had a Chrome profile and showed
authenticated Miro Billing. Those are different stores. This patch does **not**
claim that named-profile/VM synchronization or live cancellation is complete.
The external-provider overwrite protections remain unchanged.

## Trust-boundary amendment

Read surfaces remain untrusted Miro pixels, authenticated Solari infrastructure,
OpenAI screenshot processing only with explicit authorization, and first-party SQLite state. Writes are
limited to the configured Billing navigation, already-authorized cancellation
flow, one scoped final attempt, and ignored private evidence/recording files.
An injection-driven wrong click affects the dedicated subscription/account;
recordings can contain private billing UI and remain operator-only.

The user explicitly requested autonomous navigation and one initial scoped
authorization instead of repeated navigation approval. Deterministic policy,
same-scope checks, one-use grants, fresh final revalidation and independent
verification remain. No credentials are typed and no challenge is bypassed.

| Attack                       | Defense                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Visible-text injection       | Strict observation schema and target policy; page content cannot authorize recording paths, new scope, or final retries |
| URL query/fragment injection | Fixed configured Billing URL and private fixed artifact paths; no page-supplied command or download URL                 |
| Memory binding               | No persistent planner instruction memory; SQLite history is immutable evidence, not authority to retry                  |
| CSRF-shaped writes           | Same-origin/operator gates, configuration digest, resource locks and one-shot dispatch                                  |
| One-click hijack             | Fresh screen/target and material-terms checks; screenshot interpretation still has residual model/TOCTOU risk           |

No persistent planner-memory canaries are needed because no such memory is used.
Verdict: **research-only**, dedicated opt-in account/session. Offline tests and
local StreamMax execution do not establish live Miro completion or a full Miro
recording. Named-profile synchronization remains outstanding.

The environment rejected a subsequent private billing screenshot upload to
OpenAI. Further model-based live checks are paused pending explicit permission;
the rejected operation was not rerouted through another tool or endpoint.
