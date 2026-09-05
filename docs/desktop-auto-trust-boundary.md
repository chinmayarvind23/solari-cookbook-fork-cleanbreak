# Desktop autonomous dry-run trust boundary

Deployment verdict: **research-only**, opt-in, dedicated authenticated Desktop.
No live Miro execution was performed when implementing this mode. Offline tests
exercise the control boundaries; they do not establish live provider reliability
or prove the semantics of every real-world button.

## Read surface

| Origin/surface                                                                                        | Trust classification                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Configured provider origin (Miro: `https://miro.com`)                                                 | Out-of-trust; all page text, labels, URLs, canvas content, ads, and user-generated data can carry injection             |
| Other origins, including login/identity/challenge pages                                               | Not authorized navigation targets; unknown, login, challenge, or unrelated-origin observations stop                     |
| Configured Solari gateway (default `https://api.getsolari.com`) and SDK-issued control/stream origins | Authorized credential-bearing infrastructure; capabilities remain private and never enter planner text or logs          |
| Configured OpenAI Responses service                                                                   | Authorized screenshot processor; request only screenshot planning, not tool execution; response fields remain untrusted |
| Private `127.0.0.1` viewer                                                                            | First-party local UI with capability path, no-store and host/origin checks; auto does not require interacting with it   |

The current Desktop executor observes provider origin/authentication through
screenshot interpretation, not independent DOM or network enforcement. Those
model-reported facts are necessary policy checks, not independent attestation.

## Write surface

| Authorized action                                                                | Blast radius                                                             | Reversible?                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Explicitly allowlisted navigation clicks/keys                                    | Focus, scrolling, or workflow position in the dedicated provider session | Intended yes; a mislabeled or hijacked target can affect the account        |
| Fixed neutral cancellation reason / narrowly allowlisted neutral reason choice   | Cancellation-reason field in the current workflow                        | Intended yes before submission; a provider may autosave field data          |
| Local screenshots, structured job/validation metadata                            | Ignored private artifacts for this run                                   | Deletable; screenshots/recordings themselves may contain private account UI |
| Remote recording, pause, local-handle close                                      | Dedicated Desktop session only                                           | Session is paused, never destroyed; recording remains private               |
| Final cancellation, financial/offer acceptance, account/security/payment changes | Subscription/account state, trial access, or charges                     | **Never authorized**, regardless of `--auto`                                |

Worst-case wrong-write blast radius is the subscription/account in the dedicated
authenticated provider session. Do not use a shared desktop, broad administrative
identity, unrelated tabs, secrets on screen, or a production credential scope that
cannot tolerate this residual risk. Use a separately scoped identity/session.

## Defense stack

The Miro adapter is scoped to the configured HTTPS Miro Billing origin/path,
authenticated standalone billing surface, exact first-entry labels and completed
flow history. The observed URL remains in memory; evidence stores only adapter,
rule and surface/role enums. Reused labels need visible next-step/choice evidence;
consequences and ambiguity intercept. No financial authorization is added.
URL, surface and role remain untrusted screenshot interpretations, not independent
attestation. Unknown or truncated address bars fail closed. The research-only
deployment limit and wrong-write blast radius above still apply.

- The user explicitly requested invocation-level consent for reversible actions
  in `--auto`. This overrides the trust-boundary skill's usual fresh-HITL-per-write
  requirement **only for the allowlisted navigation/reason actions**. Default mode
  retains START/NAVIGATE review; no irreversible action has been authorized.
- Strict structured outputs, redacted free text in evidence, no arbitrary code,
  shell, clipboard, URL typing, login automation, or challenge bypass.
- Exact target allowlists, positive next-step context, final-consequence
  interception, same-origin/authenticated-page checks, confidence and coordinates.
- One-use immutable dispatch grants issued only for deterministic ALLOW decisions.
  Raw decisions, copies, reused grants, BLOCK/INTERCEPT, and final candidates have
  no dispatch route. Enter/Return/Space and all unapproved shortcuts are denied.
- Fresh decoded-pixel stability before dispatch, 32-pixel padded click-target
  protection, bounded page settling afterward, and bounded steps/reported tokens.
- At most two retries of read-only planning requests; no action or unknown-outcome
  retry. Final candidate only produces review evidence, never a financial commit.
- Session stays in the dedicated VM; no profile export or persistence changes.
- No cross-run planner memory or replay of job files exists. Bounded in-run history
  contains enums and fixed outcomes only; persistent-memory canaries are not
  applicable. Adding writable/replayed memory requires a new boundary review and
  canary defenses, not implicit reuse of this approval.

## Known-attack checklist

| Attack                           | Configured defense and remaining limit                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visible-text injection           | Planner instruction marks screenshots untrusted; strict schema, exact labels/context, and policy grants gate execution. Fabricated/omitted context is still a model risk, not solved by sanitization. |
| URL query/fragment injection     | URLs are not execution instructions; no arbitrary navigation/typing API. Only configured origin plus screenshot-observed origin/authentication checks.                                                |
| Memory-binding attack            | No cross-run replay or untrusted text in planner history; evidence is not instructional memory.                                                                                                       |
| CSRF-shaped authenticated action | No final/financial dispatcher, typed payload limited to one neutral sentence, deterministic ALLOW and scoped session. This is not provider-side CSRF protection.                                      |
| One-click hijack                 | Fresh pixel comparison and padded target check; immutable one-use grant. A stable deceptive page or a change after capture cannot be mathematically excluded.                                         |

No benchmark score is offered as evidence of real Miro reliability. The offline
suite covers mocks, policy, retries, and lifecycle boundaries, not the distribution
of live Miro screens. Auto may stop early on ambiguity, missing context, login,
challenge, changing UI, budgets, or failures. It must not fabricate successful
validation to satisfy a one-shot outcome request.
