-- 0008_proctoring_recording.sql
-- 감독(proctoring) · 녹화(recording) 도메인
--
-- exam_sessions 하위다. 세 테이블 모두 session_id 를 타고 org_id 를 상속받는다
-- (0007 의 answers 와 동일한 비정규화 + 트리거 패턴). RLS 는 행마다 평가되므로
-- session → exam 2홉을 매번 타지 않도록 org_id 를 세션에서 트리거로 덮어쓴다.
--
-- 접근 모델:
--   · 응시자(세션 소유자)는 자기 세션에 대해 이벤트/청크/진단을 INSERT 만 한다.
--     감독 기록을 되읽지 못한다 — 감독은 스태프 전용이다.
--   · 감독관·관리자·플랫폼 운영자는 조직 범위로 읽고 검수(is_reviewed)한다.
--
-- event_type 은 enum 이 아니라 text 다. 원본 0001 의 monitoring_event_type enum
-- (4종)은 프런트가 실제로 보내는 값(window_blur·copy·fullscreen_exit·
-- voice_detected 등)을 못 담아 INSERT 가 깨진다. 허용 목록은 이미
-- exams.alert_event_types(text[]) 가 관리하므로 여기서 enum 으로 다시 조일
-- 이유가 없다. recording 파이프라인 stage 도 같은 이유로 text.

-- ===========================================================================
-- 1. 감독 이벤트
-- ===========================================================================
create table public.monitoring_events (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.exam_sessions(id) on delete cascade,
  org_id         uuid not null references public.organizations(id) on delete cascade,

  -- 이벤트 어휘는 src/lib/alertEventTypes.ts 가 진실 공급원. enum 아님(위 주석).
  event_type     text not null,
  -- 이벤트가 발생한 문항 인덱스(선택). 어떤 문항에서 이탈했는지 추적용.
  question_index int,
  -- 스냅샷 이미지(R2 object key 또는 URL). 얼굴 이탈·복수 인원 증거.
  screenshot_url text,

  is_reviewed    boolean not null default false,
  reviewer_note  text,

  detected_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

comment on table public.monitoring_events is
  '감독 이벤트(부정행위 의심 신호). 응시자가 자기 세션에 INSERT, 스태프가 검수';

create index monitoring_events_session_idx on public.monitoring_events (session_id, detected_at);
create index monitoring_events_org_idx     on public.monitoring_events (org_id, detected_at desc);
create index monitoring_events_unreviewed  on public.monitoring_events (org_id) where not is_reviewed;

create trigger monitoring_events_inherit_org
  before insert or update of session_id on public.monitoring_events
  for each row execute function public.inherit_org_from_session();

-- ===========================================================================
-- 2. 녹화 청크
-- ===========================================================================
-- 응시 화면·웹캠 녹화를 조각(chunk)으로 올린다. 실제 미디어는 R2 에 있고
-- 여기에는 object_key 와 메타데이터만 둔다. applicant_id·exam_id 는 세션에서
-- 온 값이지만 조회 편의를 위해 비정규화한다(org_id 처럼 트리거로 강제하지는
-- 않고 앱이 세션 컨텍스트로 채운다 — 잘못 채워도 org 경계는 org_id 가 지킨다).
create table public.recording_chunks (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.exam_sessions(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  applicant_id uuid references auth.users(id) on delete set null,
  exam_id      uuid references public.exams(id) on delete cascade,

  kind         text not null,               -- 'screen' | 'camera' 등
  chunk_index  int  not null,
  object_key   text not null,               -- R2 객체 키
  mime_type    text,
  size_bytes   bigint,
  duration_ms  int,
  is_header    boolean default false,        -- 초기화 세그먼트(fMP4 header) 여부

  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),

  unique (session_id, kind, chunk_index),
  constraint recording_chunks_size_non_negative check (size_bytes is null or size_bytes >= 0)
);

comment on table public.recording_chunks is
  '녹화 조각. 미디어 본체는 R2, 여기엔 object_key·메타만. 재생 시 chunk_index 순서로 이어붙임';

create index recording_chunks_session_idx on public.recording_chunks (session_id, kind, chunk_index);
create index recording_chunks_org_idx     on public.recording_chunks (org_id, created_at desc);

create trigger recording_chunks_inherit_org
  before insert or update of session_id on public.recording_chunks
  for each row execute function public.inherit_org_from_session();

-- ===========================================================================
-- 3. 녹화 진단
-- ===========================================================================
-- 업로드·디코드 파이프라인의 단계별 상태. 녹화가 안 될 때 원인 추적용.
create table public.recording_diagnostics (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.exam_sessions(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  applicant_id uuid references auth.users(id) on delete set null,

  kind         text,                          -- 'screen' | 'camera' 등(선택)
  stage        text not null,                 -- 'download'|'decode'|'mse'|'video'|'response' (text, 위 주석)
  status       public.recording_diag_status not null default 'info',
  message      text,
  meta         jsonb,

  at           timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.recording_diagnostics is
  '녹화 파이프라인 단계별 진단 로그. 재생 실패 원인 분석용';

create index recording_diagnostics_session_idx on public.recording_diagnostics (session_id, at);
create index recording_diagnostics_org_idx     on public.recording_diagnostics (org_id, at desc);

create trigger recording_diagnostics_inherit_org
  before insert or update of session_id on public.recording_diagnostics
  for each row execute function public.inherit_org_from_session();

-- ===========================================================================
-- 4. RLS
-- ===========================================================================
alter table public.monitoring_events    enable row level security;
alter table public.recording_chunks     enable row level security;
alter table public.recording_diagnostics enable row level security;

-- 응시자: 자기 세션에만 INSERT. 되읽기 불가(감독은 스태프 전용).
-- org_id 는 트리거가 세션에서 채우므로 WITH CHECK 는 session_id 소유권만 본다
-- (0007 answers "write self" 와 동일 패턴).
create policy "monitoring insert self" on public.monitoring_events
  for insert to authenticated
  with check (exists (select 1 from public.exam_sessions s
                      where s.id = session_id and s.user_id = auth.uid()));

create policy "monitoring staff" on public.monitoring_events
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

create policy "recording chunk insert self" on public.recording_chunks
  for insert to authenticated
  with check (exists (select 1 from public.exam_sessions s
                      where s.id = session_id and s.user_id = auth.uid()));

create policy "recording chunk staff" on public.recording_chunks
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

create policy "recording diag insert self" on public.recording_diagnostics
  for insert to authenticated
  with check (exists (select 1 from public.exam_sessions s
                      where s.id = session_id and s.user_id = auth.uid()));

create policy "recording diag staff" on public.recording_diagnostics
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

grant select, insert, update, delete on
  public.monitoring_events, public.recording_chunks, public.recording_diagnostics
  to authenticated;
grant all on
  public.monitoring_events, public.recording_chunks, public.recording_diagnostics
  to service_role;
