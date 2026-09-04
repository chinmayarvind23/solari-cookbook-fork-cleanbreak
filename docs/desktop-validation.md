# Desktop real-provider validation (developer-only)

This is an additional, screenshot-based **research-only** executor. Browser-based
StreamMax navigation, approval, commit, verification, receipts, and Browser profile
overwrite protections remain in place. Desktop mode never reads or saves a Solari
Browser profile and has no cancellation commit path. Miro is not hard-coded.

## SDK contract checked

Implementation uses installed `@solarisdk/desktop@0.1.2` and its `@solarisdk/core`
types/implementation, checked against the [Solari Desktop SDK reference](https://docs.getsolari.com/sdk/typescript/vms).
`DesktopClient.connect(id)` resumes a paused existing VM; `vm.connect()` opens the
control channel. `health().ready`, PNG screenshots, display dimensions,
`mouse.click`, `keyboard.type/press`, `stream.start`, `record.start/stop`,
`downloadUrl`, `pause`, and `close` are supported. `DesktopClient` has no `close`:
the control connection belongs to the VM handle and is explicitly closed.

The installed `mouse.scroll(x, y, options)` has no delta or direction option.
Rather than guess an RPC or execute shell commands, `scroll` decisions stop with
`SCROLL_DELTA_UNSUPPORTED`. The planner can request Page_Down/Page_Up instead.

The SDK stream is **WSS/RFB**, not a browser-ready HTTPS page. The local viewer
uses the installed noVNC 1.7.0 ESM API directly. This version's module entry point
is `core/rfb.js`, not the older optional-peer path inside Solari's `mountDesktop`.
No private stream URL is invented, committed, or printed.

## Configuration

Run `npm install` from the repo root. Set these values in the untracked `.env`:

```env
CLEANBREAK_REAL_PROVIDER_EXECUTOR=desktop
CLEANBREAK_DRY_RUN=true
CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true
SOLARI_API_KEY=<your API key>
SOLARI_DESKTOP_ID=<existing dedicated desktop VM ID>
SOLARI_DESKTOP_BASE_URL=https://api.getsolari.com
OPENAI_API_KEY=<your API key>
OPENAI_MODEL=gpt-5.6
CLEANBREAK_AGENT_MAX_STEPS=20
CLEANBREAK_AGENT_MIN_CONFIDENCE=0.70

CLEANBREAK_REAL_PROVIDER_NAME=Miro
CLEANBREAK_REAL_PROVIDER_URL=https://miro.com/app/settings/company/YOUR_COMPANY_ID/billing
CLEANBREAK_REAL_PROVIDER_PLAN_NAME=Business Trial
CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS=<actual renewal price in cents>
CLEANBREAK_REAL_PROVIDER_CURRENCY=USD
CLEANBREAK_REAL_PROVIDER_INTERVAL=MONTHLY
SOLARI_PERSIST_PROFILE_STATE=false
```

The final five provider fields are the same existing provider configuration used
by Browser validation; use the real configured price/currency/interval, not the
example labels if they differ. Optional `CLEANBREAK_REAL_PROVIDER_NEXT_RENEWAL`
and `CLEANBREAK_OPENAI_TIMEOUT_MS` retain their existing meaning. Browser profile
name/ID are not used by this executor. The URL defines the allowed origin; the
script **does not launch a browser or navigate the address bar**. Leave the
correct provider page open yourself before starting.

## Prepare and authenticate the VM

1. Manually create a dedicated Solari Desktop VM using Solari's console or its
   documented `DesktopClient.create()` workflow. Use a lifecycle that pauses,
   not kills, on timeout. Store its returned ID privately in `.env`; the ID is
   an opaque capability and must not be posted or committed.
2. The SDK creation option is `lifecycle: { onTimeout: "pause", autoResume: false }`.
   The documented office template can host a browser; inspect available templates
   in your Solari account. This project never creates or destroys VMs automatically.
3. To open an **existing** VM interactively, run:

   ```bash
   npm run desktop:open
   ```

   Open the private `http://127.0.0.1:<port>/<random-path>/` link printed in your
   terminal. In this manual-only viewer, open Firefox/Chromium if necessary, log
   into your provider, complete MFA yourself, and leave its billing page visible.
   Verify the intended account and trial/plan. Do not cancel anything. Return to
   the terminal and press Enter to pause the VM. This helper does not screenshot,
   record, call a planner, read credentials, or export browser state.

4. Close unrelated tabs/apps and make sure no credentials, password manager,
   recovery codes, notifications, or other private information is visible before
   validation. Use a dedicated provider account/VM, not a general-purpose desktop.

## Validate and watch live

```bash
npm run real-provider:desktop-dry-run
```

`npm run real-provider:dry-run` also selects this executor when the mode is
`desktop`; its default remains `browser`.

The command requires explicit dry-run mode, account authorization, an existing VM
ID, and an interactive terminal. It reconnects/resumes, opens the control channel,
and polls readiness at most 30 times. It prints a **private loopback viewer link**.
The validation viewer is read-only and does not resize the guest display. Remote
stream/playback capabilities live only in process/browser memory; do not share
even the local link. The server checks its loopback Host, same-origin requests,
and a random path, sends no-store headers, and closes at completion.

Watch the live view and type `START` only after checking the correct authenticated
provider page. This explicitly allows screenshots, recording, and sending the
visible screen to the configured OpenAI model. No login/MFA automation is included.

For each proposed navigation input, inspect the screen and coordinates and type
the exact `NAVIGATE <step> <screenshot-hash>` phrase shown in the terminal. This
confirms **one non-destructive input only**, not cancellation. Any other input,
EOF, Ctrl+C, or five-minute confirmation timeout stops. The screen is recaptured
and must be byte-identical before dispatch; animations or clock updates may
therefore stop a run with `SCREEN_CHANGED`. There is no automatic input retry.

The visual planner receives the PNG, dimensions, goal, and last six action-result
summaries using OpenAI Responses strict Structured Outputs. It cannot emit code.
Primary stop is the cancellation boundary; safety limits are 20 steps by default
(configurable 1–30), 20,000 total reported model tokens, confidence threshold,
policy rejection, and interruption. The intentionally shorter-than-general-CUA
budget limits risk for this first provider-validation milestone.

Any cancellation-labelled click is conservatively intercepted, including a model
misclassification as ordinary `click`. **This may stop at an intermediate
cancellation entry control rather than the provider's ultimate confirmation.**
`AWAITING_APPROVAL` here means a candidate is ready for human inspection, not that
the complete cancellation flow or its terms have been proven. There is no button
or command to commit it in Desktop mode.

## Evidence and recording

Each run uses a new ignored directory `artifacts/desktop/<run-id>/`:

- `step-NN.png`: private screenshots of the observed screens, one per agent step.
- `job.json`: private VM ID, structured decision type/coordinates/confidence,
  screen dimensions, policy/action results, final candidate, safe live/recording
  references, recording guest path/status, pause/close outcome, and safety counts.
- `validation.json`: written **only** for `AWAITING_APPROVAL` after pause and close
  succeed. It uses a hash reference instead of the capability-bearing VM ID.

Free-form model reasoning/visible text/type values are withheld from persisted
decisions (except the one fixed neutral cancellation reason). They could echo
secrets, account data, or injected instructions. Inspect the private screenshot
for target text. Raw SDK errors, credentials, browser/session state, signed stream
and recording URLs are not logged or included in the validation artifact.

Recording starts only after `START`. It uses `record.start({ fps: 10, format:
"mp4", path: "/tmp/cleanbreak-<run-id>.mp4" })`. Cleanup calls `record.stop()`,
obtains a private download URL when a nonempty recording is available, then pauses
the VM and closes control. The local viewer stays up for optional recording review
after the VM is paused; press Enter to close it. Later retrieval can use the
recording guest path in the private job record with Solari's `downloadUrl` API.
Recording failures are reported, not fabricated as success.

All evidence is ignored by Git. Do not force-add it: screenshots/recordings can
contain personal account UI even though no storage state is exported. Private VM
IDs require protected local storage; POSIX file modes do not replace Windows ACLs.
Only manually reviewed, sanitized validation summaries are suitable for sharing.

Example final terminal metadata (illustrative, not a live test result):

```json
{
  "executor": "desktop",
  "state": "AWAITING_APPROVAL",
  "stopReason": "FINAL_ACTION_BOUNDARY",
  "evidence": "artifacts/desktop/<run-id>/job.json",
  "validation": "artifacts/desktop/<run-id>/validation.json",
  "recordingStatus": "AVAILABLE",
  "paused": true,
  "controlClosed": true,
  "destructiveClicksExecuted": 0,
  "unsafeActionsExecuted": 0
}
```

Errors also attempt pause (with a gateway fallback) and close. If pause fails,
status is FAILED, no validation artifact is emitted, and you must pause the VM
manually in Solari. A killed host process/network outage cannot guarantee cleanup;
set the VM's server-side idle lifecycle to pause. Never destroy it to recover login.

## Trust-boundary memo

| Read surface                                 | Trust                                                         |
| -------------------------------------------- | ------------------------------------------------------------- |
| Configured provider and detectable redirects | Out-of-trust; every screenshot/URL/label may carry injection  |
| Dedicated desktop GUI and notifications      | Out-of-trust observations, not authority                      |
| Solari lifecycle/control/stream services     | Credential-bearing SDK boundary; API keys stay server-side    |
| OpenAI Responses                             | Approved model service receiving screenshots only after START |

| Write                                                                       | Blast radius                                                    | Reversible?                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| One approved mouse/key/neutral-type input                                   | Current provider tab; a wrong click can affect the subscription | Not assumed; require fresh review          |
| Recording/screenshots                                                       | Private local evidence and VM recording file                    | Removable, but disclosure cannot be undone |
| Pause/resume                                                                | Dedicated VM machine state and compute lifecycle                | Resume supported                           |
| Cancellation, account deletion, security changes, offers, profile overwrite | Provider account/authentication                                 | Not authorized or dispatched               |

Defense stack: dedicated VM/session isolation; bounded observations; strict action
schema; deterministic allowlist using existing CleanBreak target classification;
fresh human input approval; screenshot freshness check; no code/shell/clipboard
tool; no final-action dispatcher; bounded loop and fail-closed error results;
no planner-writable persistent memory. Memory canaries are not applicable here:
the six-item history is process-local fixed action outcomes, never an instruction
store. Any future durable model memory needs provenance/canaries before deployment.
OpenTelemetry is not installed, so no OTel spans are fabricated.

| Known attack                    | Defense / remaining limitation                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Visible-text injection          | Structured schema + allowlist + fresh human review; no sanitizer-alone claim                                                         |
| URL fragment/query injection    | No address-bar/type navigation; origin mismatch or unknown stops; visual origin reading is fallible                                  |
| Tainted-memory binding          | No persistent planner memory or profile writes; fixed bounded action history                                                         |
| CSRF-shaped authenticated input | Fresh human navigation review; no arbitrary URLs/typing, Enter, or final dispatcher; not comprehensive provider-side CSRF protection |
| One-click hijack                | Denylist/allowlist, explicit review, screenshot equality before dispatch; visual coordinate safety is not mathematically guaranteed  |

No Browser/StreamMax or general computer-use benchmark proves real-provider visual
reliability. Verdict: **research-only, human-supervised**. A human can misread a
screen and a provider can change after capture; do not interpret the zero policy
counter as independent evidence of every remote side effect. No live Miro run or
cancellation was performed to validate this code.

Worked offline trace: screenshot of Billing → model proposes Billing click with
high confidence → policy requests human review → unchanged screen and confirmation
→ navigation returns → new screenshot → cancellation candidate → INTERCEPT →
AWAITING_APPROVAL → record stops → VM pauses → control closes. Recorded reasoning
is withheld; the policy result explains each dispatch/stop. Tool failure produces
`ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY` and ends the loop, never a blind retry.

What to read next: Lesson 27 (prompt injection), before extending actions against
untrusted provider content.
