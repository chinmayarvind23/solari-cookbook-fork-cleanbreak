# Development and deployment

The root application is Next.js/TypeScript with SQLite and Solari SDK integrations.
The [cookbook examples](../examples/README.md) have separate dependencies and are
not the CleanBreak production workflow.

## Local setup

Use Node.js 22.18+ and npm:

```bash
npm install
npm run profile:install
npm run test:one-click
```

The last command uses local Chromium, an isolated loopback server/database and a
fresh verification browser. It needs no Solari/OpenAI keys and cannot touch Miro.
Output: `STREAMMAX_ONE_CLICK_OK`; private fixture artifacts are saved under
`.cleanbreak/one-click-smoke-*/`.

`npm run dev` opens the dashboard/demo lab with safe defaults. Optional API-backed
Browser controls need their server configuration; starting the UI is not a live
provider test. Configure real Miro separately using the [operator guide](one-click-product.md).

`npm install` is the current install command: this repository does not track a
root package lock. Do not document `npm ci` as a reproducible build guarantee.

## Checks

```bash
npm test
npm run typecheck
npm run format:check
npm run build
npm run secret:audit
```

Tests are offline/local; they do not create a Solari VM or cancel a real account.
SQLite's experimental warning on supported Node versions is informational.
The build sanitizes generated standalone copies of private files; it does not
delete source credentials, databases or recordings.

Selected regressions:

```bash
npx vitest run tests/miro-dom-navigation.test.ts tests/miro-billing-verification.test.ts
npm run commit:crash-smoke
npm run test:one-click -- --production --failed-job
```

The production smoke requires a completed build. It exercises an eligible failed
fixture job's explicit fresh authorization and preserves its predecessor.

## Benchmark and claims

```bash
npm run benchmark
```

This runs 20 deterministic Browser scenarios five times, using isolated in-memory
databases and fixed adapters. It writes `artifacts/benchmark-results.json` and
updates only the marked benchmark section of the root README. Preserve
`BENCHMARK_RESULTS_START` / `BENCHMARK_RESULTS_END` when editing that document.

Review generated changes before committing. The JSON is the source of truth;
timings are local synthetic execution, not provider latency. Its legacy
`liveValidation` field reads Browser-run metadata and does not represent the
one-click Miro product job. Fixture safety rates must not become claims about
pilot users, production uptime or customer savings.

Current measured evidence and limitations have one home:
[IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## Source map

| Area                                 | Responsibility                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `app/`, `components/`                | Dashboard, operator/API boundaries and receipt UI                              |
| `lib/cancellations/`                 | One-click authorization, durable service, Miro DOM adapter and receipt outcome |
| `lib/desktop/`                       | SDK session resolution, private CDP, viewer, visual-policy regressions         |
| `lib/agent/`, `lib/solari/`          | Legacy Browser planner/runtime and Solari Browser lifecycle                    |
| `lib/verification/`, `lib/receipts/` | Browser verification and canonical receipt helpers                             |
| `lib/db/`                            | SQLite migrations/repositories                                                 |
| `lib/benchmark/`, `tests/`           | Deterministic scenarios and offline regressions                                |
| `scripts/`                           | Development, manual-auth, smoke and worker commands                            |

The canonical product state graph is
[lib/cancellations/state.ts](../lib/cancellations/state.ts).
Do not duplicate its full schema in guides.

## Legacy Browser integration

Remote Solari Browser cannot open the local app's localhost. To exercise the
fictional StreamMax through Solari, configure a deliberately reachable
`CLEANBREAK_PUBLIC_BASE_URL`, server-side `SOLARI_API_KEY`/`OPENAI_API_KEY`,
recording and a dedicated fixture profile. `OPENAI_MODEL` selects the planner.
Never expose a live operator app just to make a public fixture URL.

| Command                         | Scope                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run solari:smoke`          | Remote Browser fixture connection/navigation                                           |
| `npm run agent:smoke`           | Remote model-planned fixture navigation                                                |
| `npm run approved:smoke`        | Explicit fixture approval/commit path                                                  |
| `npm run verified:smoke`        | Fixture execution plus fresh verification                                              |
| `npm run real-provider:dry-run` | Configured external Browser validation, or Desktop when selected; final action blocked |

These are **not** offline tests and may incur API usage. Read the corresponding
script before running. External validation requires account authorization,
`CLEANBREAK_DRY_RUN=true` and deliberate profile configuration; leave
`SOLARI_PERSIST_PROFILE_STATE=false`. The Browser path and Desktop visual path
are not substitutes for the default Miro DOM product flow.

## Storage and recording

Local defaults: `data/cleanbreak.db`, `artifacts/cancellations/<job-id>/` for product
evidence and `.cleanbreak/` for developer state. The database can be relocated
with `CLEANBREAK_DATABASE_PATH`; back it up together with artifact files.
Browser/demo evidence remains in its own `artifacts/agent/` and receipt locations.

Product recordings are private MP4s, separate from Browser rrweb replay data.
Original downloads are not automatically redacted. A one-off card-blurred copy
of the completed Miro recording was created locally with FFmpeg; that is a
sharing artifact, not an installed production editing feature or changed receipt.
Do not force-add private artifacts or temporary frame exports to Git.

## Deployment boundary

The repository includes a Dockerfile, `/api/health` and a Render Blueprint.
They are a single-instance deployment scaffold, not proof of a deployed live
Miro service. SQLite and local evidence cannot be discarded between invocations
or independently replicated across stateless servers.

The container uses `/app/artifacts/cleanbreak.db`; the Blueprint mounts
`/app/artifacts` and defaults to dry-run. It contains legacy fixture defaults,
including profile persistence: explicitly disable external-provider persistence
when adapting it. Never assume those defaults configure safe public live operation.

For an intentionally operated persistent server, build with `npm run build` and
start with `npm start`. Supply runtime secrets securely, configure the exact
`CLEANBREAK_APP_ORIGIN`, TLS/auth and durable writable volumes. Review the
[security boundary](security.md) before exposing any live endpoint.

Pending-job recovery uses `CLEANBREAK_CANCELLATION_WORKER=true` in a properly
configured server, or `npm run cancellation:worker` with the same environment and
database. Requests for existing pending jobs can also schedule them. Worker startup
may resume already-authorized work; it must not mint new authorization or replay
a consumed final click. `dev:live` deliberately disables startup recovery.

No public deployment, multi-tenant authentication or general provider reliability
is claimed. Validate restart persistence and actual runtime dependencies separately
before using the scaffold beyond the local research setup.
