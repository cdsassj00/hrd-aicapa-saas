-- 0033_org_agent_skills.sql
-- 조직별 에이전트 스킬 — 시험 중 에이전트가 따라야 할 추가 지시문.
--
-- 스킬은 모델도 도구도 아니고 "이 기관에서는 이렇게 쓴다"는 규칙 묶음이다.
-- 예: 공문 서식 규칙, 금칙어·용어 사전, 보고서 항목 순서, 단위 표기 규칙.
-- 시스템 프롬프트에 덧붙어 들어간다(_shared/examAgent.ts systemPrompt).
--
-- 경계가 중요하다.
--   · 스킬에 채점 기준을 넣으면 응시자에게 답을 넘기는 것이다. 그래서 스킬은
--     조직 관리자만 쓰고, 평가자(examiner)에게도 쓰기를 주지 않는다.
--   · 플랫폼 공용 스킬은 두지 않는다. 기관마다 규칙이 다른 것이 스킬의 존재
--     이유이고, 공용 스킬은 결국 모든 응시자의 프롬프트를 똑같이 바꾼다 —
--     그건 시스템 프롬프트에서 할 일이지 데이터로 할 일이 아니다.

create table public.org_agent_skills (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  body       text not null,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint org_agent_skills_name_not_blank check (length(btrim(name)) > 0),
  constraint org_agent_skills_body_not_blank check (length(btrim(body)) > 0),
  -- 프롬프트에 그대로 들어간다. 길이를 막지 않으면 한 조직이 컨텍스트를
  -- 통째로 먹어 치우고 비용과 품질이 같이 무너진다.
  constraint org_agent_skills_body_bounded check (length(body) <= 8000)
);

comment on table public.org_agent_skills is
  '조직별 에이전트 지시문(스킬). 시험 중 시스템 프롬프트에 덧붙는다. 채점 기준을 넣지 말 것.';

create unique index org_agent_skills_name_uniq on public.org_agent_skills (org_id, name);
create index org_agent_skills_org_idx on public.org_agent_skills (org_id);

create trigger org_agent_skills_set_updated_at
  before update on public.org_agent_skills
  for each row execute function public.set_updated_at();

alter table public.org_agent_skills enable row level security;

-- Supabase default privileges 가 anon·authenticated 에 ALL 을 준다(0030 참고).
-- 정책만으로는 UPDATE·DELETE 가 막히지 않으므로 먼저 회수한다.
revoke insert, update, delete, truncate on public.org_agent_skills from anon, authenticated;
revoke select on public.org_agent_skills from anon;
grant select on public.org_agent_skills to authenticated;
grant insert, update, delete on public.org_agent_skills to authenticated;
grant all on public.org_agent_skills to service_role;

-- 읽기: 그 조직 구성원. 응시자도 자기 조직 스킬이 무엇인지 볼 수 있어야 한다 —
-- 시험 중 에이전트가 따르는 규칙을 숨길 이유가 없고, 숨기면 결과만 이상해진다.
create policy "org agent skill read" on public.org_agent_skills
  for select to authenticated
  using (org_id = any (public.user_org_ids()) or public.is_platform_admin());

-- 쓰기: 조직 관리자만. 평가자는 제외한다 — 스킬은 응시 조건을 바꾸는 설정이다.
create policy "org agent skill write" on public.org_agent_skills
  for all to authenticated
  using      (public.is_org_admin(org_id) or public.is_platform_admin())
  with check (public.is_org_admin(org_id) or public.is_platform_admin());
