#!/usr/bin/env bash
# ============================================================================
# rebuild.sh — build a fresh schema from migrations and emit its snapshot
# ----------------------------------------------------------------------------
# Applies, against an EMPTY target database:
#   1. scripts/schema/test-shim.sql   (Supabase-managed surface, test-only)
#   2. every file in supabase/migrations/*.sql in lexical order
#      (00000000000000_baseline.sql sorts first; future migrations follow)
# then runs scripts/schema/introspect.sql and writes the normalized snapshot
# to the path given as $1 (default: stdout).
#
# Connection comes from standard libpq env vars (PGHOST/PGPORT/PGUSER/PGDATABASE
# /PGPASSWORD). This is used both by the local fidelity check and by CI.
# It NEVER targets production — only throwaway databases.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-/dev/stdout}"
DBNAME="${PGDATABASE:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -X -q)

echo "[rebuild] applying test-shim.sql" >&2
"${PSQL[@]}" -v DBNAME="$DBNAME" -f "$ROOT/scripts/schema/test-shim.sql" >/dev/null

echo "[rebuild] applying migrations from supabase/migrations" >&2
shopt -s nullglob
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "[rebuild]   $(basename "$f")" >&2
  "${PSQL[@]}" -f "$f" >/dev/null
done

echo "[rebuild] introspecting -> $OUT" >&2
"${PSQL[@]}" -tAX -f "$ROOT/scripts/schema/introspect.sql" > "$OUT"
echo "[rebuild] done ($(wc -l < "$OUT") lines)" >&2
