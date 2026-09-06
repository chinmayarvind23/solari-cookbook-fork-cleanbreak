# Sandbox code interpreter — Python

Creates a base sandbox and evaluates Python cells in a shared kernel, including
a circle-area calculation. It prints returned result items and kills the sandbox
in `finally`. The kernel is temporary; it is not durable application storage.

Use only the sample's public inputs. Interpreter output is printed directly, so
do not include credentials or private data in cells.

## Run

From the repository root:

```bash
cd examples/sandbox-code-interpreter-py
python -m pip install -r requirements.txt
python main.py
```

Set `SOLARI_API_KEY` in the environment first; these examples do not automatically
load the root `.env`. See the [example setup and safety notes](../README.md).
