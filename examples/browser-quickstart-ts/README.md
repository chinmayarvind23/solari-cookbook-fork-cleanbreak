# Browser quickstart — TypeScript

Launches a cloud Browser session, opens example.com and prints its title, heading
and session metadata. The browser and Solari client are closed in `finally`.
It does not authenticate an account, save a profile or enable recording.

## Run

From the repository root:

```bash
cd examples/browser-quickstart-ts
npm install
npm start
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
