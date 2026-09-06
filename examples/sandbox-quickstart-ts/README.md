# Sandbox quickstart — TypeScript

Creates a base sandbox, runs a Python calculation, writes/reads a temporary text
file and lists files. It kills the sandbox in `finally`; files are not durable.

Commands and arguments are separate API inputs. Shell syntax requires an explicit
shell invocation, as shown in the source; do not interpolate untrusted input.

## Run

From the repository root:

```bash
cd examples/sandbox-quickstart-ts
npm install
npm start
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
