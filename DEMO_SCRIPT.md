# CleanBreak 75-second demo script

Record at 1440p or 1080p with the browser at 100% zoom. Preload the StreamMax
dark-pattern scenario and the latest completed receipt. Keep `.env`, provider account
details, replay tokens, and all developer tooling out of frame.

## 0–8 seconds — problem and promise

**Show:** CleanBreak dashboard, then the active StreamMax subscription.

**Say:** “Subscription cancellation is a high-stakes browser task: retention traps
are annoying, and a false success can cost real money. CleanBreak separates agentic
navigation from authorization and proof.”

## 8–30 seconds — autonomous dark-pattern navigation

**Show:** Open the demo lab, confirm “Dark pattern” is loaded, and run the autonomous
navigation. Follow the timeline as it continues, selects a reason, rejects both the
pause offer and discount, and reaches `AWAITING_APPROVAL`.

**Say:** “A typed OpenAI planner proposes one observation-scoped action at a time.
Deterministic policy blocks unsafe targets and lets it reject two retention offers.
The agent reaches the final control—but it cannot click it.”

## 30–47 seconds — approval and dry-run safety boundary

**Show:** The final-action evidence, cancellation fee, access date, approval
fingerprint, “DRY RUN — no final click” status, and “Test approval — no cancellation”
button. Click the test button and show that state remains `AWAITING_APPROVAL`, with
zero approvals granted and zero destructive clicks.

**Say:** “The server fingerprints the exact action and terms. This demo is in
server-enforced dry-run mode, so even a valid approval submission cannot launch a
commit session or cancel anything.”

## 47–63 seconds — verification and receipt proof

**Show:** Switch to the previously completed StreamMax live fixture run. Highlight
one approved destructive click, zero automatic retries, distinct execution and
verification session IDs, `VERIFIED`, then open the receipt and its SHA-256 digest.

**Say:** “In an explicitly authorized live flow, CleanBreak allows at most one final
click. It still does not claim success. A fresh read-only Solari session checks the
authoritative account state, and only verified evidence can produce a tamper-evident
receipt.”

## 63–75 seconds — measurable close

**Show:** `artifacts/benchmark-results.json` or the README measured-results table.
Frame the 100/100 pass rate and zero hard-safety counters.

**Say:** “The adversarial suite runs 100 executions across 20 scenarios: 100 percent
pass rate, zero false verified, zero unsafe actions, and zero automatic destructive
retries. CleanBreak turns browser automation into a bounded, auditable workflow.”

## Recording fallback

If a live Solari run is slow, use the already persisted timeline, screenshots,
session metadata, verification result, and receipt. Do not edit out an error and do
not describe the fictional StreamMax run as external-provider validation. If the
external-provider dry run has not been completed, say so plainly.
