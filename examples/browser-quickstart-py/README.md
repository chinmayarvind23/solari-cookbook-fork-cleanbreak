# Browser quickstart — Python

Launches a cloud Browser session, opens example.com and reads its title and
heading. The browser is closed in `finally`. This sample does not authenticate
an account or save a profile.

## Run

From the repository root:

```bash
cd examples/browser-quickstart-py
python -m pip install -r requirements.txt
python main.py
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
