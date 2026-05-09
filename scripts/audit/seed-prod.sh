#!/usr/bin/env bash
set -euo pipefail
echo "WARNING: Seeding audit accounts on PRODUCTION Supabase."
echo "Project: lczmjpnbuhnsislcvzar"
read -p "Type 'YES' to continue: " confirm
[ "$confirm" = "YES" ] || exit 1
supabase db push --project-ref lczmjpnbuhnsislcvzar
