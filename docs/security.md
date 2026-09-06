# Security and trust boundaries

CleanBreak is a dedicated, single-operator research integration. It is not a
general-purpose autonomous account agent or a multi-tenant financial service.

## Authority

The user controls the subscription and explicitly authorizes one cancellation.
The server builds its 15-minute scope from configuration: provider/account and
session bindings, plan, amount/currency/interval, preserved-access policy and a
maximum of one destructive action. Provider text, model output, request fields,
profile contents and old job history cannot expand that scope.

Live execution requires exact `CLEANBREAK_DRY_RUN=false`,
`CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true` and
`CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL=true`, plus operator authentication.
The primary product uses initial one-shot authorization, not repeated per-step
approval. The legacy supervised dry-run still requires START/NAVIGATE review;
`--auto` waives navigation prompts only, never final-action interception.

## Surfaces and permitted writes

| Surface                       | Trust and allowed effect                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Operator UI/API               | Untrusted HTTP input; authenticated exact-origin JSON, strict schema, server-built terms and idempotency       |
| Configuration/SQLite          | Trusted authority/checkpoints; immutable authorization and atomic versioned writes                             |
| Miro Billing DOM/GET response | Untrusted provider data; exact configured origin/account, recognized schema/structure, no arbitrary API writes |
| Solari controls               | Credential-bearing transport for the dedicated VM; no public debugger or exposed capability URLs               |
| Model service                 | Legacy opt-in only; untrusted proposals, no tools/write authority; screenshot uploads default off              |
| Auth state                    | Dedicated credentials; explicit checked refresh only, never failed-run cleanup                                 |
| Evidence/recording            | Private ignored files; authenticated access, not proof or authority by themselves                              |

Allowed product writes are recognized cancellation navigation, neutral reason,
one scoped final attempt and local audit evidence. Retention acceptance, paid
changes, downgrades, extensions, payment/security changes, account deletion,
credential automation and challenge bypass are outside that authority.

## Durable final-action boundary

- The navigator returns a candidate; it cannot spend the final authorization.
- Fresh identity, material terms, unique target and local target-aware screen
  stability must agree with the authorized action.
- SQLite uses transactions, resource locks, version checks and worker leases.
  Claim consumes authority and persists COMMITTING before input dispatch.
- The driver requires an immutable one-use dispatch grant; raw/copied decisions
  or grants cannot authorize a final click.
- Attempted means the durable reservation was made; executed means the SDK
  acknowledged the click. Missing acknowledgement is never invented.
- Recovery after possible dispatch proceeds only to verification. Unknown input
  delivery is not retried, even when the observed account still appears active.
- Only fresh matching stopped-renewal evidence plus one acknowledged execution
  creates a product success receipt.

See [state](../lib/cancellations/state.ts), [policy](../lib/cancellations/policy.ts),
[dispatch](../lib/cancellations/dispatch.ts) and
[service](../lib/cancellations/service.ts) for the enforced contracts.

## New attempts and recovery

A fresh attempt requires explicit user authorization and an eligible predecessor:
FAILED, expired authorization, every safety/use counter zero and a known
navigation-stop reason. The subscription/financial scope must match; a replacement
session can be bound only by the new authorization. The previous record is not edited.

Consumed, uncertain, verified and active jobs cannot be reset through this flow.
Resource/idempotency locks remain authoritative across requests and VM changes.
Response loss retains the existing request key. Do not delete SQLite, clear locks
or resubmit new keys to bypass uncertainty. Terminal StreamMax reset is fixture-only.

Worker recovery uses 120-second leases refreshed every 20 seconds. Interrupted
navigation does not replay uncertain inputs. COMMIT_ARMED still requires fresh
target revalidation; the DOM adapter will not reconstruct unproven flow history.

## Input and image handling

The default Miro adapter executes static local DOM readers and recognized targets,
not page-generated code or free-form model instructions. It uses no screenshot,
OCR, video or private text uploads to a model. The private CDP relay is loopback-only,
random-credential-protected and rejects browser-originated connections.

Local stability allows at most 0.5% changed pixels at RGB channel threshold 16;
a padded target/corridor must remain unchanged. Decode/dimension failures stop.
The legacy visual path has a narrowly scoped offer-illustration exclusion for
scroll/decline only, never final commit. Neither pixels nor DOM checks eliminate
all post-check races or malicious same-origin UI.

## Attack checklist

| Threat                         | Defense / remaining limit                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Visible-text injection         | Static schema/structure, deterministic policy, no page-derived authority; deceptive same-origin content remains a risk                |
| URL/query/fragment injection   | Exact provider/account binding; no arbitrary navigation or command targets; billing GET query data never expands scope or enters logs |
| Tainted memory                 | No cross-run planner instruction memory; history is immutable evidence, not instructions                                              |
| CSRF-shaped writes             | Operator authentication, exact Origin/Host, JSON/body validation, server scope and one-use claims                                     |
| One-click hijack               | Fresh target/material-term checks and local pixel guard; post-capture races cannot be mathematically excluded                         |
| Failed-state profile overwrite | Attachment separated from persistence; explicit positive-auth refresh, not generic cleanup                                            |
| Evidence disclosure            | Ignored paths, private routes, safe metadata, build sanitization and sharing-copy redaction                                           |

No persistent planner-memory canaries are needed because no such memory is used.
Adding replayed/writable agent memory or broader provider actions requires a new
boundary review; existing user authorization does not cover that expansion.

## Operational privacy

Keep API keys, operator/provider passwords, cookie/storage values, raw SDK bodies,
headers, control/stream URLs and private billing text out of logs/source/client
bundles. Safe diagnostics are fixed codes, booleans, numeric counts and hashes.
A compound session ID can itself carry capabilities; keep it private.

Recordings may contain personal/payment UI. Redact a separate copy before sharing,
preserve the original and receipt, and do not describe edited footage as original
evidence. Card blurring alone is not a full personal-data scrub.

Shared VM cleanup closes owned control handles only. It does not pause/destroy the
VM or erase auth. POSIX file modes do not replace Windows ACLs. Back up SQLite and
private artifacts together and do not expose a live instance publicly without
persistent storage, TLS, authentication and a separate deployment review.
