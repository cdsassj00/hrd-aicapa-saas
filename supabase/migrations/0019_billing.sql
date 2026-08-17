-- 0019_billing.sql
-- 과금 기반 테이블 (설계문서 §3/§7, 착수 순서 9번 — 첫 유료 고객 직전).
-- plans 는 플랫폼 공용 카탈로그라 org_id 가 없다(tenancy_guard 예외 등록됨).
-- 나머지는 전부 org_id + FK + RLS 로 테넌트 격리. 쓰기는 결제 특성상 중앙(플랫폼/
-- service_role)에서만 — 조직은 자기 구독/사용량을 읽기만 한다.

-- ── plans : 플랫폼 공용 요금제 카탈로그 ──
create table public.plans (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  price_monthly     integer not null default 0,     -- 월 요금(KRW)
  currency          text not null default 'KRW',
  max_members       integer,                          -- null = 무제한
  max_exams_monthly integer,                          -- null = 무제한
  features          jsonb not null default '[]'::jsonb,
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.plans enable row level security;
-- 카탈로그: 로그인 사용자는 활성 요금제를 읽고(요금 안내), 쓰기는 플랫폼 운영자만.
create policy "plans read" on public.plans
  for select to authenticated
  using (is_active or public.is_platform_admin());
create policy "plans platform write" on public.plans
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
create trigger plans_set_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

-- ── subscriptions : 조직별 구독 ──
create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  plan_id              uuid not null references public.plans(id) on delete restrict,
  status               text not null default 'trialing',  -- trialing/active/past_due/canceled
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  external_ref         text,                               -- 결제사 구독 식별자
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id)                                          -- 조직당 구독 1개
);
alter table public.subscriptions enable row level security;
create index subscriptions_org_idx on public.subscriptions (org_id);
-- 조직 멤버는 자기 조직 구독을 읽고, 변경은 플랫폼 운영자/서비스 롤만(결제 결과 반영).
create policy "subscription read" on public.subscriptions
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());
create policy "subscription platform write" on public.subscriptions
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ── usage_events : 사용량 계량(append-only) ──
create table public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,                        -- exam_created / session_graded / ai_generation / recording_minutes ...
  quantity   integer not null default 1,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.usage_events enable row level security;
create index usage_events_org_idx on public.usage_events (org_id, created_at desc);
-- 조직 스태프·플랫폼 운영자 조회. 기록(INSERT)은 계량 잡(service_role)만 → 쓰기 정책 없음.
create policy "usage read" on public.usage_events
  for select to authenticated
  using (public.is_org_examiner(org_id) or public.is_platform_admin());

-- ── audit_logs : 감사 로그(append-only) ──
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create index audit_logs_org_idx on public.audit_logs (org_id, created_at desc);
-- 조직 관리자·플랫폼 운영자 조회. 기록(INSERT)은 service_role/SECURITY DEFINER 만.
create policy "audit read" on public.audit_logs
  for select to authenticated
  using (public.is_org_admin(org_id) or public.is_platform_admin());

-- ── 기본 요금제 시드 (플랫폼 카탈로그) ──
insert into public.plans (code, name, price_monthly, max_members, max_exams_monthly, features, sort_order) values
  ('free', 'Free',       0,       10,   3,  '["문제은행","기본 리포트"]'::jsonb, 1),
  ('pro',  'Pro',        290000,  100,  50, '["AI 문항 생성","감독·녹화","6축 역량 리포트","이메일 지원"]'::jsonb, 2),
  ('ent',  'Enterprise', 0,       null, null, '["무제한 인원","전용 지원","SSO/보안심사 대응","맞춤 역량체계"]'::jsonb, 3)
on conflict (code) do nothing;
