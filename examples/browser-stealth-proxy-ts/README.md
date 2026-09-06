# Browser launch options and proxy — TypeScript

Launches a Browser with stealth enabled and a US proxy request, then visits an
egress-IP endpoint. It prints the observed egress IP and resolved proxy metadata
and closes the browser/client in `finally`.

These options do not guarantee access to protected sites. Do not use this sample
to bypass a challenge or provider access restriction. Keep proxy/session output
private. Feature availability depends on the SDK and account configuration.

## Run

From the repository root:

```bash
cd examples/browser-stealth-proxy-ts
npm install
npm start
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
