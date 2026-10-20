#!/usr/bin/env node
/**
 * supabase/fixtures/fixtures.py 를 DB 시드 SQL 로 감싼다.
 *
 *   node scripts/gen-fixture-module.mjs > supabase/migrations/0036_agent_scripts.sql
 *
 * 왜 DB 인가: 엣지 함수 번들에 14KB 파이썬을 굽지 않기 위해서다. 픽스처를
 * 고칠 때 함수를 다시 배포하지 않아도 되고, 배포 페이로드도 그만큼 작아진다.
 * SQL 은 달러 인용($py$)을 써서 파이썬을 한 글자도 escape 하지 않는다 —
 * 중간 단계에서 escape 가 어긋나면 생성기가 조용히 깨진다.
 */
import { readFileSync } from 'node:fs';

const SRC = 'supabase/fixtures/fixtures.py';
const py = readFileSync(SRC, 'utf8');

if (py.includes('$py$')) throw new Error(`${SRC}: 달러 인용 구분자와 충돌합니다`);
if (py.includes('HRD_FIXTURE_EOF')) throw new Error(`${SRC}: heredoc 구분자가 본문에 있습니다`);

process.stdout.write(`-- 0036_agent_scripts.sql
--
-- 에이전트가 샌드박스 안에서 실행하는 스크립트를 담는다.
-- 생성 파일이다 — 원본은 ${SRC} 이고, 고친 뒤 다시 만든다:
--   node scripts/gen-fixture-module.mjs > supabase/migrations/0036_agent_scripts.sql
--
-- 왜 테이블인가: 엣지 함수 번들에 14KB 파이썬을 굽지 않기 위해서다. 픽스처를
-- 고칠 때 함수를 다시 배포하지 않아도 되고, 배포 페이로드도 작아진다.
--
-- 조직 자산이 아니라 플랫폼 운영 자산이므로 org_id 를 두지 않는다
-- (테넌시 가드 예외 목록에 등록한다). 읽기는 service_role 전용 —
-- 이 스크립트에는 심어 둔 결함의 위치, 즉 채점 기준이 들어 있다.

create table if not exists public.agent_scripts (
  name       text primary key,
  content    text not null,
  updated_at timestamptz not null default now(),
  constraint agent_scripts_content_not_blank check (length(btrim(content)) > 0)
);

comment on table public.agent_scripts is
  '에이전트가 샌드박스에서 실행하는 스크립트. 채점 기준(심어 둔 결함 위치)이 들어 있어 service_role 만 읽는다.';

alter table public.agent_scripts enable row level security;

-- Supabase default privileges 가 anon·authenticated 에 ALL 을 준다(0030 참고).
-- 정책을 두지 않는 것만으로는 막히지 않으므로 권한을 회수한다.
revoke all on public.agent_scripts from anon, authenticated;
grant all on public.agent_scripts to service_role;
-- 정책을 두지 않는다 — service_role 외 전면 거부.

insert into public.agent_scripts (name, content) values ('fixtures.py', $py$${py}$py$)
on conflict (name) do update
  set content = excluded.content, updated_at = now();
`);
