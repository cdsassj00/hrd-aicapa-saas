-- 0005_competency_model.sql
-- 역량 체계 + 등급 체계 (설계문서 §5)
--
-- 원본은 두 가지를 enum 으로 못박아 두었다.
--   question_category  ('생성형AI활용','데이터분석','서비스구현')  -- 한글 3종 고정
--   exam_grade         ('green','blue','black')                    -- NIA 고유 등급
--
-- 고객사마다 직무역량 모델이 다르고 등급명도 다르다. enum 으로 두면 고객사가
-- 늘 때마다 마이그레이션을 쳐야 하고, 한 DB 안에서 A사 등급과 B사 등급이
-- 같은 타입을 공유하게 된다. 테이블로 푼다.
--
-- NULL org_id = 플랫폼 기본 체계. 모든 조직이 읽을 수 있고, 고객사는 이걸
-- 그대로 쓰거나 복제해서 자기 것으로 고친다. 설계문서 §7 의 0013 시드는
-- 이 파일 끝에 함께 넣었다 — 데이터 없는 역량 모델은 검증도 안 된다.

-- ===========================================================================
-- 1. 역량 체계
-- ===========================================================================
create table public.competency_frameworks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  -- 조직이 새 진단을 만들 때 기본으로 고를 체계
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint competency_frameworks_code_format
    check (code ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  constraint competency_frameworks_name_not_blank
    check (length(btrim(name)) > 0)
);

comment on table public.competency_frameworks is
  '역량 체계. org_id IS NULL 이면 플랫폼 기본(모든 조직 읽기 가능)';
comment on column public.competency_frameworks.org_id is
  'NULL = 플랫폼 공용. 값이 있으면 그 조직 전용';

-- 같은 소유자 안에서 code 는 유일. 플랫폼(NULL)과 조직은 서로 간섭하지 않는다.
-- org_id 가 NULL 이면 일반 UNIQUE 가 중복을 못 막으므로 부분 인덱스 두 개로 나눈다.
create unique index competency_frameworks_org_code_uniq
  on public.competency_frameworks (org_id, code) where org_id is not null;
create unique index competency_frameworks_platform_code_uniq
  on public.competency_frameworks (code) where org_id is null;

create index competency_frameworks_org_idx on public.competency_frameworks (org_id);

create trigger competency_frameworks_set_updated_at
  before update on public.competency_frameworks
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. 역량 (계층 구조)
-- ===========================================================================
-- 대분류(생성형AI활용) → 중분류(프롬프트 설계) 처럼 트리를 이룬다.
-- org_id 는 framework 에서 상속받아 비정규화한다 — RLS 는 행마다 평가되므로
-- 매번 framework 를 조인하면 대량 조회에서 그대로 비용이 된다(설계문서 §4).
create table public.competencies (
  id           uuid primary key default gen_random_uuid(),
  framework_id uuid not null references public.competency_frameworks(id) on delete cascade,
  org_id       uuid references public.organizations(id) on delete cascade,
  parent_id    uuid references public.competencies(id) on delete cascade,
  code         text not null,
  name         text not null,
  description  text,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint competencies_code_format
    check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,48}$'),
  constraint competencies_name_not_blank
    check (length(btrim(name)) > 0),
  constraint competencies_no_self_parent
    check (parent_id is null or parent_id <> id),

  unique (framework_id, code)
);

comment on table public.competencies is
  '역량 항목. 계층 구조(parent_id). org_id 는 framework 에서 트리거로 상속 — RLS 성능';

create index competencies_framework_idx on public.competencies (framework_id, sort_order);
create index competencies_parent_idx    on public.competencies (parent_id);
create index competencies_org_idx       on public.competencies (org_id);

create trigger competencies_set_updated_at
  before update on public.competencies
  for each row execute function public.set_updated_at();

-- org_id 상속. 앱이 직접 넣게 두면 언젠가 framework 와 어긋난 행이 생기고,
-- 그 순간 그 행은 RLS 상 다른 조직 소유가 된다 — 조용한 유출이다.
create or replace function public.inherit_org_from_framework()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _fw_org uuid;
  _found  boolean;
begin
  select org_id, true into _fw_org, _found
  from public.competency_frameworks
  where id = new.framework_id;

  if not coalesce(_found, false) then
    raise exception '존재하지 않는 역량 체계입니다: %', new.framework_id
      using errcode = 'foreign_key_violation';
  end if;

  new.org_id := _fw_org;   -- 플랫폼 기본이면 NULL 그대로
  return new;
end $$;

revoke all on function public.inherit_org_from_framework() from public, anon, authenticated;

create trigger competencies_inherit_org
  before insert or update of framework_id on public.competencies
  for each row execute function public.inherit_org_from_framework();

-- 부모 역량은 같은 체계 안에 있어야 한다. 체계를 넘나드는 트리는 말이 안 되고,
-- 조직을 넘나들면 경계 위반이다.
create or replace function public.check_competency_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _parent_fw uuid;
begin
  if new.parent_id is null then return new; end if;

  select framework_id into _parent_fw from public.competencies where id = new.parent_id;
  if _parent_fw is distinct from new.framework_id then
    raise exception '상위 역량은 같은 역량 체계 안에 있어야 합니다'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.check_competency_parent() from public, anon, authenticated;

create trigger competencies_check_parent
  before insert or update of parent_id, framework_id on public.competencies
  for each row execute function public.check_competency_parent();

-- ===========================================================================
-- 3. 등급 체계
-- ===========================================================================
create table public.grade_scales (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint grade_scales_code_format
    check (code ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  constraint grade_scales_name_not_blank
    check (length(btrim(name)) > 0)
);

comment on table public.grade_scales is
  '등급 체계. 원본의 exam_grade enum(green/blue/black) 대체. NULL org_id = 플랫폼 기본';

create unique index grade_scales_org_code_uniq
  on public.grade_scales (org_id, code) where org_id is not null;
create unique index grade_scales_platform_code_uniq
  on public.grade_scales (code) where org_id is null;

create index grade_scales_org_idx on public.grade_scales (org_id);

create trigger grade_scales_set_updated_at
  before update on public.grade_scales
  for each row execute function public.set_updated_at();

-- 등급 하나하나. 합격선을 여기 두면 회차마다 다시 정하지 않아도 된다.
create table public.grade_levels (
  id          uuid primary key default gen_random_uuid(),
  scale_id    uuid not null references public.grade_scales(id) on delete cascade,
  org_id      uuid references public.organizations(id) on delete cascade,
  code        text not null,
  name        text not null,
  -- 이 등급을 받기 위한 최소 백분율. 100점 만점 환산 기준.
  min_percent numeric(5,2) not null,
  -- 이 등급 이상이면 '합격'으로 본다
  is_passing  boolean not null default true,
  color       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint grade_levels_min_percent_range
    check (min_percent >= 0 and min_percent <= 100),
  constraint grade_levels_color_format
    check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),

  unique (scale_id, code)
);

comment on table public.grade_levels is
  '등급 항목. min_percent 오름차순으로 구간을 이룬다';

create index grade_levels_scale_idx on public.grade_levels (scale_id, min_percent desc);
create index grade_levels_org_idx   on public.grade_levels (org_id);

create trigger grade_levels_set_updated_at
  before update on public.grade_levels
  for each row execute function public.set_updated_at();

create or replace function public.inherit_org_from_grade_scale()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _org uuid;
  _found boolean;
begin
  select org_id, true into _org, _found from public.grade_scales where id = new.scale_id;
  if not coalesce(_found, false) then
    raise exception '존재하지 않는 등급 체계입니다: %', new.scale_id
      using errcode = 'foreign_key_violation';
  end if;
  new.org_id := _org;
  return new;
end $$;

revoke all on function public.inherit_org_from_grade_scale() from public, anon, authenticated;

create trigger grade_levels_inherit_org
  before insert or update of scale_id on public.grade_levels
  for each row execute function public.inherit_org_from_grade_scale();

-- ===========================================================================
-- 4. 권한 · RLS
-- ===========================================================================
alter table public.competency_frameworks enable row level security;
alter table public.competencies          enable row level security;
alter table public.grade_scales          enable row level security;
alter table public.grade_levels          enable row level security;

grant select, insert, update, delete on
  public.competency_frameworks, public.competencies,
  public.grade_scales, public.grade_levels
  to authenticated;
grant all on
  public.competency_frameworks, public.competencies,
  public.grade_scales, public.grade_levels
  to service_role;

-- 읽기: 플랫폼 기본(NULL) + 내 조직 것.
-- org_id = any(user_org_ids()) 는 NULL 에 대해 false 라서 IS NULL 을 따로 써야 한다.
-- 이걸 빠뜨리면 플랫폼 기본 체계가 아무에게도 안 보인다.
create policy "framework read" on public.competency_frameworks
  for select to authenticated
  using (org_id is null or org_id = any (public.user_org_ids()) or public.is_platform_admin());

create policy "competency read" on public.competencies
  for select to authenticated
  using (org_id is null or org_id = any (public.user_org_ids()) or public.is_platform_admin());

create policy "grade scale read" on public.grade_scales
  for select to authenticated
  using (org_id is null or org_id = any (public.user_org_ids()) or public.is_platform_admin());

create policy "grade level read" on public.grade_levels
  for select to authenticated
  using (org_id is null or org_id = any (public.user_org_ids()) or public.is_platform_admin());

-- 쓰기: 자기 조직 것만. 플랫폼 기본(NULL)은 platform_admins 만 건드린다.
-- 조직 관리자가 플랫폼 기본을 고치면 전 고객사에 영향이 간다.
create policy "framework write" on public.competency_frameworks
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

create policy "competency write" on public.competencies
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

create policy "grade scale write" on public.grade_scales
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

create policy "grade level write" on public.grade_levels
  for all to authenticated
  using      ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin())
  with check ((org_id is not null and public.is_org_admin(org_id)) or public.is_platform_admin());

-- ===========================================================================
-- 5. 조직 전용 사본 만들기
-- ===========================================================================
-- 고객사가 플랫폼 기본에서 출발해 자기 것으로 고치는 경로. 처음부터
-- 백지에서 역량 체계를 세우라고 하면 도입이 거기서 멈춘다.
create or replace function public.clone_framework_to_org(
  _framework_id uuid,
  _org_id       uuid,
  _new_code     text,
  _new_name     text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _src public.competency_frameworks;
  _new_id uuid;
begin
  if not (public.is_org_admin(_org_id) or public.is_platform_admin()) then
    raise exception '조직 관리자만 복제할 수 있습니다' using errcode = 'insufficient_privilege';
  end if;

  select * into _src from public.competency_frameworks where id = _framework_id;
  if _src.id is null then
    raise exception '역량 체계를 찾을 수 없습니다' using errcode = 'invalid_parameter_value';
  end if;

  -- 볼 수 있는 것만 복제할 수 있다(플랫폼 기본 또는 자기 조직 것)
  if _src.org_id is not null and _src.org_id <> _org_id and not public.is_platform_admin() then
    raise exception '다른 조직의 역량 체계는 복제할 수 없습니다' using errcode = 'insufficient_privilege';
  end if;

  insert into public.competency_frameworks (org_id, code, name, description)
  values (_org_id, _new_code, _new_name, _src.description)
  returning id into _new_id;

  -- 1) 평면 복사. parent_id 는 아직 비워 둔다.
  insert into public.competencies (framework_id, code, name, description, sort_order)
  select _new_id, code, name, description, sort_order
  from public.competencies
  where framework_id = _framework_id;

  -- 2) 계층 재연결. 반드시 별도 문장이어야 한다 — 데이터 수정 CTE 가 삽입한
  --    행은 같은 문장의 다른 부분에서 보이지 않아서, 한 문장으로 묶으면
  --    UPDATE 가 0행을 갱신하고 계층이 통째로 사라진다.
  update public.competencies child
     set parent_id = new_parent.id
    from public.competencies src_child
    join public.competencies src_parent on src_parent.id = src_child.parent_id
    join public.competencies new_parent
      on new_parent.framework_id = _new_id and new_parent.code = src_parent.code
   where src_child.framework_id = _framework_id
     and child.framework_id = _new_id
     and child.code = src_child.code;

  return _new_id;
end $$;

comment on function public.clone_framework_to_org(uuid, uuid, text, text) is
  '역량 체계를 조직 전용으로 복제(계층 보존). 플랫폼 기본에서 출발하는 경로';

revoke all on function public.clone_framework_to_org(uuid, uuid, text, text) from public, anon;
grant execute on function public.clone_framework_to_org(uuid, uuid, text, text)
  to authenticated, service_role;

-- ===========================================================================
-- 6. 플랫폼 기본 시드
-- ===========================================================================
-- 원본(NIA/AI CAPA)의 체계를 플랫폼 기본값으로 넣는다. 고객사는 이걸 그대로
-- 쓰거나 clone_framework_to_org 로 복제해 고친다.
insert into public.competency_frameworks (org_id, code, name, description, is_default)
values (null, 'ai-utilization',
        'AI 활용 역량 (기본)',
        '생성형 AI 도구를 업무에 적용하는 능력을 세 영역으로 나눈 기본 체계입니다. 고객사 직무역량 모델이 있으면 복제해서 고쳐 쓰세요.',
        true);

with fw as (select id from public.competency_frameworks where org_id is null and code = 'ai-utilization')
insert into public.competencies (framework_id, code, name, description, sort_order)
select fw.id, v.code, v.name, v.description, v.sort_order
from fw, (values
  ('GEN',      '생성형 AI 활용', '프롬프트 설계, 도구 선택, 결과 검증까지 실제 업무 산출물을 만드는 능력', 10),
  ('GEN.PMT',  '프롬프트 설계',   '의도를 정확히 전달하고 원하는 형식으로 결과를 받아내는 능력',            11),
  ('GEN.VER',  '결과 검증',       '환각·편향·저작권 문제를 식별하고 사실을 확인하는 능력',                  12),
  ('DATA',     '데이터 분석',     '업무 데이터를 정리·해석하고 의사결정 근거로 만드는 능력',                20),
  ('DATA.PREP','데이터 정리',     '결측·이상치를 처리하고 분석 가능한 형태로 만드는 능력',                  21),
  ('DATA.INS', '해석과 시각화',   '분석 결과를 의사결정자가 이해할 형태로 전달하는 능력',                    22),
  ('SVC',      '서비스 구현',     'AI 기능을 실제 업무 프로세스에 붙여 동작하게 만드는 능력',              30),
  ('SVC.AUTO', '업무 자동화',     '반복 업무를 도구로 자동화하는 능력',                                    31),
  ('SVC.INT',  '연동과 배포',     'API·기존 시스템과 연결해 운영 가능한 형태로 만드는 능력',               32)
) as v(code, name, description, sort_order);

-- 하위 역량을 대분류에 연결
update public.competencies c
   set parent_id = p.id
  from public.competencies p
 where c.framework_id = p.framework_id
   and p.org_id is null
   and c.code like p.code || '.%'
   and c.code <> p.code;

-- NIA 등급 체계를 플랫폼 기본으로
insert into public.grade_scales (org_id, code, name, description, is_default)
values (null, 'nia-3tier', 'AI 챔피언 등급 (기본)',
        '그린 / 블루 / 블랙 3단계. 고객사 등급명이 따로 있으면 자체 체계를 만들어 쓰세요.', true);

with gs as (select id from public.grade_scales where org_id is null and code = 'nia-3tier')
insert into public.grade_levels (scale_id, code, name, min_percent, is_passing, color, sort_order)
select gs.id, v.code, v.name, v.min_percent, v.is_passing, v.color, v.sort_order
from gs, (values
  ('black', '블랙', 90.00, true,  '#1d1d1f', 30),
  ('blue',  '블루', 75.00, true,  '#0a84ff', 20),
  ('green', '그린', 60.00, true,  '#30d158', 10),
  ('none',  '미달',  0.00, false, '#98989d',  0)
) as v(code, name, min_percent, is_passing, color, sort_order);
