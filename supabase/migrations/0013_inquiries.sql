-- 0013_inquiries.sql
-- 도입 문의(리드) 저장소. 랜딩 커스텀 폼 → Edge Function(submit-inquiry) 이 여기 먼저 저장하고
-- Notion DB 로 미러링한다. Notion 이 잠깐 실패해도 리드가 유실되지 않게 하는 소스 오브 트루스.
--
-- org_id: 리드 단계엔 조직이 없으므로 대개 null. (CI 가드 §6.4 — 신규 테이블 org_id 컬럼 요건 충족)

create table public.inquiries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.organizations(id) on delete set null,
  company       text not null,
  contact_name  text,
  email         text,
  phone         text,
  headcount     text,
  timeframe     text,
  inquiry_type  text,          -- 채용 / 재직자 진단 / 기타
  source        text,          -- 유입경로
  message       text,
  status        text not null default '신규',
  notion_page_id text,         -- Notion 미러링 결과(page id)
  created_at    timestamptz not null default now()
);

alter table public.inquiries enable row level security;

-- 조회는 플랫폼 관리자만. INSERT 는 Edge Function(service_role)이 RLS 우회로 수행하므로 별도 정책 없음.
create policy "inquiries_platform_read" on public.inquiries
  for select to authenticated
  using (is_platform_admin());

comment on table public.inquiries is '도입 문의 리드. 랜딩 폼 → submit-inquiry Edge Function 이 기록, Notion 미러링. 조회는 플랫폼 관리자만.';
