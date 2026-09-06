# Authentication and profile persistence

There are three separate stores. Do not treat them as interchangeable.

| Store                                                  | Purpose                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Desktop Chrome, `/tmp/cleanbreak-chrome` inside the VM | Interactive provider login used by Desktop cancellation                          |
| Named Solari Browser profile                           | Playwright-compatible cookies/localStorage/IndexedDB snapshot for explicit reuse |
| Local SQLite database                                  | Cancellation jobs, immutable authorization, verification and receipts            |

A Desktop session ID is not a Browser profile ID. Saving a profile does not store
job history, and deleting job history does not fix authentication. Normal Desktop
cleanup leaves the VM-only Chrome directory intact.

## Manual Desktop login

Use `npm run desktop:open`, manually authenticate the configured provider and
leave Billing open. No password/MFA automation is performed. If uppercase typing
is broken, use the hidden-input helper described in [Desktop tools](desktop-validation.md).

For the no-image Miro product path, enable the private connection once:

```bash
npm run desktop:verify -- --enable-dom
```

With no active cancellation job, this gracefully restarts only a positively
identified dedicated Chrome root and enables debugging on loopback port 9222.
The profile stays inside the VM. Subsequent `desktop:verify` calls are read-only
and do not restart Chrome.

If the browser is actually using Chrome's **default** profile, ordinary setup
fails closed instead of replacing it. Only after intentionally authorizing a
one-time VM-local migration, use:

```bash
npm run desktop:profile-migrate -- --copy-default-auth
```

Migration preserves the original directory and renames any prior dedicated
directory to a recoverable VM-local backup. It copies selected cookie/origin
stores and bootstrap metadata—not the password vault, history, payment database,
downloads or extensions—then opens dedicated Chrome with loopback debugging.
Nothing is exported to the host. Never force-kill Chrome or rerun a successful
migration as a generic troubleshooting step.

## Save Desktop authentication into an existing named profile

Set `SOLARI_PROFILE_NAME` to the exact existing profile. With no active job and
one recognized authenticated configured Miro Billing tab, run:

```bash
npm run desktop:profile-save
npm run profile:list
```

The explicit save helper finds the exact profile, positively checks authentication,
captures `storageState({ indexedDB: true })` in memory, rechecks authentication,
rejects empty cookies and uploads directly with `solari.profiles.save`.
Multiple matching tabs or unknown/login/challenge surfaces fail closed.
It prints only profile name/id/version/size, never state or private page text.

This is a separate opt-in refresh, **not automatic bidirectional synchronization**.
Desktop job cleanup never invokes it. A positive byte count confirms stored data,
not that another remote browser will accept the login.

## Authenticate locally for a named Browser profile

For any configured provider, set:

```dotenv
SOLARI_API_KEY=
SOLARI_PROFILE_NAME=your-existing-profile
CLEANBREAK_REAL_PROVIDER_NAME=Your provider
CLEANBREAK_REAL_PROVIDER_URL=https://provider.example/billing
CLEANBREAK_REAL_PROVIDER_PLAN_NAME=Your plan
```

Use the real HTTPS billing/subscription URL without embedded credentials. Provider
and plan labels must be non-secret, without terminal control characters.

```bash
npm run profile:install
npm run profile:login
```

A visible **local Chromium** window opens the configured URL—not the Solari VM.
Log in and complete MFA/email verification yourself. Confirm the intended plan
and Billing page, then press Enter at the terminal prompt. Only then is in-memory
`storageState({ indexedDB: true })` uploaded directly to the exact existing profile.

The helper does not create a profile, read password fields, record the window or
write storage-state JSON. Ctrl+C, EOF or closing the browser before confirmation
cancels the upload. Use an interactive terminal; piped input is rejected.
Browser and Solari client close in cleanup.

`npm run profile:list` requires only the API key and prints name/id plus version/
size when available. Confirm the returned save version and a positive byte count.
Storage state includes supported persistent stores, not sessionStorage or passkeys;
remote login acceptance still needs an authenticated-page check.

## Overwrite protections

Profile attachment never grants save authority. External dry-runs cannot save,
even if a fixture configuration enables `SOLARI_PERSIST_PROFILE_STATE`.
Use `SOLARI_PERSIST_PROFILE_STATE=false` for external-provider validation.

Cloudflare/CAPTCHA, login, access denied, unrelated origins, failed navigation and
unestablished authentication cannot replace a working profile. Safe skip reasons
include ANTI_BOT_CHALLENGE, LOGIN_REQUIRED, PROVIDER_NOT_REACHED and
PERSISTENCE_DISABLED. Browser/client cleanup still executes when saving is skipped.

The separate runtime refresh interface requires trusted positive auth/page
allowlists, explicit opt-in, successful-run eligibility, fresh save confirmation
and revalidation. The dry-run CLI enables no such refresh adapter. Fixture
persistence retains its own existing behavior.

Never log or commit auth state, cookies, storage keys/values, tokens or API keys.
Treat even an apparently small profile as valuable credentials; do not assume old
versions can be recovered. Privacy and write authority: [security](security.md).
