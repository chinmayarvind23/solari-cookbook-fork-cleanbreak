# Legacy Desktop visual navigation

This is the screenshot-model dry-run path in `lib/desktop/`, not the default
Miro DOM product adapter. It remains useful for offline policy regressions and
explicitly consented visual experiments. It never executes final cancellation.

## Consent and invocation

Do not run this path when the operator has refused image uploads. It sends private
provider screenshots to the configured model and records the dedicated Desktop.

Only after that explicit choice, with a manually authenticated configured Billing
page already open and full provider/model configuration, use:

```powershell
$env:CLEANBREAK_DRY_RUN = "true"
$env:CLEANBREAK_REAL_PROVIDER_AUTHORIZED = "true"
$env:CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL = "false"
$env:CLEANBREAK_ALLOW_SCREENSHOT_MODEL_UPLOADS = "true"
npm run real-provider:desktop-dry-run -- --auto
```

Without `--auto`, START and per-step `NAVIGATE <step> <hash>` confirmation are
required. Auto removes those navigation prompts, not the deterministic policy,
screen guard or final interception. Restore the image-upload setting afterward.
Use the [product operator guide](one-click-product.md) for an actual cancellation.

## Allowed navigation

- Keys: Escape, Page_Down, Page_Up, Tab, Shift+Tab and the four arrow keys.
  Enter/Return/Space, deletion keys, Ctrl/Alt/Meta/Super chords, function keys and
  arbitrary text keys remain blocked.
- Coordinate inputs need authenticated same-origin context, confidence, a unique
  allowed purpose and positive reversible-step evidence. Buttons are not activated
  through Enter/Space.
- Cancellation navigation requires its explicit decision type and recognized
  unfinished-step context. Ambiguous/final labels intercept by default.
- Only fixed neutral reason text and narrowly allowed neutral choices are available.
  No offers, upgrades/downgrades, extensions, purchases or account/payment changes.
- The provider-specific Miro exception requires exact configured account path,
  initial standalone Billing context and current-run flow history. A reused cancel
  label cannot automatically become another reversible action.

The strict `scroll` action is a short drag of an observed **vertical scrollbar**
thumb. The SDK wheel API is not given guessed direction/delta arguments. Track
width is 3–20 pixels, height at least 80, start below the top 80 desktop pixels;
vertical displacement is 10–160 pixels with the thumb kept in its track.
Confidence must be at least 0.95. It is not arbitrary page dragging or focus clicking.

## Stability, progress and bounds

Pre-dispatch RGBA comparison requires equal dimensions and no more than 0.5%
changed pixels (RGB threshold 16), with a 32-pixel padded click target or complete
drag corridor protected. Original hashes and safe numeric diagnostics are retained.
Readiness and progress are separate from pixel stability.

A stalled key can lead to a separately planned scrollbar drag; a stalled drag is
not repeated on the unchanged screen. At most two focus-only Tab moves and one
read-only no-progress replan are permitted under the runtime's limits. Loading
observations have bounded waits and do not replay inputs.

The only illustration exclusion is for a recognized Miro extra-trial-days offer
after completed entry/continue history: a tight non-interactive region, at most
20% of the viewport, cannot overlap controls or the protected track. Two fresh
samples must preserve the surrounding screen. It applies only to allowed scrolling
or explicit offer rejection—not entry, reason input, cancel labels or final commit.

Default max steps: 20 (configurable 1–30). Default reported-token budget:
5,000 × max steps, capped at 200,000. `CLEANBREAK_DESKTOP_MAX_TOKENS` can set an
explicit 5,000–200,000 ceiling. Increasing it can increase model cost; it is not
permission to retry inputs. Read-only transient planning failures may retry at
most twice; refusals and exhausted budgets stop. Actions never automatically retry.

## Outcomes and evidence

Successful navigation validation requires AWAITING_APPROVAL,
FINAL_ACTION_BOUNDARY, a positively established final boundary, completed
cancellation navigation, zero destructive/unsafe/retry counters and closed control.
An early ambiguous cancellation candidate does not satisfy those conditions.

Private evidence is under `artifacts/desktop/<run-id>/`: screenshots, sanitized
job metadata and a validation summary only when the required conditions hold.
Recording metadata/download capability is private; no raw model/SDK bodies or
auth state are published. Cleanup stops the recorder and closes owned handles,
without pausing/destroying the shared VM.

This validation never proves cancellation or creates a cancellation receipt.
Visual origin/role/terms are model interpretations, not independent attestation.
Offline tests cover the policy boundaries, not every live provider screen.
See [security](security.md) for injection, authorization and recovery limits.

Code: [runtime](../lib/desktop/runtime.ts), [policy](../lib/desktop/decision.ts),
[Miro rules](../lib/desktop/miro.ts), [budget](../lib/desktop/budget.ts),
[stability](../lib/desktop/screen-stability.ts).
