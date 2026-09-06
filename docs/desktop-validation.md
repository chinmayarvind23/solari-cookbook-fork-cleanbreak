# Desktop developer tools

These commands are developer-only. They use the existing SDK session and do not
run cancellation unless explicitly documented as a live authorization command.
For the product flow, start with [operation](one-click-product.md).

Run from the repo root with `.env` present. Common settings are `SOLARI_API_KEY`,
`SOLARI_DESKTOP_BASE_URL=https://api.getsolari.com` and the shared session reference.

## Session identity and lifecycle

Resolution is identical for typing, manual open, checks, validation and product
execution: nonempty `SOLARI_DESKTOP_SESSION_ID` wins; otherwise use ignored
`.cleanbreak/desktop-session.json`. The ambiguous old `SOLARI_DESKTOP_ID` is not
a fallback. Do not substitute a console `vm_XXXXXX` slot label.

SDK compound session IDs may contain capabilities. Keep the saved file and
terminal session metadata private. The file contains only sessionId/createdAt/
expiresAt, never API keys or stream/control URLs.

| Command                            | Effect and expected success                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run desktop:create`           | Creates one VM, round-trips the exact returned session ID, saves its reference; `CONNECT_ROUND_TRIP_OK` |
| `npm run desktop:check`            | Gets/reconnects the resolved session and requires health ready; `DESKTOP_CONNECT_OK`                    |
| `npm run desktop:open`             | Launches configured provider in Chrome, then opens a private manual viewer                              |
| `npm run desktop:browser-test`     | Launches example.com in Chrome and checks process/render; `DESKTOP_BROWSER_LAUNCH_OK`                   |
| `npm run desktop:browser-diagnose` | Safe executable/process/render diagnostics and a local render screenshot                                |
| `npm run desktop:verify`           | Independent read-only Miro billing observation; no cancellation or receipt                              |

Creating a VM incurs provider usage. Creation uses `office`, 1280×720, 2 CPUs,
4096 MiB, a 60-minute timeout and `onTimeout: "pause", autoResume: false`, with
recording initially off. It refuses to overwrite an existing reference or compete
with an environment override.

Ordinary cleanup closes local handles; **it never pauses or destroys the VM**.
Some SDK connections can resume a paused VM, including checks. The read-only DOM
helpers explicitly require an already running/ready session. Server-side timeout
policy still applies. Pause in Solari when finished; do not recreate a VM to fix
a browser or login issue.

## Chrome and manual authentication

`desktop:open` requires an interactive terminal and
`CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true`. It validates the configured public
HTTPS provider URL, connects, confirms health and launches detected
`/usr/bin/google-chrome` with:

```text
--no-sandbox
--disable-dev-shm-usage
--user-data-dir=/tmp/cleanbreak-chrome
--new-window
<configured provider URL>
```

No headless mode, Firefox fallback or software installation is used by these
Chrome-only commands. The fixed flags reduce browser isolation; use a dedicated,
trusted VM. Profile files remain inside the VM.

The helper waits at most ten seconds for a surviving Chrome process and a decoded
non-blank screenshot before presenting the viewer. The image proves rendering,
not the identity/authentication of the page. Startup capture stays local, with no
model upload. `desktop:browser-diagnose` writes
`.cleanbreak/browser-render-test.png`; other manual launch checks keep it in memory.

The private viewer uses noVNC over a protected loopback proxy, not an invented
public SDK viewing URL. Sign in and complete MFA manually. Return to the terminal
and press Enter to close only the local viewer. You may watch the same VM through
the Solari console; the product worker does not require a viewer.

For private DOM setup, default-profile migration and profile upload, see
[authentication](authentication.md). Do not run setup against an active job.

## Literal keyboard input

If viewer typing loses uppercase characters:

1. Focus a harmless remote text field. Run `npm run desktop:type -- --test`.
   It types exactly `AbCdEF123`. Check it and clear it manually.
2. Focus the intended **masked password field**. Run
   `npm run desktop:type -- --secret` in a second terminal.
3. Enter the text at the hidden prompt and press Enter. The SDK types it literally;
   terminal Enter does not submit the remote form. Complete login/MFA manually.

Do not run screenshots, recordings or cancellation concurrently with secret entry.
The helper cannot stop another process's capture. No echo, clipboard, shell
arguments or disk persistence is used; buffers are released/wiped where practical.
JavaScript/transport strings cannot be guaranteed zeroized. Focus must remain on
the trusted intended field. Delivery uncertainty never triggers an automatic retry.

Test failures expose only safe stage/name/sanitized-message diagnostics:
`client_connect`, `vm_connect`, `health_check`, `keyboard_type`.
Secret-mode failures remain generic. Session references, even when printed, stay
private; raw SDK bodies, headers and input values must not be shared.

## Diagnose without creating another VM

- Connection problems: `desktop:check`. Success is health only, not browser auth.
- Browser problems: `desktop:browser-diagnose`. Inspect fixed reasons such as
  CHROME_OPEN_FAILED, CHROME_PROCESS_EXITED, SCREENSHOT_FAILED or DESKTOP_NOT_READY.
- Auth/billing problems: `desktop:verify`. Do not interpret an active trial's
  NOT_VERIFIED result as a failed connection.
- Read the current run's artifact only; failed diagnostics may leave an older
  screenshot on disk. Never share it without privacy review.

To deliberately replace a session: stop helpers/jobs, pause the old VM manually,
clear its override in `.env` and the current shell, and rename the local reference
rather than delete it. For example, from the repo root in PowerShell:

```powershell
Remove-Item -LiteralPath Env:SOLARI_DESKTOP_SESSION_ID -ErrorAction SilentlyContinue
Rename-Item -LiteralPath ".cleanbreak/desktop-session.json" -NewName ("desktop-session.previous-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
npm run desktop:create
npm run desktop:check
```

Run one command at a time and stop on failure. This preserves the old reference
inside the ignored directory; it does not destroy the remote VM or move login state.
Recreation is an explicit resource change, not a cancellation retry.

## Legacy visual dry-runs

`real-provider:desktop-dry-run` and its `--auto` form are separate screenshot-model
navigation tools. They do not use the default product DOM loop and never click the
final cancellation control. They require explicit image-upload consent; do not use
them when screenshots have been refused. Commands, bounds and final-interception
criteria are in [legacy visual policy](desktop-dialog-navigation.md).
