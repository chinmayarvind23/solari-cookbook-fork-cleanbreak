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
SOLARI_DESKTOP_SESSION_ID=
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
validation executor **does not launch a browser or navigate the address bar**. Leave the
correct provider page open yourself before starting.

## Prepare and authenticate the VM

1. In the untracked repo-root `.env`, set `SOLARI_API_KEY` and
   `SOLARI_DESKTOP_BASE_URL=https://api.getsolari.com`. Remove the ambiguous old
   `SOLARI_DESKTOP_ID`; it is no longer used. Leave `SOLARI_DESKTOP_SESSION_ID`
   empty so all commands use the local session reference. Clear any inherited
   shell override too. Do not copy a console slot such as `vm_123001` into the new
   variable: the SDK needs its exact session ID, not a guessed VM identifier.
2. Create the dedicated session once and verify it:

   ```bash
   npm run desktop:create
   npm run desktop:check
   ```

   Creation uses the installed SDK's `"default"` template, `1280x720`, 2 CPUs,
   4096 MiB RAM, a one-hour rolling idle timeout, no recording, and
   `lifecycle: { onTimeout: "pause", autoResume: false }`. This is a real provider
   resource and may incur normal Solari usage charges when **you** run the command.
   Account capacity/template availability is reported by the SDK, not assumed
   from a console label; creation errors are sanitized and are not retried here.

   The returned `Desktop.sessionId` is an alias of `Desktop.id`. Creation prints
   those exact values and `expiresAt`, closes the initial handle, then reconnects
   using the exact returned `sessionId`, opens control, and requires
   `health.ready === true`. Only then does it print `CONNECT_ROUND_TRIP_OK` and
   write `.cleanbreak/desktop-session.json` with **only** `sessionId`, `createdAt`,
   and `expiresAt`. `.cleanbreak/` is ignored by Git. Never share or commit the
   file: the SDK describes the compound session ID as an opaque capability.

   Creation pauses the session in cleanup, including on failed verification when
   its ID is available; it never destroys it. An existing local state file is
   never overwritten. If creation fails after returning metadata, keep the
   printed exact ID privately and pause the session in Solari. Do not blindly
   create duplicates. You can explicitly set the returned compound ID in
   `SOLARI_DESKTOP_SESSION_ID` and use `desktop:check` to diagnose it. If the ID or
   expiry is missing/invalid, no local reference is saved. A failed readiness check
   is not reported as success, and no guessed ID is substituted.

   `desktop:check` resolves the same ID, calls `get`, reconnects, opens control,
   and checks health once. It prints `DESKTOP_CONNECT_OK`, `sessionId: ...`, and
   `ready: true` only on success; errors expose a fixed stage, never raw SDK data.
   It closes its local handle without pausing/destroying the session. Since
   `connect()` resumes paused sessions, the check can leave it running; pause it
   in Solari when done if you aren't proceeding to manual authentication.

   Resolution is shared by `desktop:type`, `desktop:open`, `desktop:check`, and
   Desktop validation: nonempty `SOLARI_DESKTOP_SESSION_ID` wins, otherwise load
   the locally saved reference. There is no fallback to `SOLARI_DESKTOP_ID` or to
   a different session after a failed connection. Console-style IDs supplied as
   environment overrides are rejected. A short ID returned by `create()` may be
   saved only after its successful SDK round-trip, not inferred from its shape.

3. To open the saved **existing** session interactively, run:

   ```bash
   npm run desktop:open
   ```

   Open the private `http://127.0.0.1:<port>/<random-path>/` link printed in your
   terminal. After connection and health readiness, this command launches Firefox
   at `CLEANBREAK_REAL_PROVIDER_URL`, using the existing provider URL validation
   (public HTTPS, no embedded credentials, query/fragment removed). It waits 1.5
   seconds and checks health again before starting the stream and viewer. It
   prints `Desktop connected.`, `Launching provider in Firefox...`, and
   `Browser launched.` without exposing the provider URL or account identifiers.
   In the manual-only viewer, log into your provider, complete MFA yourself, and
   leave its billing page visible.
   Verify the intended account and trial/plan. Do not cancel anything. Return to
   the terminal and press Enter to pause the VM. This helper does not screenshot,
   record, call a planner, read credentials, or export browser state.

   If Firefox launch fails, the helper probes for Firefox absence and executable
   presence at known Chromium/Chrome paths before allowing one fallback launch.
   Probes use fixed commands/paths only, never provider URLs or user input. If
   absence/presence cannot be established, it fails with `Desktop browser launch
failed.` and does not present a viewer. Nothing is installed automatically.
   Health readiness and the startup delay are not proof that the GUI rendered;
   visually inspect the viewer. No screenshots are taken to check rendering.

4. Close unrelated tabs/apps and make sure no credentials, password manager,
   recovery codes, notifications, or other private information is visible before
   validation. Use a dedicated provider account/VM, not a general-purpose desktop.

## Browser launch diagnostics (developer-only)

For a launch failure with a healthy session, run this temporary developer command
first (it uses **example.com**, not the configured provider):

```bash
npm run desktop:browser-diagnose
```

It connects to the saved session, requires initial health readiness, and probes
`firefox` on PATH plus `/usr/bin/firefox`, `/usr/bin/chromium`,
`/usr/bin/chromium-browser`, and `/usr/bin/google-chrome`. It prints only fixed
labels with booleans/bounded exit codes, never command stdout/stderr. Exit 0 means
detected, exit 1 means absent. An unavailable/invalid probe emits
`<name>ProbeSucceeded: false`, not a false claim of absence. It then attempts
example.com using the **same launch helper and fallback policy as desktop:open**.
It closes only the local control handle, never pauses or destroys the session.

Successful diagnostics end with `result: ok`. For a failed launch, both diagnostic
commands print `launchStage`, a fixed `reason`, and `result: failed`. Stages are
`firefox_open`, `firefox_probe`, `chromium_probe`, `fallback_open`, `render_wait`,
and `health_recheck`. Example key lines when Firefox is installed but open fails:

```text
ready: true
firefoxExitCode: 0
firefoxDetected: true
launchStage: firefox_open
reason: FIREFOX_PRESENT_BUT_OPEN_FAILED
result: failed
```

The full output also contains the four path probe results before the launch.
Firefox found either on PATH or at its known path stops fallback on open failure:
an ambiguous launch failure is not permission to start another app. Only confirmed
absence at both locations permits probing known Chromium/Chrome executable paths.
No executable names are guessed from stdout and nothing is installed.

Next steps:

- `result: ok`: run `npm run desktop:open` for manual provider authentication.
- `FIREFOX_PRESENT_BUT_OPEN_FAILED` or `FALLBACK_OPEN_FAILED`: retain the safe
  diagnostic output for launch/API investigation. `npm run desktop:check` can
  confirm control health but does not repair application launch. Do not recreate
  sessions or repeatedly launch apps as a workaround.
- `NO_SUPPORTED_BROWSER`: stop. No launch command can repair a missing installed
  browser; arrange a supported image/browser through Solari before rerunning
  `npm run desktop:browser-diagnose`. No automatic installation is provided.
- `PROBE_FAILED`, render-wait failure, or health-recheck failure: run
  `npm run desktop:check` and inspect the safe failing stage. After the underlying
  issue is corrected, rerun `npm run desktop:browser-diagnose`.
- `ready: false`: run `npm run desktop:check` first; no probe/launch was attempted.

For the shorter launch check:

```bash
npm run desktop:browser-test
```

This connects to the same saved session, calls `vm.open("firefox",
["https://example.com"])`, waits 1.5 seconds, verifies `health().ready === true`,
and closes its local control handle. It now enables the same verified fallback
policy as `desktop:open`. Success prints only `DESKTOP_BROWSER_LAUNCH_OK`; failure
prints the safe stage/reason described above. There is no provider navigation,
screenshots, recording, typing, or software installation. It never
pauses or destroys the desktop; inspect the already-open viewer or pause the
desktop manually when finished. A paused session may be resumed by `connect()`.

## Literal keyboard input (developer-only)

If the viewer changes uppercase letters to lowercase, use the installed Desktop
SDK's `vm.keyboard.type(text)` API through this separate helper. It reads
`SOLARI_API_KEY` from the repo-root `.env` and resolves the exact session ID as
described above (honoring optional `SOLARI_DESKTOP_BASE_URL`). No new VM, browser,
or agent run is launched by the typing helper.

1. Keep your manual viewer open, with `npm run desktop:open` still running in its
   first terminal. Do **not** run validation, recording, screenshots, or other
   automation while entering credentials. The typing helper does not start any of
   these, but cannot detect/stop another process's recording.
2. Focus a harmless text field in the remote desktop. In a **second terminal** at
   the repo root, run:

   ```bash
   npm run desktop:type -- --test
   ```

   Check the field contains exactly `AbCdEF123`, preserving case. Clear it manually.
   Stop if the test is incorrect; do not enter a secret until this works.

3. Focus the intended **masked password field** in the remote viewer, then run:

   ```bash
   npm run desktop:type -- --secret
   ```

   Wait for the hidden-input prompt, type the text in this second terminal, and
   press Enter. Nothing is echoed (not even asterisks). Backspace works; Ctrl+C
   cancels. Input must be a single line; control sequences/multiline pastes are
   rejected, and waiting times out after five minutes. Piped input and text in
   command-line arguments are not accepted. Do not put passwords in `.env`, files,
   shell commands, chat, screenshots, logs, or test fixtures.

4. Success prints only `Typed secret into focused desktop field.` Terminal Enter
   **does not submit the remote form**. Verify focus yourself and complete login/MFA
   manually in the viewer. The helper never reads the field, checks login, clicks,
   captures evidence, or exports/persists browser state. It cannot guarantee the
   field remained focused: keep the remote desktop untouched during entry.

The helper closes its own control connection in `finally`; the SDK has no separate
client close method. It deliberately leaves the existing VM/viewer running (and
can resume a paused VM), so return to the original `desktop:open` terminal when
finished and press Enter there to pause it, or pause it in Solari yourself.
On a typing error, inspect/clear the field before retrying: delivery may already
have happened and there is no automatic retry.

Before connecting, `desktop:type` prints `Desktop target: <resolved session ID>`.
In `--test` mode, failures also report the stage (`client_connect`, `vm_connect`,
`health_check`, or `keyboard_type`) and a safe error name. Only recognized,
non-sensitive error messages are shown; other messages are replaced with
`[redacted]`, including credentials, tokens, headers, bodies, and URL query data.
The helper never prints stacks or full error objects. `--secret` retains generic
failure messages and never includes the entered text in diagnostics.

Text stays in process memory only, then travels directly to the configured Solari
service. No clipboard, file, log, screenshot, or recording API is used. Input
buffers owned by the reader are wiped and temporary references released promptly;
JavaScript strings and SDK transport buffers cannot be reliably zeroized. The
selected application receives the text, so use only a trusted, dedicated VM and
the correct masked field. The helper is not imported by production CleanBreak and
does not change Browser profile-overwrite protections.

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
