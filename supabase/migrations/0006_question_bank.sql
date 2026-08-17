-- 0006_question_bank.sql
-- 문제은행 + 소유권/라이선스 (설계문서 §5)
--
-- HRD SaaS 에서 파는 것은 플랫폼이 아니라 진단 콘텐츠다. 문제은행 모델이
-- 곧 가격표다. 세 가지 소유 형태를 처음부터 분리해 둔다.
--
--   platform  플랫폼 공용. 구독에 포함되어 모든 조직이 읽는다.
--   licensed  프리미엄 세트. 라이선스를 산 조직만 읽는다.
--   org       고객사가 만든 문항. 그 조직 자산이며 밖으로 나가지 않는다.
--
-- 설계문서는 소유 컬럼을 owner_org_id 라고 적었지만 org_id 로 쓴다.
-- 0002~0005 가 전부 org_id 이고 CI 가드도 그 이름을 본다. 이름을 하나만
-- 다르게 두면 가드 예외를 하나 파야 하는데, 그 예외가 나중에 진짜 누락을
-- 가려 준다. 의미는 동일하다 — NULL 이면 플랫폼 소유.

-- ===========================================================================
-- 1. 타입
-- ===========================================================================
create type public.question_type as enum (
  'multiple_choice',  -- 객관식
  'short_answer',     -- 단답형
  'essay',            -- 서술형
  'file_upload',      -- 산출물 제출
  'work_based'        -- 수행형(슬롯 단위 채점)
);

-- ===========================================================================
-- 2. 문항
-- ===========================================================================
create table public.questions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete cascade,
  visibility  public.question_visibility not null default 'org',
  type        public.question_type not null,
  content     text not null,
  difficulty  public.question_difficulty not null default 'medium',
  points      int not null default 10,

  -- 정답·채점 기준. 타입마다 모양이 달라 jsonb 로 둔다.
  --   multiple_choice : { "options":[{"id","text","is_correct"}] }
  --   work_based      : { "slots":[{"id","label","max_score","rubric"}] }
  answer_key  jsonb not null default '{}'::jsonb,
  rubric      text,
  attachments jsonb not null default '[]'::jsonb,

  is_active   boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint questions_content_not_blank check (length(btrim(content)) > 0),
  constraint questions_points_positive   check (points > 0),

  -- 소유와 공개 범위는 짝이 맞아야 한다. 조직 소유인데 platform 공개면
  -- 그 조직 문항이 전 고객사에 열린다 — 자산 유출이다.
  constraint questions_visibility_matches_owner check (
    (visibility = 'org' and org_id is not null) or
    (visibility in ('platform', 'licensed') and org_id is null)
  )
);

comment on table public.questions is
  '문항. org_id IS NULL = 플랫폼 소유(platform/licensed), 값이 있으면 그 조직 자산';
comment on column public.questions.answer_key is
  '타입별 정답·슬롯 정의. 응시자에게 절대 내려가면 안 되는 값 — 조회 경로를 분리할 것';

create index questions_org_idx        on public.questions (org_id) where is_active;
create index questions_visibility_idx on public.questions (visibility) where is_active;
create index questions_type_idx       on public.questions (type);

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. 문항 × 역량 매핑
-- ===========================================================================
-- 이 매핑이 있어야 결과가 총점이 아니라 "어느 역량이 약한지"로 나온다.
-- 0005 의 역량 체계와 여기서 만난다.
create table public.question_competencies (
  question_id   uuid not null references public.questions(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete cascade,
  org_id        uuid references public.organizations(id) on delete cascade,
  weight        numeric(4,2) not null default 1.00,
  created_at    timestamptz not null default now(),

  primary key (question_id, competency_id),
  constraint question_competencies_weight_positive check (weight > 0)
);

comment on table public.question_competencies is
  '문항이 어떤 역량을 측정하는지. 결과를 역량별로 쪼개는 근거';

create index question_competencies_competency_idx
  on public.question_competencies (competency_id);
create index question_competencies_org_idx on public.question_competencies (org_id);

create or replace function public.inherit_org_from_question()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _org uuid; _found boolean;
begin
  select org_id, true into _org, _found from public.questions where id = new.question_id;
  if not coalesce(_found, false) then
    raise exception '존재하지 않는 문항입니다: %', new.question_id
      using errcode = 'foreign_key_violation';
  end if;
  new.org_id := _org;
  return new;
end $$;

revoke all on function public.inherit_org_from_question() from public, anon, authenticated;

create trigger question_competencies_inherit_org
  before insert or update of question_id on public.question_competencies
  for each row execute function public.inherit_org_from_question();

-- ===========================================================================
-- 4. 문항 세트
-- ===========================================================================
-- 판매 단위이자 출제 단위. licensed 세트가 곧 애드온 상품이다.
create table public.question_sets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete cascade,
  visibility  public.question_visibility not null default 'org',
  code        text not null,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint question_sets_code_format check (code ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  constraint question_sets_name_not_blank check (length(btrim(name)) > 0),
  constraint question_sets_visibility_matches_owner check (
    (visibility = 'org' and org_id is not null) or
    (visibility in ('platform', 'licensed') and org_id is null)
  )
);

comment on table public.question_sets is
  '문항 묶음. visibility=licensed 인 세트가 애드온 판매 단위';

create unique index question_sets_org_code_uniq
  on public.question_sets (org_id, code) where org_id is not null;
create unique index question_sets_platform_code_uniq
  on public.question_sets (code) where org_id is null;

create index question_sets_org_idx on public.question_sets (org_id);

create trigger question_sets_set_updated_at
  before update on public.question_sets
  for each row execute function public.set_updated_at();

create table public.question_set_items (
  set_id         uuid not null references public.question_sets(id) on delete cascade,
  question_id    uuid not null references public.questions(id) on delete cascade,
  org_id         uuid references public.organizations(id) on delete cascade,
  sort_order     int not null default 0,
  points_override int,
  created_at     timestamptz not null default now(),

  primary key (set_id, question_id),
  constraint question_set_items_points_positive
    check (points_override is null or points_override > 0)
);

create index question_set_items_question_idx on public.question_set_items (question_id);
create index question_set_items_org_idx      on public.question_set_items (org_id);

create or replace function public.inherit_org_from_question_set()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _set_org uuid; _q_org uuid; _found boolean;
begin
  select org_id, true into _set_org, _found from public.question_sets where id = new.set_id;
  if not coalesce(_found, false) then
    raise exception '존재하지 않는 문항 세트입니다: %', new.set_id
      using errcode = 'foreign_key_violation';
  end if;

  select org_id into _q_org from public.questions where id = new.question_id;

  -- 조직 세트에 남의 조직 문항을 담을 수 없다. 플랫폼 문항은 담을 수 있다
  -- (구독에 포함된 자산이므로).
  if _q_org is not null and _set_org is distinct from _q_org then
    raise exception '다른 조직의 문항은 담을 수 없습니다' using errcode = 'insufficient_privilege';
  end if;

  new.org_id := _set_org;
  return new;
end $$;

revoke all on function public.inherit_org_from_question_set() from public, anon, authenticated;

create trigger question_set_items_inherit_org
  before insert or update of set_id, question_id on public.question_set_items
  for each row execute function public.inherit_org_from_question_set();

-- ===========================================================================
-- 5. 라이선스
-- ===========================================================================
-- 어느 조직이 어느 licensed 세트를 샀는지. 과금(0010)이 붙기 전까지는
-- 플랫폼 운영자가 수동으로 넣는다.
create table public.question_licenses (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  set_id     uuid not null references public.question_sets(id) on delete cascade,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  note       text,

  primary key (org_id, set_id)
);

comment on table public.question_licenses is
  'licensed 문항 세트 구매 이력. expires_at IS NULL = 무기한';

create index question_licenses_set_idx on public.question_licenses (set_id);

-- ===========================================================================
-- 6. 접근 판정 함수
-- ===========================================================================
-- 문항 하나가 지금 사용자에게 보여도 되는지. RLS 정책이 행마다 호출하므로
-- SQL 함수 + STABLE 로 두어 플래너가 인라인할 수 있게 한다.
create or replace function public.org_has_question_license(_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.question_licenses l
    where l.set_id = _set_id
      and l.org_id = any (public.user_org_ids())
      and (l.expires_at is null or l.expires_at > now())
  )
$$;

comment on function public.org_has_question_license(uuid) is
  'licensed 세트 접근권. 만료된 라이선스는 즉시 차단된다';

-- licensed 문항은 세트를 통해서만 팔린다. 어느 세트로든 라이선스가 있으면 읽는다.
create or replace function public.can_read_licensed_question(_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.question_set_items i
    join public.question_licenses l on l.set_id = i.set_id
    where i.question_id = _question_id
      and l.org_id = any (public.user_org_ids())
      and (l.expires_at is null or l.expires_at > now())
  )
$$;

revoke all on function public.org_has_question_license(uuid)   from public, anon;
revoke all on function public.can_read_licensed_question(uuid) from public, anon;
grant execute on function public.org_has_question_license(uuid)   to authenticated, service_role;
grant execute on function public.can_read_licensed_question(uuid) to authenticated, service_role;

-- ===========================================================================
-- 7. 권한 · RLS
-- ===========================================================================
alter table public.questions             enable row level security;
alter table public.question_competencies enable row level security;
alter table public.question_sets         enable row level security;
alter table public.question_set_items    enable row level security;
alter table public.question_licenses     enable row level security;

grant select, insert, update, delete on
  public.questions, public.question_competencies,
  public.question_sets, public.question_set_items to authenticated;
grant select on public.question_licenses to authenticated;
grant all on
  public.questions, public.question_competencies, public.question_sets,
  public.question_set_items, public.question_licenses to service_role;

-- 읽기 (설계문서 §5의 정책을 그대로 옮긴 것)
create policy "question read" on public.questions
  for select to authenticated
  using (
    visibility = 'platform'
    or (visibility = 'org' and org_id = any (public.user_org_ids()))
    or (visibility = 'licensed' and public.can_read_licensed_question(id))
    or public.is_platform_admin()
  );

create policy "question set read" on public.question_sets
  for select to authenticated
  using (
    visibility = 'platform'
    or (visibility = 'org' and org_id = any (public.user_org_ids()))
    or (visibility = 'licensed' and public.org_has_question_license(id))
    or public.is_platform_admin()
  );

-- 자식 테이블은 부모가 보이면 보인다. 부모 정책을 두 번 쓰지 않도록 EXISTS 로 위임.
create policy "question competency read" on public.question_competencies
  for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));

create policy "question set item read" on public.question_set_items
  for select to authenticated
  using (exists (select 1 from public.question_sets s where s.id = set_id));

create policy "license read" on public.question_licenses
  for select to authenticated
  using (org_id = any (public.user_org_ids()) or public.is_platform_admin());

-- 쓰기: 자기 조직 문항만. 플랫폼 문항(org_id IS NULL)은 platform_admins 만.
-- 조직 관리자가 플랫폼 문항을 고치면 전 고객사의 진단이 바뀐다.
create policy "question write" on public.questions
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

create policy "question competency write" on public.question_competencies
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

create policy "question set write" on public.question_sets
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

create policy "question set item write" on public.question_set_items
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

-- 라이선스는 판매 기록이다. 조직이 스스로 부여할 수 없어야 한다 —
-- 그럴 수 있으면 유료 콘텐츠가 공짜가 된다. 쓰기 정책을 두지 않는다.

-- ===========================================================================
-- 8. 응시자에게 정답을 내리지 않기 위한 뷰
-- ===========================================================================
-- questions.answer_key 에는 정답과 채점 기준이 들어 있다. 응시 화면이
-- questions 를 직접 select 하면 네트워크 탭에서 정답이 보인다.
-- 응시 경로는 반드시 이 뷰를 쓴다.
create view public.questions_public
with (security_invoker = true)
as
select id, org_id, visibility, type, content, difficulty, points,
       attachments, is_active, created_at,
       -- 객관식 보기는 필요하지만 is_correct 는 빼고 내려보낸다
       case when type = 'multiple_choice'
            then jsonb_build_object(
              'options',
              coalesce((
                select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')
                                 order by ord)
                from jsonb_array_elements(answer_key->'options') with ordinality as t(o, ord)
              ), '[]'::jsonb))
            when type = 'work_based'
            then jsonb_build_object(
              'slots',
              coalesce((
                select jsonb_agg(jsonb_build_object('id', s->>'id', 'label', s->>'label',
                                                    'max_score', s->'max_score')
                                 order by ord)
                from jsonb_array_elements(answer_key->'slots') with ordinality as t(s, ord)
              ), '[]'::jsonb))
            else '{}'::jsonb
       end as prompt_data
from public.questions;

comment on view public.questions_public is
  '응시자용 문항 뷰. answer_key 의 정답(is_correct)·루브릭을 제거한다. '
  'security_invoker=true 라 questions 의 RLS 가 그대로 적용된다';

grant select on public.questions_public to authenticated;
