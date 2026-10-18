#!/usr/bin/env node
/**
 * supabase/fixtures/docs/<문항코드>/<파일> 을 question_fixtures 시드 SQL 로 만든다.
 *
 *   node scripts/gen-fixture-docs.mjs > supabase/migrations/0032_seed_question_fixtures.sql
 *
 * 왜 Storage 가 아니라 DB 인가: question-attachments 버킷은 public read 라
 * 경로만 알면 누구나 받는다. 시험 콘텐츠를 거기 두면 문제 유출 통로가 된다.
 * 문서 픽스처는 전부 작은 텍스트라 DB 에 두고 RLS 로 세션 소유권에 묶는다 —
 * 업로드 운영 단계도 사라진다(샌드박스 픽스처와 같은 원칙).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'supabase/fixtures/docs';
const MIME = { '.md': 'text/markdown', '.csv': 'text/csv', '.txt': 'text/plain', '.json': 'application/json' };

/** CAPE-01 처럼 "오류를 찾아라" 문항은 심은 오류 목록이 곧 채점 기준이다.
 *  응시자에게 내려가면 안 되므로 answer_key 에 둔다(응시 경로는 answer_key 를
 *  읽지 않는다). 문항 코드별로 여기에 적는다. */
const PLANTED = {
  'CAPE-01': [
    { 위치: '1절 첫 문장', 유형: '기관명', 틀림: '한국노동연구원', 바름: '한국직업능력연구원', 근거: '자료 A' },
    { 위치: '1절 첫 문장', 유형: '연도', 틀림: '2024년 실시', 바름: '2025년 11월 발간, 조사 시점 2025년 8~9월', 근거: '자료 A' },
    { 위치: '1절 첫 문장', 유형: '수치·출처불일치', 틀림: '도입률 47.3%', 바름: '31.8%', 근거: '자료 A' },
    { 위치: '2절', 유형: '단위', 틀림: '1조 2,450억원', 바름: '1,245억원', 근거: '자료 B' },
    { 위치: '3절 마지막 문장', 유형: '인과 단정', 틀림: '도입했기 때문에 2.3%p 더 증가', 바름: '자료 C 원문이 "도입 자체의 효과로 단정하기 어렵다"고 명시', 근거: '자료 C' },
    { 위치: '4절 표', 유형: '합계 오류', 틀림: '구성비 합계 108.0%', 바름: '구성비 열 자체가 근거 없음(자료 D 는 구성비를 제시하지 않음)', 근거: '자료 D' },
  ],
  // 오탐을 가리기 위한 "틀리지 않은" 문장. 응시자가 이걸 오류로 지적하면 감점.
  'CAPE-01:정상': [
    '미도입 사유 38.4% / 27.1% (자료 A 와 일치)',
    '중견기업 15.2%, 중소기업 8.9% (자료 D 와 일치)',
    '중소기업 대상 사업 612억원, 전년 대비 +8.3% (자료 B 와 일치)',
  ],
};

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const rows = [];
for (const code of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, code);
  if (!statSync(dir).isDirectory()) continue;
  let order = 0;
  for (const file of readdirSync(dir).sort()) {
    const ext = file.slice(file.lastIndexOf('.'));
    const mime = MIME[ext];
    if (!mime) throw new Error(`${code}/${file}: 알 수 없는 확장자 ${ext}`);
    const content = readFileSync(join(dir, file), 'utf8');
    if (!content.trim()) throw new Error(`${code}/${file}: 빈 파일`);
    order += 10;
    rows.push(`    (${lit(code)}, ${lit(file)}, ${lit(mime)}, ${order}, ${lit(content)})`);
  }
}
if (!rows.length) throw new Error('픽스처 문서가 하나도 없습니다');

const plantedRows = Object.entries(PLANTED)
  .filter(([k]) => !k.includes(':'))
  .map(([code, list]) => {
    const payload = { planted_errors: list, non_errors: PLANTED[`${code}:정상`] ?? [] };
    return `    (${lit(code)}, ${lit(JSON.stringify(payload))}::jsonb)`;
  });

process.stdout.write(`-- 0032_seed_question_fixtures.sql
--
-- 문항 실습 문서 ${rows.length}건. 생성 파일이다 — 직접 고치지 말고
-- supabase/fixtures/docs/ 를 고친 뒤 다시 만든다:
--   node scripts/gen-fixture-docs.mjs > supabase/migrations/0032_seed_question_fixtures.sql
--
-- 왜 Storage 가 아니라 테이블인가
--   question-attachments 버킷은 public read 다(0012). 경로만 알면 누구나 받는다.
--   시험 콘텐츠를 거기 두면 그대로 문제 유출 통로가 된다. 문서 픽스처는 전부
--   작은 텍스트이므로 테이블에 두고 RLS 로 "그 시험을 치르는 사람"에게만 연다.
--   덤으로 업로드 운영 단계가 사라진다(샌드박스 픽스처와 같은 원칙).

begin;

-- ===========================================================================
-- 1. 테이블
-- ===========================================================================
create table if not exists public.question_fixtures (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  org_id      uuid references public.organizations(id) on delete cascade,
  path        text not null,
  mime_type   text not null default 'text/markdown',
  sort_order  int  not null default 0,
  content     text not null,
  created_at  timestamptz not null default now(),

  constraint question_fixtures_path_not_blank check (length(btrim(path)) > 0),
  constraint question_fixtures_content_not_blank check (length(content) > 0)
);

comment on table public.question_fixtures is
  '문항 실습 문서. 응시자가 받아 보는 자료이며 그 시험을 치르는 사람에게만 열린다. '
  'public read 버킷에 두면 문제 유출이 되므로 Storage 를 쓰지 않는다.';

create unique index if not exists question_fixtures_path_uniq
  on public.question_fixtures (question_id, path);
create index if not exists question_fixtures_org_idx on public.question_fixtures (org_id);

-- org_id 는 문항에서 상속한다(0006 의 공용 트리거 함수). 플랫폼 문항이면 NULL.
drop trigger if exists question_fixtures_inherit_org on public.question_fixtures;
create trigger question_fixtures_inherit_org
  before insert or update of question_id on public.question_fixtures
  for each row execute function public.inherit_org_from_question();

-- ===========================================================================
-- 2. 권한 · RLS
-- ===========================================================================
alter table public.question_fixtures enable row level security;

-- Supabase default privileges 가 anon·authenticated 에 ALL 을 주므로(0030 참고)
-- 쓰기를 먼저 회수한다. 정책이 없다고 UPDATE·DELETE 가 막히지 않는다.
revoke insert, update, delete, truncate on public.question_fixtures from anon, authenticated;
revoke select on public.question_fixtures from anon;
grant select on public.question_fixtures to authenticated;
grant all    on public.question_fixtures to service_role;

-- 읽기: 그 문항이 출제된 시험을 (a) 지금 치르는 응시자이거나 (b) 그 시험을
-- 운영하는 조직의 평가자. 플랫폼 문항은 org_id 가 NULL 이라 org 로는 판정할 수
-- 없으므로 두 경우 모두 exam_questions 를 거쳐 판정한다.
drop policy if exists "question fixture read" on public.question_fixtures;
create policy "question fixture read" on public.question_fixtures
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.exam_questions eq
      join public.exam_sessions s on s.exam_id = eq.exam_id
      where eq.question_id = question_fixtures.question_id
        and s.applicant_id = auth.uid()
        and s.status = 'in_progress'
    )
    or exists (
      select 1
      from public.exam_questions eq
      where eq.question_id = question_fixtures.question_id
        and public.is_org_examiner(eq.org_id)
    )
  );

-- ===========================================================================
-- 3. 시드
-- ===========================================================================
insert into public.question_fixtures (question_id, path, mime_type, sort_order, content)
select q.id, v.path, v.mime_type, v.sort_order, v.content
from (values
${rows.join(',\n')}
) as v(code, path, mime_type, sort_order, content)
join public.questions q on q.org_id is null and q.code = v.code
on conflict (question_id, path) do update
  set content = excluded.content,
      mime_type = excluded.mime_type,
      sort_order = excluded.sort_order;

-- ===========================================================================
-- 4. 채점 기준(심어 둔 오류) — answer_key 에만 둔다
-- ===========================================================================
-- 응시 경로(questions_public · get_exam_questions_for_session ·
-- get_exam_question_tools)는 answer_key 를 내리지 않는다. 여기 둬야 안전하다.
update public.questions q
set answer_key = q.answer_key || v.payload
from (values
${plantedRows.join(',\n')}
) as v(code, payload)
where q.org_id is null and q.code = v.code;

-- ===========================================================================
-- 5. 응시 화면용 조회 RPC
-- ===========================================================================
create or replace function public.get_question_fixtures(_session_id uuid)
returns table (question_id uuid, path text, mime_type text, content text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  _sess public.exam_sessions;
begin
  select * into _sess from public.exam_sessions s where s.id = _session_id;
  if not found then
    raise exception '세션을 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;

  if not (
    _sess.applicant_id = auth.uid()
    or public.is_platform_admin()
    or _sess.org_id = any (public.user_org_ids())
  ) then
    raise exception '이 세션의 자료를 볼 권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;

  return query
  select f.question_id, f.path, f.mime_type, f.content
  from public.exam_questions eq
  join public.question_fixtures f on f.question_id = eq.question_id
  where eq.exam_id = _sess.exam_id
  order by f.question_id, f.sort_order, f.path;
end $fn$;

comment on function public.get_question_fixtures(uuid) is
  '응시 세션에 출제된 문항들의 실습 문서. 채점 기준(answer_key)은 포함하지 않는다.';

revoke all on function public.get_question_fixtures(uuid) from public, anon;
grant execute on function public.get_question_fixtures(uuid) to authenticated, service_role;

commit;
`);
