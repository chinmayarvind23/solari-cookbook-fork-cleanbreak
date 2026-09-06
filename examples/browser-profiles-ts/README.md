# Browser profiles — TypeScript

Creates or reuses the `cookbook-demo` profile, opens example.com, increments a
localStorage visit counter and explicitly uploads the context's storage state.
The browser and Solari client are closed in `finally`.

This demonstrates persistence, not login or permanent authentication. It saves
on every run and does not include CleanBreak's external-profile overwrite guards.
Do not point it at a valuable authenticated profile. For real provider login,
use the dedicated root profile helpers with explicit manual confirmation.

## Run

From the repository root:

```bash
cd examples/browser-profiles-ts
npm install
npm start
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
