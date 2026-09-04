# External profile persistence trust boundary

Scope: protect a dedicated provider profile against replacement by challenge,
unauthenticated, unrelated, or otherwise unverified browser state. This change is
validated offline; no external provider is visited as part of implementation.

## Read surface

| Origin/surface                                                                                               | Trust classification                                                                |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Configured external provider origin (Canva in the reported incident), including challenge/identity redirects | Out-of-trust; page text, actions, and URL components may carry injection            |
| Configured Solari API via the installed SDK                                                                  | Credential-store service boundary; metadata is not proof of provider authentication |
| Developer-owned StreamMax fixture origin                                                                     | In-trust deterministic test surface, not evidence of real-provider compatibility    |
| Local job database and evidence                                                                              | Historical observations, not authority to refresh credentials                       |

## Write surface

| Action                                                  | Blast radius                                                     | Reversible?                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| Attach profile to isolated browser session              | Exposes that dedicated profile to the selected provider session  | Session can close; disclosure cannot be undone      |
| Replace Solari profile state                            | Can destroy the working authentication snapshot for that profile | Recovery of old versions is not assumed             |
| Save local safe job metadata/screenshots                | Job/evidence store; screenshots may contain private UI           | Locally removable; no storage-state JSON is written |
| Submit cancellation or change account/security settings | Provider account/subscription                                    | Not authorized by this dry-run workflow             |

## Defense stack

- Separate attachment and save authority. External CLI runs have no refresh flow,
  so they cannot save even with the fixture persistence environment setting enabled.
- Content handling is layered: structured observations, fixed blocker detection,
  exact origin/page allowlists, and the existing deterministic action policy.
  A sanitizer or absence of a blocker is never affirmative authentication proof.
- A future refresh adapter must be trusted server code with provider-specific
  positive authentication checks, explicit opt-in and fresh human save confirmation.
  It must not treat model confidence, page instructions, or generic billing words
  as authentication. The runtime rechecks after confirmation and state capture.
- Tool scope excludes credentials automation, challenge bypass, cancellation
  submission, arbitrary URLs, and planner-initiated profile writes. Profiles are
  dedicated credentials in isolated browser sessions; no broad production identity.
- Profile values are never logs or model memory. Only fixed reason codes and the
  saved flag are persisted here. No planner-writable persistent memory is added;
  memory canaries are therefore not applicable to this change. Any future memory
  feature needs provenance/canaries before deployment; do not insert them into cookies.
- Irreversible provider writes still require their separate human approval boundary.
  A refresh confirmation does not approve cancellation.

## Known-attack checklist

| Attack                           | Defense / limitation                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visible-text injection           | Planner cannot grant save permission; trusted refresh checks and fresh confirmation required. Generic page-text matching alone is insufficient.         |
| URL-fragment/query injection     | Exact authenticated URL allowlist and origin comparison in save eligibility; arbitrary planner-selected URLs cannot opt in.                             |
| Memory-binding / tainted state   | No planner-writable memory; captured state is not reused as proof of auth. Default-off write gate prevents challenge state replacing credentials.       |
| CSRF-shaped authenticated writes | Save authority is separate from browsing; dry-run final actions remain prohibited. This patch does not claim comprehensive provider-side CSRF defenses. |
| One-click hijacks                | Deterministic action policy and approval boundary; profile confirmation followed by page revalidation. No claim of general browser hijack immunity.     |

## Benchmark fit and deployment verdict

The StreamMax benchmark validates fixture logic, not Canva authentication, anti-bot
compatibility, or real-provider reliability. No general browser benchmark is offered
as evidence here. External-provider integration remains **research-only**: no live
refresh adapter is enabled, and no external retry is authorized by this fix.
