#!/usr/bin/env python3
"""SecretForge Python SDK sample.

Loads vault secrets into os.environ at boot, then prints one.
Requires: SECRETFORGE_TOKEN (service token) + .secretforge.json (forge init).
"""
import secretforge


def main() -> None:
    # Side-effect version: merges vault secrets into os.environ.
    # Real environment variables always win over the vault.
    secretforge.config()

    key = "SAMPLE_API_KEY"
    value = __import__("os").environ.get(key)

    if not value:
        print(f"✗ {key} not found — did you run `forge set {key}=... --env dev`?")
        raise SystemExit(1)

    print("Python SDK loaded secrets into os.environ")
    print(f"{key} = {value}")

    # No-side-effect alternative: load() returns a plain dict.
    all_secrets = secretforge.load()
    print(f"(load() returned {len(all_secrets)} secret(s) without touching os.environ)")


if __name__ == "__main__":
    try:
        main()
    except secretforge.ForgeError as err:
        print(f"✗ Failed: {err}")
        raise SystemExit(1)