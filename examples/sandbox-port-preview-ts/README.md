# Sandbox port preview — TypeScript

Creates a base sandbox, writes sample HTML, starts a Python HTTP server on port
3000 and fetches its public preview URL. It prints the URL/content and kills the
sandbox in `finally`.

The preview exposes the sample service outside your machine. Never serve secrets,
private files or an authenticated CleanBreak operator app through this example.
The URL stops being useful when the sandbox is destroyed.

## Run

From the repository root:

```bash
cd examples/sandbox-port-preview-ts
npm install
npm start
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
