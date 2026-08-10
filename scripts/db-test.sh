#!/usr/bin/env bash
# RLS/RBAC 동작 검증 (supabase/tests/rbac_smoke.sql). 전부 롤백됩니다.
#
#   ./scripts/db-test.sh
#   DB_URL=postgresql://... ./scripts/db-test.sh
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql 이 필요합니다 (postgresql-client)" >&2
  exit 127
fi

echo "▶ RBAC 스모크 테스트: ${DB_URL%%\?*}"
psql "$DB_URL" \
  --no-psqlrc \
  --quiet \
  --tuples-only \
  -v ON_ERROR_STOP=1 \
  -f "$ROOT/supabase/tests/rbac_smoke.sql"
