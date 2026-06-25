#!/usr/bin/env bash
# ============================================================================
# check-drift.sh — diff a freshly rebuilt schema against the committed snapshot
# ----------------------------------------------------------------------------
# Usage: check-drift.sh <committed-snapshot> <fresh-snapshot>
# Exits 0 if identical, 1 if they differ (printing a categorized diff).
# This is the assertion behind the CI drift gate.
# ============================================================================
set -euo pipefail
COMMITTED="${1:?committed snapshot path required}"
FRESH="${2:?fresh snapshot path required}"

if [[ ! -f "$COMMITTED" ]]; then
  echo "::error::committed snapshot not found: $COMMITTED" >&2
  exit 1
fi

if diff -q "$COMMITTED" "$FRESH" >/dev/null 2>&1; then
  echo "✓ schema drift gate: rebuilt schema matches committed snapshot ($(wc -l < "$COMMITTED") objects)"
  exit 0
fi

echo "✗ SCHEMA DRIFT DETECTED — the migrations no longer match db/schema.snapshot." >&2
echo "  A migration changed the schema without updating the snapshot, or vice versa." >&2
echo "  Regenerate with: npm run schema:snapshot   (then review the diff and commit)." >&2
echo >&2
echo "--- lines only in committed snapshot (removed by migrations) ---" >&2
comm -23 <(sort "$COMMITTED") <(sort "$FRESH") | sed 's/^/  - /' >&2 || true
echo "--- lines only in fresh rebuild (added/changed by migrations) ---" >&2
comm -13 <(sort "$COMMITTED") <(sort "$FRESH") | sed 's/^/  + /' >&2 || true
exit 1
