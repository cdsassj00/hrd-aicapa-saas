-- 0034_exam_agent_environment.sql
-- 시험 에이전트 환경 — MCP 서버 연결과 회차별 환경 고정.
--
-- 방향 전환이 하나 있었다. 처음에는 "다른 AI·외부 도구를 막아야 형평하다"로
-- 짰는데, 그건 틀렸다. 이 시험이 재는 것은 "AI 에이전트를 얼마나 잘 쓰는가"이고
-- 도구를 제한하면 제한된 환경에서의 역량만 측정된다. 실무는 도구를 자유롭게 쓴다.
--
-- 대신 지켜야 하는 것은 **환경의 동일성**이다. 응시자 A 는 개인 API 키가 있고
-- B 는 없으면 그 차이는 능력이 아니라 준비물이다. 그래서 MCP 서버·스킬·검색을
-- 응시자가 각자 들고 오는 것이 아니라 **회차가 전원에게 동일하게 제공**한다.
-- 그 위에서 갈리는 결과가 역량 차이다.
--
-- 사이트 접근 통제(메신저·다른 사이트)는 브라우저 정책 계층으로 내렸다
-- (docs/EXAM_LOCKDOWN.md). 에이전트 안에서는 막지 않는다.

-- ===========================================================================
-- 1. MCP 서버
-- ===========================================================================
create table public.org_mcp_servers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  url         text not null,

  -- 토큰 자체를 두지 않는다. 값이 담긴 엣지 함수 시크릿의 "이름"만 둔다.
  -- DB 가 새더라도 토큰은 새지 않는다.
  secret_env  text,

  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint org_mcp_servers_name_format
    check (name ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$'),
  constraint org_mcp_servers_url_https
    check (url ~ '^https://'),
  -- 시크릿 이름은 환경변수 규격이어야 한다. 여기에 토큰 값을 적어 넣는 사고를
  -- 형식으로 막는다(공백·특수문자가 있으면 통과하지 못한다).
  constraint org_mcp_servers_secret_env_format
    check (secret_env is null or secret_env ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

comment on table public.org_mcp_servers is
  '조직이 시험 에이전트에 붙이는 MCP 서버. 토큰은 secret_env 가 가리키는 엣지 함수 시크릿에 둔다.';
comment on column public.org_mcp_servers.secret_env is
  '토큰이 담긴 엣지 함수 시크릿 이름. 토큰 값을 여기에 적지 말 것 — 형식 제약이 막는다.';

create unique index org_mcp_servers_name_uniq on public.org_mcp_servers (org_id, name);
create index org_mcp_servers_org_idx on public.org_mcp_servers (org_id);

create trigger org_mcp_servers_set_updated_at
  before update on public.org_mcp_servers
  for each row execute function public.set_updated_at();

alter table public.org_mcp_servers enable row level security;

-- Supabase default privileges 가 anon·authenticated 에 ALL 을 준다(0030 참고).
revoke insert, update, delete, truncate on public.org_mcp_servers from anon, authenticated;
revoke select on public.org_mcp_servers from anon;
grant select on public.org_mcp_servers to authenticated;
grant insert, update, delete on public.org_mcp_servers to authenticated;
grant all on public.org_mcp_servers to service_role;

-- 읽기: 조직 구성원. 응시자도 어떤 도구가 붙어 있는지 알아야 한다 —
-- 쓸 수 있는 도구를 숨기면 그건 함정이지 평가가 아니다.
create policy "org mcp read" on public.org_mcp_servers
  for select to authenticated
  using (org_id = any (public.user_org_ids()) or public.is_platform_admin());

-- 쓰기: 조직 관리자만. 응시 환경을 바꾸는 설정이다.
create policy "org mcp write" on public.org_mcp_servers
  for all to authenticated
  using      (public.is_org_admin(org_id) or public.is_platform_admin())
  with check (public.is_org_admin(org_id) or public.is_platform_admin());

-- ===========================================================================
-- 2. 회차별 환경 고정
-- ===========================================================================
-- 같은 회차 응시자는 같은 환경에서 봐야 한다. 회차 도중에 관리자가 MCP 서버를
-- 추가하면 앞서 본 사람과 뒤에 본 사람의 조건이 달라진다. 무엇을 켤지 회차에
-- 적어 두고, 결과에는 그때 무엇이 켜져 있었는지를 남긴다.
alter table public.exams
  add column if not exists agent_env jsonb not null default '{}'::jsonb;

comment on column public.exams.agent_env is
  '이 회차 에이전트 환경. {"mcp":["서버명",...],"skills":["스킬명",...],"web_search":true,"egress":"open"} '
  '비어 있으면 조직 기본값(활성 MCP·스킬 전부, 검색 구성돼 있으면 켬)을 쓴다.';

-- 실제로 무엇이 켜진 채 치렀는지. 채점·이의제기 때 근거가 된다.
alter table public.exam_agent_sessions
  add column if not exists env_snapshot jsonb not null default '{}'::jsonb;

comment on column public.exam_agent_sessions.env_snapshot is
  '작업 공간을 열 때 실제로 적용된 환경(도구 목록·MCP 서버·스킬). 사후에 조건을 되짚는 근거.';
