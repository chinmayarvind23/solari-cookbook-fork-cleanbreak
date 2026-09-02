# CleanBreak (TypeScript)

CleanBreak is a subscription cancellation transaction with independent verification. This first milestone includes the financial-control dashboard and a deterministic fictional StreamMax portal that can be canceled manually.

## Run

Requires Node.js 22.13 or newer for the built-in SQLite module.

```bash
cd examples/cleanbreak-ts
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Choose StreamMax on the dashboard, or open `/demo` to load a fixture scenario.

The StreamMax state is stored in `data/cleanbreak.db`, so a later, separate browser session observes the same account truth. Use **Reset StreamMax** or `POST /api/demo/reset` with a `scenario` field to restore a deterministic state.

Supported scenarios:

- `happy-path`
- `dark-pattern`
- `cancellation-fee`
- `ambiguous-confirmation`
- `already-canceled`

## Checks

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

## Scope

Milestone 1 intentionally contains no browser agent and no claimed verification. Solari execution, approval, fresh-session verification, and receipts are added in later milestones. The `.env.example` reserves the server-only Solari settings that Milestone 2 will use.
