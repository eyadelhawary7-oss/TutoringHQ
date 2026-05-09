#!/usr/bin/env bash
set -euo pipefail
DEV_REF="${SUPABASE_DEV_PROJECT_REF:-}"
if [ -z "$DEV_REF" ]; then
  echo "ERROR: SUPABASE_DEV_PROJECT_REF env var not set."
  exit 1
fi
supabase db push --project-ref "$DEV_REF"
