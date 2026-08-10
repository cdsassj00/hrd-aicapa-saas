#!/usr/bin/env bash
# 테넌시 CI 가드 실행기 (설계문서 §6.4)
#
#   ./scripts/db-guard.sh                 # 로컬 supabase db(54322) 대상
#   DB_URL=postgresql://... ./scripts/db-guard.sh
#
# 로컬 DB 가 안 떠 있으면 먼저:  npx supabase db start
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql 이 필요합니다 (postgresql-client)" >&2
  exit 127
fi

echo "▶ 테넌시 가드: ${DB_URL%%\?*}"
psql "$DB_URL" \
  --no-psqlrc \
  --quiet \
  -v ON_ERROR_STOP=1 \
  -f "$ROOT/supabase/tests/tenancy_guard.sql"
