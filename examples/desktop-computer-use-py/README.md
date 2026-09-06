# Desktop computer use — Python

Creates a standalone demo Desktop, opens Mousepad, clicks a fixed position, types
a greeting and saves `screenshot.png`. Its source uses the `default` template;
this is not the root application's `office`-template Chrome setup.

**This sample destroys its newly created Desktop in cleanup.** Never adapt it to
an existing authenticated CleanBreak VM without changing that lifecycle. It also
prints a stream URL: treat the terminal output and screenshot as private.

The root application's persistent Desktop lifecycle is implemented separately
in [lib/desktop](../../lib/desktop).

## Run

From the repository root:

```bash
cd examples/desktop-computer-use-py
python -m pip install -r requirements.txt
python main.py
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
