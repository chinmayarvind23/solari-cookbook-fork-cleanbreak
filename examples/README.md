# Solari SDK examples

These are standalone cookbook samples, not CleanBreak's cancellation workflow.
Each folder has its own dependencies. For the application, use the
[root README](../README.md) and [operator guide](../docs/one-click-product.md).

## Setup and safety

TypeScript samples need Node.js/npm; Python samples need Python and the packages
in their own requirements file. Follow the selected folder's commands.

Set `SOLARI_API_KEY` in your terminal environment without putting the key in
command history. In PowerShell:

```powershell
$env:SOLARI_API_KEY = [Net.NetworkCredential]::new("", (Read-Host "Solari API key" -AsSecureString)).Password
```

The samples read the environment directly; no per-example `.env` template is
needed. They do not automatically read the root `.env`. Do not commit credentials
or paste raw SDK output into issues. Dependencies are independent of the root SDK
versions; review the source and installed API before adapting a sample.

Every sample below creates or uses real cloud resources and may incur charges.
Use only public test content. Some intentionally print preview/stream capability
URLs or replay excerpts: keep output private and never substitute an authenticated
provider page. These samples do not inherit CleanBreak's authorization, profile
protection, redaction or verification safeguards.

## Samples

| Example                                                            | Demonstrates                        | Important side effect                     |
| ------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------- |
| [Browser quickstart — TypeScript](browser-quickstart-ts/README.md) | Open example.com and read content   | Creates a cloud Browser session           |
| [Browser quickstart — Python](browser-quickstart-py/README.md)     | Open example.com and read content   | Creates a cloud Browser session           |
| [Browser profiles](browser-profiles-ts/README.md)                  | Explicit storage-state save/reuse   | Updates the `cookbook-demo` profile       |
| [Browser recording](browser-session-recording-py/README.md)        | Retrieve rrweb replay data          | Prints a replay event excerpt             |
| [Browser stealth/proxy](browser-stealth-proxy-ts/README.md)        | Launch options and egress check     | Prints proxy metadata                     |
| [Desktop computer use](desktop-computer-use-py/README.md)          | Open an editor, type and screenshot | Writes an image; destroys its demo VM     |
| [Sandbox quickstart](sandbox-quickstart-ts/README.md)              | Commands and files                  | Creates and kills a sandbox               |
| [Sandbox code interpreter](sandbox-code-interpreter-py/README.md)  | Shared Python kernel                | Creates and kills a sandbox               |
| [Sandbox port preview](sandbox-port-preview-ts/README.md)          | Public HTTP preview                 | Exposes sample content; kills the sandbox |

Root Desktop commands keep an authenticated VM alive; the standalone Desktop
sample does **not**. Do not reuse it to manage your CleanBreak Desktop.
