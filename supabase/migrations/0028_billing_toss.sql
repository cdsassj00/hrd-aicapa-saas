-- 0028_billing_toss.sql
-- 토스페이먼츠 빌링(카드 정기결제) 연동용 테이블.
-- 0019 의 subscriptions 위에 "카드(빌링키)"와 "결제 이력"을 얹는다.
-- 쓰기는 전부 Edge Function(service_role) — 결제 결과는 서버가 토스 API 응답으로만 기록한다.

-- ── billing_methods : 조직별 등록 카드(빌링키) ──
-- billing_key 는 카드 결제 권한 그 자체라 클라이언트에 절대 노출하지 않는다.
-- → authenticated 대상 정책을 하나도 만들지 않는다(RLS on + 정책 없음 = 전면 차단).
--   카드 표시(마스킹 번호)는 billing_payments 와 Edge Function 응답으로만 내려간다.
create table public.billing_methods (
  org_id         uuid primary key references public.organizations(id) on delete cascade,
  customer_key   text not null unique,     -- 토스 customerKey (조직당 1개, 추측 불가한 UUID)
  billing_key    text not null,
  card_company   text,
  card_number    text,                      -- 토스가 내려주는 마스킹 번호 (예: 4330****1234)
  registered_by  uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.billing_methods enable row level security;
create trigger billing_methods_set_updated_at before update on public.billing_methods
  for each row execute function public.set_updated_at();

-- ── billing_payments : 결제 이력(append-only 성격) ──
create table public.billing_payments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  order_id        text not null unique,     -- 우리가 생성한 주문번호(멱등 키)
  order_name      text not null,
  amount          integer not null,         -- 부가세 포함 결제 금액(KRW)
  status          text not null,            -- DONE / FAILED / CANCELED
  payment_key     text,
  card_company    text,
  card_number     text,
  period_start    timestamptz,
  period_end      timestamptz,
  failure_code    text,
  failure_message text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.billing_payments enable row level security;
create index billing_payments_org_idx on public.billing_payments (org_id, created_at desc);
-- 조직 관리자는 자기 조직 결제 이력을 본다. 기록은 service_role 만.
create policy "billing payments read" on public.billing_payments
  for select to authenticated
  using (public.is_org_admin(org_id) or public.is_platform_admin());

-- Pro 요금제 판매 단위를 랜딩·환불정책과 맞춘다(응시 10명 포함, 1개월 자동갱신).
update public.plans
   set features = '["응시 10명 포함","AI 문항 생성","감독·녹화","6축 역량 리포트","이메일 지원"]'::jsonb
 where code = 'pro';
