-- 0029_exam_agent.sql
-- 시험 에이전트: 응시자가 시험 중 자유롭게 쓰는 AI + 샌드박스, 그리고 그 과정 기록.
--
-- 이 제품이 파는 것은 정답 채점이 아니라 "과정까지 평가"다. 과정을 평가하려면
-- 과정이 증거로 남아야 하고, 증거는 응시자가 고칠 수 없어야 한다. 그래서:
--
--   · 쓰기는 전부 service_role(엣지 함수 exam-agent)만 한다. 응시자에게는
--     INSERT/UPDATE/DELETE 정책을 아예 주지 않는다 — 추가 전용 로그다.
--   · 응시자는 자기 세션 기록을 읽을 수 있다(화면에 대화가 보여야 하므로).
--   · 평가자 이상은 조직 범위 전체를 읽는다(채점 근거).
--
-- 샌드박스는 외부(E2B)에 있다. 여기에는 식별자와 상태만 둔다 — 설계문서 §8
-- 이식성 방어선대로 공급자 이름을 컬럼으로 두고 코드가 분기하지 않게 한다.

-- ===========================================================================
-- 1. 에이전트 세션 (시험 세션 × 문항 하나당 샌드박스 하나)
-- ===========================================================================
create table public.exam_agent_sessions (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.exam_sessions(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  question_id       uuid references public.questions(id) on delete set null,

  sandbox_provider  text not null default 'e2b',
  sandbox_id        text,
  template          text,

  status            text not null default 'active',
  turn_count        int  not null default 0,
  prompt_tokens     int  not null default 0,
  completion_tokens int  not null default 0,

  started_at        timestamptz not null default now(),
  last_active_at    timestamptz not null default now(),
  closed_at         timestamptz,

  constraint exam_agent_sessions_status_known
    check (status in ('active', 'idle', 'closed', 'expired', 'failed')),
  constraint exam_agent_sessions_turns_sane
    check (turn_count >= 0)
);

comment on table public.exam_agent_sessions is
  '응시자 1인·문항 1개에 대응하는 AI 에이전트 작업 공간. 샌드박스는 외부(E2B)에 있고 여기엔 식별자만 둔다';
comment on column public.exam_agent_sessions.sandbox_provider is
  '샌드박스 공급자. 교체 시 코드가 아니라 이 값으로 분기한다(이식성)';

-- 문항별로 하나. question_id 가 NULL 인 "시험 전체용" 공간도 하나만 허용한다.
-- NULL 은 유니크 제약에서 서로 다른 값으로 취급되므로 부분 인덱스 둘로 나눈다.
create unique index exam_agent_sessions_one_per_question
  on public.exam_agent_sessions (session_id, question_id) where question_id is not null;
create unique index exam_agent_sessions_one_per_session
  on public.exam_agent_sessions (session_id) where question_id is null;

create index exam_agent_sessions_org_idx     on public.exam_agent_sessions (org_id);
create index exam_agent_sessions_session_idx on public.exam_agent_sessions (session_id);

create trigger exam_agent_sessions_inherit_org
  before insert or update of session_id on public.exam_agent_sessions
  for each row execute function public.inherit_org_from_session();

-- ===========================================================================
-- 2. 과정 기록 (추가 전용)
-- ===========================================================================
-- 채점자가 보는 것이 이 표다. 응시자가 무엇을 물었고, 에이전트가 무슨 도구를
-- 어떤 인자로 돌렸고, 결과가 무엇이었는지가 순서대로 남는다.
create table public.exam_agent_events (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.exam_agent_sessions(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  seq        int  not null,

  role       text not null,
  kind       text not null,
  content    jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint exam_agent_events_role_known
    check (role in ('user', 'assistant', 'tool', 'system')),
  constraint exam_agent_events_kind_known
    check (kind in ('message', 'tool_call', 'tool_result', 'file_write', 'error', 'notice')),
  constraint exam_agent_events_seq_positive check (seq > 0)
);

comment on table public.exam_agent_events is
  '에이전트 과정 로그(추가 전용). 평가의 증거이므로 응시자에게 쓰기 권한을 주지 않는다';

create unique index exam_agent_events_seq_uniq on public.exam_agent_events (agent_id, seq);
create index exam_agent_events_org_idx on public.exam_agent_events (org_id);

create or replace function public.inherit_org_from_agent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _org uuid;
begin
  select org_id into _org from public.exam_agent_sessions where id = new.agent_id;
  if _org is null then
    raise exception 'org_id 상속 실패: 존재하지 않는 에이전트 세션 %', new.agent_id
      using errcode = 'foreign_key_violation';
  end if;
  new.org_id := _org;
  return new;
end $$;

revoke all on function public.inherit_org_from_agent() from public, anon, authenticated;

create trigger exam_agent_events_inherit_org
  before insert or update of agent_id on public.exam_agent_events
  for each row execute function public.inherit_org_from_agent();

-- ===========================================================================
-- 3. 산출물
-- ===========================================================================
-- 샌드박스에서 만든 파일. 샌드박스는 사라지므로 제출 대상 파일은 answer-files
-- 버킷(0017)에 <session_id>/... 로 복사하고 그 경로를 여기에 남긴다.
create table public.exam_agent_artifacts (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.exam_agent_sessions(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,

  sandbox_path text not null,
  storage_path text,
  bytes        int,
  mime_type    text,
  sha256       text,
  submitted    boolean not null default false,

  created_at   timestamptz not null default now(),

  constraint exam_agent_artifacts_path_not_blank check (length(btrim(sandbox_path)) > 0),
  constraint exam_agent_artifacts_bytes_sane check (bytes is null or bytes >= 0)
);

comment on table public.exam_agent_artifacts is
  '샌드박스 산출 파일. submitted=true 이면 답안으로 제출된 파일';

create unique index exam_agent_artifacts_path_uniq
  on public.exam_agent_artifacts (agent_id, sandbox_path);
create index exam_agent_artifacts_org_idx on public.exam_agent_artifacts (org_id);

create trigger exam_agent_artifacts_inherit_org
  before insert or update of agent_id on public.exam_agent_artifacts
  for each row execute function public.inherit_org_from_agent();

-- ===========================================================================
-- 4. 권한 · RLS
-- ===========================================================================
alter table public.exam_agent_sessions  enable row level security;
alter table public.exam_agent_events    enable row level security;
alter table public.exam_agent_artifacts enable row level security;

-- 읽기만 준다. 쓰기는 service_role(엣지 함수)뿐 — 과정 로그의 무결성이 제품의 근거다.
grant select on public.exam_agent_sessions, public.exam_agent_events,
                public.exam_agent_artifacts to authenticated;
grant all    on public.exam_agent_sessions, public.exam_agent_events,
                public.exam_agent_artifacts to service_role;

create policy "agent session read" on public.exam_agent_sessions
  for select to authenticated
  using (
    public.is_org_examiner(org_id) or public.is_platform_admin()
    or exists (select 1 from public.exam_sessions s
               where s.id = session_id and s.applicant_id = auth.uid())
  );

create policy "agent event read" on public.exam_agent_events
  for select to authenticated
  using (exists (select 1 from public.exam_agent_sessions a where a.id = agent_id));

create policy "agent artifact read" on public.exam_agent_artifacts
  for select to authenticated
  using (exists (select 1 from public.exam_agent_sessions a where a.id = agent_id));

-- ===========================================================================
-- 5. 응시 화면용 조회 RPC
-- ===========================================================================
-- 프론트가 세 테이블을 각각 조회하면 왕복이 늘고 RLS 가 세 번 평가된다.
-- 화면이 필요한 것은 "내 작업 공간 하나의 전체 상태"다.
create or replace function public.get_agent_workspace(_agent_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'session', to_jsonb(a) - 'sandbox_id',
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', e.seq, 'role', e.role, 'kind', e.kind,
               'content', e.content, 'created_at', e.created_at)
             order by e.seq)
      from public.exam_agent_events e where e.agent_id = a.id
    ), '[]'::jsonb),
    'artifacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'path', f.sandbox_path, 'bytes', f.bytes,
               'mime_type', f.mime_type, 'submitted', f.submitted)
             order by f.created_at)
      from public.exam_agent_artifacts f where f.agent_id = a.id
    ), '[]'::jsonb)
  )
  from public.exam_agent_sessions a
  where a.id = _agent_id
$$;

comment on function public.get_agent_workspace(uuid) is
  '응시 화면용 작업 공간 전체 조회. security invoker 라 RLS 가 그대로 적용된다. '
  'sandbox_id 는 외부 샌드박스 접근 식별자이므로 클라이언트에 내리지 않는다';

revoke all on function public.get_agent_workspace(uuid) from public, anon;
grant execute on function public.get_agent_workspace(uuid) to authenticated, service_role;
