# CleanBreak

CleanBreak is a subscription cancellation transaction with independent
verification. The root application includes a financial-control dashboard, a
deterministic fictional StreamMax portal, a recorded Solari cloud-browser path,
and a policy-gated OpenAI navigation run with explicit human approval and a
crash-safe, single-attempt cancellation commit.

## Run

Requires Node.js 22.13 or newer for the built-in SQLite module.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Choose StreamMax on the
dashboard, or open `/demo` to load a fixture scenario.

Copy `.env.example` to the gitignored root `.env` and configure the server-only
credentials:

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
remote Solari browser cannot reach `localhost`; a temporary tunnel is suitable
for local testing, but its URL must not be committed.

The StreamMax fixture is stored in `data/cleanbreak.db`. Use **Reset StreamMax**
or `POST /api/demo/reset` with a `scenario` field to restore deterministic
state. Supported scenarios are `happy-path`, `dark-pattern`,
`cancellation-fee`, `ambiguous-confirmation`, and `already-canceled`.

## Autonomous cancellation dry run

The **Run autonomous dry run** control on `/demo` and this command navigate to
the Milestone 4 approval boundary:

```bash
npm run agent:smoke
```

The server creates a compact accessibility-oriented observation, assigns
observation-scoped target IDs, and asks the OpenAI Responses API for one strict
structured decision. A deterministic policy checks every action and blocks
retention acceptance, account deletion, financial commitments, unknown
controls, stale targets, low-confidence decisions, and external navigation.
Final cancellation is always intercepted and persisted with screenshot
evidence, even if the planner proposes it as a normal click.

Successful navigation runs end in `AWAITING_APPROVAL`. `/demo` then presents an
exact financial confirmation and binds approval to a canonical SHA-256 action
fingerprint. A zero-fee proposal can be explicitly approved or aborted;
nonzero and unknown fees require human handling and have no override.

After approval, CleanBreak opens a new recorded Solari session with the saved
profile, reobserves the final page, and requires unchanged material terms. It
durably arms one commit attempt before clicking the newly observed final target
exactly once. The click is never retried automatically. Any armed attempt ends
in `VERIFYING`, including a returned click, an unknown outcome, or crash
recovery.

The paid end-to-end smoke command is:

```bash
npm run approved:smoke
```

It requires the configured credentials and public target. The deterministic
crash smoke can be run without a paid browser session:

```bash
npm run commit:crash-smoke
```

## Recorded browser smoke run

The **Run browser test** control on `/demo` and this command run the read-only
Solari infrastructure check:

```bash
npm run solari:smoke
```

It reuses or creates the configured profile, launches with recording enabled,
opens StreamMax, captures a screenshot under `artifacts/solari/`, saves profile
state intentionally, polls a bounded number of times for replay availability,
and releases the browser and client.

## Checks

```bash
npm run format:check
npm run typecheck
npm test
npm run build
npm run secret:audit
```

## Additional Solari examples

The original focused cookbook examples remain under [`examples/`](examples):

- Cloud browser quickstarts, profiles, stealth/proxy, and recording
- Sandbox quickstarts, code interpreter, and port preview
- Desktop computer-use quickstart

## Scope

Milestone 4 executes an explicitly approved final action with durable
idempotency and crash recovery. It intentionally does not independently verify
the result, enter `VERIFIED`, or issue receipts.

MIT licensed.
