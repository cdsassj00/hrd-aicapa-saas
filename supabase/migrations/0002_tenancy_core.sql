-- 0002_tenancy_core.sql
-- 테넌시 코어: organizations / org_branding / org_members / platform_admins
-- (설계문서 §3)
--
-- RLS 는 여기서 '켜기만' 합니다. 정책은 기반 함수(user_org_ids 등)가 생기는
-- 0003 에서 붙습니다. 그 사이 상태는 "RLS on + 정책 0개" = 전면 거부이므로
-- 중간 상태에서도 데이터가 새지 않습니다.

-- ---------------------------------------------------------------------------
-- 공통 헬퍼
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;

comment on function public.set_updated_at() is
  'updated_at 자동 갱신 트리거. SECURITY INVOKER — 권한 상승 없음';

-- 트리거 전용 함수는 PostgREST 의 /rpc 로 노출될 이유가 없습니다.
-- 트리거 발화에는 호출자의 EXECUTE 권한이 필요하지 않으므로 전부 회수합니다.
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- organizations — 고객사. 모든 테넌시의 루트
-- ---------------------------------------------------------------------------
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  slug       text        not null unique,
  name       text        not null,
  biz_reg_no text,
  status     public.org_status not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- acme.aicapa.io 서브도메인으로 그대로 쓰이므로 호스트명 규칙을 DB에서 강제
  constraint organizations_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'),

  -- 서브도메인 선점 방지. 예약어는 조직에 내주지 않습니다
  constraint organizations_slug_not_reserved
    check (slug not in (
      'www', 'api', 'app', 'admin', 'auth', 'cdn', 'mail', 'static',
      'status', 'support', 'docs', 'blog', 'platform', 'internal'
    )),

  constraint organizations_name_not_blank
    check (length(btrim(name)) > 0),

  -- 사업자등록번호는 하이픈 없는 10자리로 정규화해서 저장
  constraint organizations_biz_reg_no_format
    check (biz_reg_no is null or biz_reg_no ~ '^[0-9]{10}$')
);

comment on table public.organizations is '고객사(테넌트). org_id 의 참조 대상';
comment on column public.organizations.slug is '서브도메인. 호스트명 규칙 + 예약어 차단';
comment on column public.organizations.status is
  'trial/active 만 정상. suspended 는 미납·보안사고 시 쓰기 차단용';

create index organizations_status_idx on public.organizations (status);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- org_branding — 화이트라벨. 원본 site_settings(단일 행)의 테넌트판
-- ---------------------------------------------------------------------------
create table public.org_branding (
  org_id        uuid primary key references public.organizations(id) on delete cascade,
  logo_url      text,
  primary_color text,
  cert_template jsonb not null default '{}'::jsonb,
  custom_domain text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint org_branding_primary_color_format
    check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),

  constraint org_branding_custom_domain_format
    check (custom_domain is null or
           custom_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$')
);

comment on table public.org_branding is
  '테넌트별 화이트라벨. 로그인 화면에서 익명 사용자가 읽어야 하므로 0003 에서 공개 읽기 정책을 부여';

create trigger org_branding_set_updated_at
  before update on public.org_branding
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- org_members — 사용자 × 조직 × 역할. 원본 user_roles 대체
-- ---------------------------------------------------------------------------
-- PK 에 role 이 들어가므로 한 사용자가 한 조직에서 복수 역할을 가질 수 있습니다
-- (예: org_admin + examiner). 상태는 역할별로 개별 관리됩니다.
create table public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role   not null,
  status     public.member_status not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id, role)
);

comment on table public.org_members is
  '멤버십. RLS 의 진실 공급원 — JWT 클레임이 아니라 반드시 이 테이블을 조회할 것(§6.3)';
comment on column public.org_members.status is
  'active 만 권한을 가짐. invited/suspended 는 user_org_ids() 에 포함되지 않음';

-- user_org_ids() 가 (user_id, status) 로 조회하고 RLS 는 행마다 평가되므로
-- 이 인덱스가 사실상 전 테이블 조회 성능을 좌우합니다.
create index org_members_user_active_idx
  on public.org_members (user_id, status) include (org_id, role);

create index org_members_org_idx on public.org_members (org_id);

create trigger org_members_set_updated_at
  before update on public.org_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- platform_admins — 플랫폼 운영자. 조직 밖에 존재
-- ---------------------------------------------------------------------------
-- org_members 에 섞으면 안 됩니다. 섞는 순간 조직 관리자가
-- 자기 조직에 전역 권한을 부여할 수 있게 됩니다.
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  '전역 운영자. 쓰기 정책을 일부러 만들지 않음 — service_role/DB 콘솔로만 변경 가능';

-- ---------------------------------------------------------------------------
-- RLS 활성화 (정책은 0003)
-- ---------------------------------------------------------------------------
alter table public.organizations   enable row level security;
alter table public.org_branding    enable row level security;
alter table public.org_members     enable row level security;
alter table public.platform_admins enable row level security;

-- ---------------------------------------------------------------------------
-- 테이블 권한
-- ---------------------------------------------------------------------------
-- Supabase 기본 권한은 anon/authenticated 에 DML 을 주지 않습니다. RLS 정책만
-- 쓰고 GRANT 를 빠뜨리면 정책이 아니라 "permission denied" 로 막히는데,
-- 이건 보안이 아니라 버그로 나타납니다. 명시적으로 부여합니다.
-- 방어선은 어디까지나 아래 GRANT 가 아니라 0003 의 RLS 정책입니다.

-- organizations: INSERT 는 주지 않습니다 — public.create_organization() 경유(0003)
grant select, update, delete on public.organizations   to authenticated;
grant select, insert, update, delete on public.org_branding to authenticated;
grant select on public.org_branding                    to anon;  -- 로그인 화면 화이트라벨
grant select, insert, update, delete on public.org_members  to authenticated;
grant select on public.platform_admins                 to authenticated;

grant all on public.organizations, public.org_branding,
             public.org_members, public.platform_admins to service_role;
