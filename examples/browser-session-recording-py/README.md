# Browser session recording — Python

Launches a recorded Browser session on example.com, closes it, then polls for
replay availability up to ten times at three-second intervals. It downloads
rrweb NDJSON into memory and prints byte/event counts plus an event excerpt.
It does not produce an MP4 or save a recording file locally.

Replay events can contain private page content. Keep this sample on public test
pages; do not use authenticated accounts or share raw event output. CleanBreak's
Desktop MP4 recording is a separate mechanism.

## Run

From the repository root:

```bash
cd examples/browser-session-recording-py
python -m pip install -r requirements.txt
python main.py
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
