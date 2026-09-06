# Operate a one-click cancellation

This guide is for one operator managing an owned or authorized Miro Business Trial.
The web app runs locally; Chrome and the provider page run in the existing Solari
Desktop. The Solari website viewer is optional during automation.

**Already VERIFIED?** Open the existing receipt/recording. Do not create a new
cancellation to test it again.

## 1. Configure the server

From the repository root, install dependencies with `npm install`. Create a
private root `.env` in your editor; do not overwrite an existing one.

```dotenv
SOLARI_API_KEY=
SOLARI_DESKTOP_BASE_URL=https://api.getsolari.com
SOLARI_DESKTOP_SESSION_ID=
SOLARI_PROFILE_NAME=cleanbreak-miro

CLEANBREAK_APP_ORIGIN=http://localhost:3000
CLEANBREAK_REAL_PROVIDER_EXECUTOR=desktop
CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true
CLEANBREAK_REAL_PROVIDER_NAME=Miro
CLEANBREAK_REAL_PROVIDER_URL=https://miro.com/app/settings/company/YOUR_COMPANY_ID/billing
CLEANBREAK_REAL_PROVIDER_PLAN_NAME=Business Trial
CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS=24000
CLEANBREAK_REAL_PROVIDER_CURRENCY=USD
CLEANBREAK_REAL_PROVIDER_INTERVAL=YEARLY

CLEANBREAK_DRY_RUN=true
CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL=false
CLEANBREAK_ALLOW_SCREENSHOT_MODEL_UPLOADS=false
SOLARI_PERSIST_PROFILE_STATE=false
OPENAI_API_KEY=
```

Replace the account path and financial terms with the actual subscription.
`24000` cents / YEARLY means $240 per year, not $240 per month.
Setting `CLEANBREAK_REAL_PROVIDER_AUTHORIZED=true` attests that you control the
account. Never use unrelated account credentials.

The shared Desktop configuration validator currently requires `OPENAI_API_KEY`
even though the default Miro DOM adapter makes no model requests. Keep it
server-side; do not enable image uploads to satisfy a configuration error.
`SOLARI_PROFILE_NAME` is for explicit profile helpers, not Desktop session lookup.
Remote Miro operation does not require a public URL for the local CleanBreak app.

## 2. Prepare the dedicated Desktop

If no saved session exists, run once:

```bash
npm run desktop:create
npm run desktop:check
npm run desktop:open
```

Creation uses the SDK's `office` template and saves its verified session reference.
If a session already exists, start with `desktop:check`; do not create duplicates.

`desktop:open` launches Chrome on the configured Billing URL. Manually sign in,
complete MFA and verify the intended account/plan. Press Enter in its terminal
when finished to close the local viewer; the VM stays running. The Solari console
viewer can also be used. Never run a cancellation or recording during secret entry.

Next, enable the private DOM connection once for the dedicated Chrome profile:

```bash
npm run desktop:verify -- --enable-dom
```

This can gracefully restart the identified dedicated Chrome with loopback debugging
and then perform a read-only billing check. Subsequent checks need only:

```bash
npm run desktop:verify
```

An active, matched trial can return NOT_VERIFIED: it has not been canceled yet.
INCONCLUSIVE means fix the authentication/configuration/readability issue before
authorizing cancellation. VERIFIED means renewal is already off; do not submit again.
The read-only command never creates a cancellation receipt.

Default-profile migration, named-profile upload and diagnostics are documented in
[authentication](authentication.md) and [Desktop tools](desktop-validation.md).
They are separate explicit operations, not automatic cleanup.

## 3. Authorize one real cancellation

Stop the old local dev server, then run:

```bash
npm run dev:live
```

The launcher reads `.env`, enables the live flags in its child process, requests
a hidden operator password of at least 24 characters if needed, and prints the
exact loopback address. Sign in as `cleanbreak` using that operator password.
This is not your Miro password.

Review the Miro card's account/plan configuration and renewal terms, then click
**Cancel subscription** once. That is the single authorization for one irreversible
attempt; no second approval is requested.

The launcher itself does not connect to Solari, authorize a job or recover jobs at
startup. Requests/polling for an existing pending job can resume its already
authorized work. Refreshing the dashboard does not create a new authorization.
Shell environment values can override `.env`; restart the server after changes.

## 4. Read the outcome

| Outcome                 | What to do                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------- |
| VERIFIED                | Open the receipt and private recording; do not cancel again                             |
| NOT_VERIFIED            | Billing still shows an active renewal; inspect the existing job, never blindly resubmit |
| INCONCLUSIVE            | The result is uncertain; reconcile provider state read-only, with no destructive retry  |
| FAILED before any claim | Fix the recorded cause; only an eligible fresh-attempt button can authorize new work    |

A receipt requires a fresh matching billing observation and one acknowledged final
click. `desktop:check`, a final-boundary dry-run, a success toast or a saved video
does not establish cancellation.

The dashboard exposes the receipt and recording for the existing job. API routes:

- `GET /api/cancellations/:id`: safe status and counters.
- `GET /api/cancellations/:id/receipt`: authenticated, digest-checked JSON.
- `GET /api/cancellations/:id/recording`: authenticated original MP4.
- `/cancellations/:id/receipt`: receipt page.

Recordings can contain billing details. Redact a **separate sharing copy**; the
download route does not automatically redact the original. Never change immutable
receipt evidence to make an edited recording appear to be the original.

## CLI alternative

Use this only **instead of** the dashboard authorization, not in addition to it.
The command itself authorizes a real cancellation:

```powershell
$env:CLEANBREAK_REAL_PROVIDER_EXECUTOR = "desktop"
$env:CLEANBREAK_DRY_RUN = "false"
$env:CLEANBREAK_REAL_PROVIDER_AUTHORIZED = "true"
$env:CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL = "true"
$env:CLEANBREAK_OPERATOR_PASSWORD = [Net.NetworkCredential]::new("", (Read-Host "CleanBreak operator password (24+ characters)" -AsSecureString)).Password
npm run real-provider:desktop-live
```

Restore safe flags after finishing. Do not put passwords in shell arguments/files.

## Troubleshooting

| Symptom                                              | Check                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Operator authentication required                     | Use `dev:live`, username `cleanbreak`, and the operator password—not provider credentials |
| Origin mismatch / HTTP 403                           | Open the exact printed origin; localhost and 127.0.0.1 differ                             |
| Desktop connection failure                           | Run `desktop:check`; use the SDK-issued session, not a console slot label                 |
| Final boundary not established                       | Unsupported/changed flow or mismatched terms; do not weaken the final gate                |
| Billing observation unavailable                      | Check private DOM setup, authenticated Billing page and exact account config              |
| Legacy planner token budget / image uploads disabled | You are on the separate visual path; see [legacy policy](desktop-dialog-navigation.md)    |
| Existing job remains visible                         | It is durable audit state, not a stale browser ticket; do not delete locks/history        |

Eligible fresh attempts preserve the predecessor and require new user authorization.
Consumed or uncertain jobs are not eligible. Details: [security](security.md).

When finished, stop the local server and **pause the VM in Solari** to stop compute
billing. CleanBreak closes its handles but deliberately does not pause/destroy the VM.
