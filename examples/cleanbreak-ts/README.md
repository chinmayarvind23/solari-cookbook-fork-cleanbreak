# CleanBreak (TypeScript)

CleanBreak is a subscription cancellation transaction with independent verification. The current implementation includes the financial-control dashboard, a deterministic fictional StreamMax portal, a recorded Solari cloud-browser path, and a policy-gated OpenAI navigation dry run that stops at the final approval boundary.

## Run

Requires Node.js 22.13 or newer for the built-in SQLite module.

```bash
cd examples/cleanbreak-ts
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Choose StreamMax on the dashboard, or open `/demo` to load a fixture scenario.

The Next.js configuration loads the gitignored repository-root `.env` when it
exists. For the recorded browser and autonomous dry run, configure:

```dotenv
SOLARI_API_KEY=your-server-only-key
CLEANBREAK_PUBLIC_BASE_URL=https://your-public-host.example
SOLARI_PROFILE_NAME=cleanbreak-demo
SOLARI_RECORDING=true
SOLARI_PERSIST_PROFILE_STATE=true
OPENAI_API_KEY=your-server-only-key
OPENAI_MODEL=gpt-5.6
```

`CLEANBREAK_PUBLIC_BASE_URL` must be an externally reachable HTTP(S) URL. A
remote Solari browser cannot reach the developer machine at `localhost`, and
CleanBreak rejects localhost and private-address targets. A temporary tunnel is
appropriate for manual development, but its URL must not be committed.

The StreamMax state is stored in `data/cleanbreak.db`, so a later, separate browser session observes the same account truth. Use **Reset StreamMax** or `POST /api/demo/reset` with a `scenario` field to restore a deterministic state.

Supported scenarios:

- `happy-path`
- `dark-pattern`
- `cancellation-fee`
- `ambiguous-confirmation`
- `already-canceled`

## Solari browser smoke run

The **Run browser test** control on `/demo` starts the same server-only workflow
as this command:

```bash
npm run solari:smoke
```

The workflow lists or creates the reusable `cleanbreak-demo` profile, launches
the session with recording enabled, opens `/demo/streammax/account`, waits for
the account heading, reads basic page text, captures a PNG under
`artifacts/solari/`, intentionally saves updated profile storage state, and
releases the browser in `finally`. It then polls a bounded number of times for
the replay URL. Replay processing failure does not change an otherwise
successful browser observation into a failed run.

Run metadata is stored in SQLite and rendered on `/demo`. The API key, cookies,
and browser storage state are never stored there or sent to the browser UI. The
smoke run is observation-only and does not click any cancellation control.

## Autonomous cancellation dry run

The **Run autonomous dry run** control on `/demo` and the command below run the
same Milestone 3 workflow:

```bash
npm run agent:smoke
```

The server observes a compact accessibility-oriented view of each current
page, assigns observation-scoped target IDs, and asks the OpenAI Responses API
for one strict structured decision. A deterministic policy validates every
action, rejects retention acceptance, account deletion, financial commitments,
unknown controls, stale targets, low-confidence decisions, and external
navigation. Final cancellation language is always intercepted—even if proposed
as a normal click—and persisted as a proposed action with screenshot evidence.

The loop defaults to 20 steps, detects repeated page states, records step and
token metrics in SQLite, and always releases Solari resources. Successful dry
runs end in `AWAITING_APPROVAL`; no approval or final-cancellation execution is
implemented in this milestone.

## Checks

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

## Scope

Milestone 3 reaches and documents the final cancellation boundary. It does not
approve or execute that final action, claim verification, or issue receipts.
