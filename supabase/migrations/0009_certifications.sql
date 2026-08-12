-- 0009_certifications.sql
-- 인증서(수료·합격 증명)
--
-- exams 하위. exam_id 를 타고 org_id 를 상속(inherit_org_from_exam).
--
-- 등급 처리 — 여기가 원본과 갈리는 지점이다.
--   원본 types.ts 는 certifications.grade 를 exam_grade enum(green/blue/black)
--   으로 두었다. 그 enum 은 0001 에서 의도적으로 제거했다(등급은 이제 조직별
--   grade_scales/grade_levels 데이터다).
--
--   인증서는 "발급 시점의 사실"을 담는 문서다. 조직이 나중에 등급 체계를 고쳐도
--   이미 발급된 증서의 등급 표기는 바뀌면 안 된다. 그래서 grade_level_id 로
--   참조를 걸되, 표시용 라벨·코드를 **발급 시점에 동결**해 함께 저장한다.
--   grade_levels 행이 사라져도(on delete set null) 증서의 라벨은 남는다.

create table public.certifications (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.exam_sessions(id) on delete cascade,
  exam_id        uuid not null references public.exams(id) on delete cascade,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  applicant_id   uuid references auth.users(id) on delete set null,

  -- 증서 번호. 조직 범위에서 유일. 앱/발급 함수가 생성한다.
  cert_number    text not null,

  -- 등급: 참조 + 동결 표기(위 주석)
  grade_level_id uuid references public.grade_levels(id) on delete set null,
  grade_label    text,                        -- 발급 시점 라벨 동결 (예: '우수')
  grade_code     text,                        -- 발급 시점 코드 동결 (예: 'l4')

  status         public.cert_status not null default 'valid',
  issued_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  -- 세션당 증서 1장. 재발급은 상태 전이(revoked→재발급)로 다룬다.
  unique (session_id),
  -- 증서 번호는 조직 안에서 유일
  unique (org_id, cert_number)
);

comment on table public.certifications is
  '인증서. 등급은 발급 시점 라벨을 동결 저장 — 등급 체계가 나중에 바뀌어도 증서는 불변';

create index certifications_org_idx       on public.certifications (org_id, issued_at desc);
create index certifications_applicant_idx on public.certifications (applicant_id);
create index certifications_exam_idx      on public.certifications (exam_id, status);

create trigger certifications_inherit_org
  before insert or update of exam_id on public.certifications
  for each row execute function public.inherit_org_from_exam();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.certifications enable row level security;

-- 읽기: 본인 증서 + 감독관/관리자 + 조회자(viewer) + 플랫폼 운영자.
--   응시자는 전체 목록이 아니라 자기 것만 본다.
create policy "cert read" on public.certifications
  for select to authenticated
  using (
    applicant_id = auth.uid()
    or public.is_org_examiner(org_id)
    or public.has_org_role(org_id, 'viewer')
    or public.is_platform_admin()
  );

-- 발급·취소: 스태프만. 자동 발급(채점 완료)은 service_role 로 돈다.
create policy "cert write by staff" on public.certifications
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

grant select, insert, update, delete on public.certifications to authenticated;
grant all on public.certifications to service_role;
