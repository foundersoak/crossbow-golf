#!/usr/bin/env bash
# Pushes every variable in .dev.vars to the deployed Worker as a secret.
# Usage: bash scripts/push-secrets.sh
set -euo pipefail

if [[ ! -f .dev.vars ]]; then
  echo "No .dev.vars file found. Copy .dev.vars.example and fill it in first." >&2
  exit 1
fi

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  # Strip optional surrounding quotes
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value" | npx wrangler secret put "$key"
  echo "set $key"
done < .dev.vars
