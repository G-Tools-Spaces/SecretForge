# SecretForge sample app

A tiny demo that exercises **all three** integration paths against a
SecretForge server:

| Path | File | What it proves |
|---|---|---|
| CLI (`forge run`) | `run-with-cli.sh` | Secrets injected into a child process env |
| Node SDK | `node-app.mjs` | `config()` merges vault secrets into `process.env` |
| Python SDK | `python_app.py` | `config()` merges vault secrets into `os.environ` |

## Setup (once)

1. **A SecretForge server** — local (`http://localhost:4000`) or
   `https://secretforge-api.onrender.com`.
2. **A project** in the web UI (e.g. `sample-app`) — it gets
   Development / Staging / Production environments automatically.
3. **A secret to fetch** — add one in the UI (Secrets tab), e.g.
   `SAMPLE_API_KEY=super-secret-value-123`, or use the CLI:

   ```bash
   export SECRETFORGE_URL="https://secretforge-api.onrender.com"  # or skip for localhost
   forge login
   cd examples/sample-app
   forge init            # pick your project, default env "dev"
   forge set SAMPLE_API_KEY=super-secret-value-123 --env dev
   ```

## 1. CLI test — `forge run`

```bash
cd examples/sample-app
forge run --env dev -- node -e 'console.log("CLI injected:", process.env.SAMPLE_API_KEY)'
```

Or the bundled script:

```bash
./run-with-cli.sh
```

Expected: `CLI injected: super-secret-value-123` — the value came from the
vault over HTTPS, never from a `.env` file.

## 2. Node SDK test

```bash
cd examples/sample-app
npm i @gtools-spaces/sdk        # or from the repo: npm i -w file:../../packages/sdk-node
export SECRETFORGE_TOKEN=sf_... # service token scoped to dev (Tokens tab)
node node-app.mjs
```

Expected output:

```
Node SDK loaded 1 secret(s)
SAMPLE_API_KEY = super-secret-value-123
```

## 3. Python SDK test

```bash
cd examples/sample-app
pip install secretforge         # or: pip install ../../packages/sdk-python
export SECRETFORGE_TOKEN=sf_... # same token
python3 python_app.py
```

Expected output:

```
Python SDK loaded 1 secret(s)
SAMPLE_API_KEY = super-secret-value-123
```

## Notes

- `forge init` wrote `.secretforge.json` here (project ID + default env
  only — safe to commit).
- Service tokens are **read-only** and scoped to one environment — perfect
  for this test. Create them in the project's **Tokens** tab.
- Real environment variables always win over vault values in both SDKs.