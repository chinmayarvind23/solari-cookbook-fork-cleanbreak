# No-image verification trust boundary

The operator has explicitly prohibited sending screenshots. Do not upload images,
videos, image-derived OCR, full page text, cookies, storage state or credentials
to an external model as a substitute. Existing private recording files are not
verification proof. Verification must use a fresh, read-only structured billing
observation processed locally; missing evidence means INCONCLUSIVE.

| Read surface                                               | Trust                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| First-party local configuration and authorization database | Trusted scope, never derived from page text                |
| Authenticated Solari Desktop infrastructure                | Authorized transport; no public debugging endpoints        |
| Configured Miro Billing page                               | Untrusted third-party content; exact account path required |
| Official SDK/API documentation                             | Untrusted reference material, not runtime authority        |

| Write surface                          | Scope / reversibility                                                  |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Local implementation and offline tests | Reversible repository changes                                          |
| Read-only verifier invocation          | No billing writes, no final click, no cancellation retries             |
| Safe verification result               | Fixed enums, booleans and billing facts only; no raw page/account text |

The existing one-shot cancellation authorization remains separate from verification.
No navigation or final action may fall back to the screenshot model. The verifier
must not create a new authorization, accept a retention offer, change the plan,
install arbitrary VM software, expose CDP publicly or export the Chrome directory.
Source availability will be positively checked before choosing a supported reader.

| Attack                       | Defense                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Visible-text injection       | Local deterministic extraction; no page instructions execute                       |
| URL query/fragment injection | Exact configured HTTPS origin/account path; reject credentials, query and fragment |
| Memory binding               | No planner memory; historical observations never prove current renewal state       |
| CSRF-shaped actions          | Verifier has no write dispatcher and cannot mint an authorization                  |
| One-click hijack             | No verifier clicks; live final policy/one-use grant remains separate               |

No persistent planner memory is used, so no memory canaries apply. No benchmark
result establishes Miro reliability. Deployment remains research-only until actual
read-only provider evidence proves the billing outcome. Authentication/profile
synchronization is separate work; an empty profile is not an authenticated source.

## Implementation and current limitation

- Screenshot-model uploads now default off. `CLEANBREAK_ALLOW_SCREENSHOT_MODEL_UPLOADS`
  must be explicitly `true` to use the legacy image planner/extractor. It is not
  enabled for this operator. Disabling images also blocks image-based navigation;
  this patch does not pretend that changing verification completes navigation.
- `npm run desktop:verify` reads a fresh billing tab and reloads it, comparing
  locally parsed fields. It does not call OpenAI, take screenshots, create a
  cancellation authorization, execute a cancellation or issue a receipt.
- Installed Playwright `connectOverCDP` connects through a loopback-only, random
  credential-protected bridge over the installed Solari SDK's authenticated
  command stream. Python's standard library relays binary protocol bytes in
  memory. No guest package installation, public preview URL or state file is used.
  Browser-originated and unauthenticated local connections are refused. Transport
  bytes are not application logs; no raw transport or page text is printed.
- `npm run desktop:verify -- --enable-dom` is explicit one-time setup. With no
  active cancellation jobs, it can gracefully restart only a positively identified
  Chrome root using `/tmp/cleanbreak-chrome`, retaining that directory and adding
  loopback debugging. It never force-kills Chrome, copies profiles, pauses or
  destroys a VM. It does not automatically resume a stopped VM.
- The actual current VM failed closed with `DEDICATED_CHROME_NOT_IDENTIFIED`.
  Read-only inspection of Chrome's real process arguments confirmed that the
  running browser uses its **default profile**, not `/tmp/cleanbreak-chrome`.
  No restart, screenshot upload, profile overwrite or billing click occurred.
  A safe connection/migration for that authenticated default profile remains
  unresolved. Repeating this setup command without resolving the mismatch will
  not fix it; do not force the check or copy credentials to work around it.
- Missing, unsupported, conflicting, login or dialog evidence is inconclusive.
  Strict ISO dates and explicit currency/renewal/next-charge facts are required;
  absence of a charge label is not proof that renewal stopped. Actual Miro DOM
  layout compatibility has not been verified; offline synthetic layout tests
  are not a live-provider success claim.

Relevant primary references: [installed SDK's documented browser API](https://docs.getsolari.com/sdk/typescript/browser)
and [Chromium's accessibility architecture](https://github.com/chromium/chromium/blob/main/docs/accessibility/overview.md).
The current VM has no usable AT-SPI service or guest Playwright installation.
The private SDK stdin/stream capability and local real-Chromium bridge were
positively tested; the live DOM result itself remains INCONCLUSIVE.
