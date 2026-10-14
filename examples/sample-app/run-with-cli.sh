#!/usr/bin/env bash
# SecretForge CLI sample — run a command with vault secrets injected.
#
# Prereqs: forge login (or SECRETFORGE_TOKEN), forge init in this directory,
# and a SAMPLE_API_KEY secret in the dev environment.
set -euo pipefail
cd "$(dirname "$0")"

echo "── forge whoami ──────────────────────────────"
forge whoami

echo
echo "── forge list (keys only, values never shown) ──"
forge list --env dev

echo
echo "── forge run — child process sees the secret ──"
forge run --env dev -- node -e 'console.log("CLI injected SAMPLE_API_KEY:", process.env.SAMPLE_API_KEY)'

echo
echo "✓ CLI path works — secret was injected, nothing written to disk."