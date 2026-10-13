# secretforge (Python SDK)

Load vault secrets into `os.environ` at process boot — no more `.env` files.

```python
import secretforge

# Fetch secrets once at boot and merge into os.environ.
# Real environment variables always win over the vault.
secretforge.config()   # uses SECRETFORGE_TOKEN + .secretforge.json

# Or get a plain dict without touching os.environ:
values = secretforge.load(env="prod")
```

## Options

All optional when the env vars / link file are present:

| Arg | Default |
|---|---|
| `project_id` | `.secretforge.json` discovered upward from cwd |
| `env` | `SECRETFORGE_ENV` > link `defaultEnv` > `"dev"` |
| `token` | `SECRETFORGE_TOKEN` env var |
| `url` | `SECRETFORGE_URL` env var > `http://localhost:4000` |

Auth is service-token only (read-only, single-environment, expiring,
revocable). Create one in the web UI under **Project → Tokens**.

Zero dependencies — stdlib only. Requires Python 3.9+.
