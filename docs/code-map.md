# Source guide

Each maintained source file has a short comment describing its responsibility.
Comments around authorization, dispatch, recovery and verification explain the
checks that would be easy to break during a refactor.

| Location                             | Responsibility                                                     |
| ------------------------------------ | ------------------------------------------------------------------ |
| `app/`, `components/`                | Dashboard, forms, private API routes and receipt pages             |
| `lib/cancellations/`                 | One-click jobs, authorization, Miro navigation and verified totals |
| `lib/desktop/`                       | Desktop connections, private browser access and input checks       |
| `lib/agent/`                         | Older Browser agent and supervised approval workflow               |
| `lib/solari/`                        | Browser sessions, named profiles and replay lifecycle              |
| `lib/verification/`, `lib/receipts/` | Legacy fresh-browser checks and receipt storage                    |
| `lib/db.ts`, `lib/db/migrations/`    | SQLite connection, tables and seed data                            |
| `lib/benchmark/`, `tests/`           | Repeatable scenarios and regression tests                          |
| `scripts/`                           | Small command-line entry points and internal diagnostics           |
| `examples/`                          | Standalone SDK samples with their own dependencies                 |

## Important boundaries

`service.ts` moves a job through its saved states. `policy.ts` checks the
authorized target and billing facts. `dispatch.ts` consumes the one-use grant.
`repository.ts` stores state and coordinates workers. `metrics.ts` reads
saved receipts and keeps real savings separate from sample subscriptions.

Module comments explain ownership and purpose. Inline comments cover decisions,
ordering and failure behavior. Tests describe the behavior they protect.

JSON manifests, generated files, license text and media retain their standard
formats. JSON does not permit comments. Dependency and command definitions live
in `package.json`; TypeScript and test settings live in their named config files.
