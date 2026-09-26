-- 0025_restore_missing_rpcs.sql
-- squash 재설계(0001~) 때 이식되지 않은 RPC·테이블 복원.
--
-- 프론트엔드/엣지 함수는 원본 스키마 기준으로 남아 있어 아래를 호출하는데
-- 새 DB 에는 없었다. 그 결과 "실제 시험을 치르는" 경로가 통째로 끊겨 있었다:
--   get_exam_questions_for_session  응시 화면이 문제를 못 불러옴
--   get_server_time                 시험 타이머 서버 동기화 실패
--   get_invitation_by_code          초대코드 게스트 진입 불가
--   get_user_emails                 관리자 화면에서 응시자 이메일 미표시
--   sms_otp_codes                   OTP 인증 4개 함수 전부 동작 불가
--
-- 복원 원칙: 화면(구 스키마 형태)을 고치는 대신, RPC 를 어댑터로 두어
-- 새 스키마(points/answer_key/question_set_items)를 구 Question 형태로 투영한다.
-- 권한은 전부 새 테넌시 모델(user_org_ids / is_org_admin)로 다시 세운다.

-- ===========================================================================
-- 1. sms_otp_codes — OTP 임시 코드
-- ===========================================================================
-- session_id 는 다형(응시 세션 id 또는 초대 id)이라 FK 를 걸지 않는다.
-- phone 컬럼은 이메일 OTP 에도 재사용된다(원본 동작 유지).
-- 인증 전 단계라 org 를 알 수 없어 테넌시 가드 예외 목록에 등록돼 있다.
create table if not exists public.sms_otp_codes (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid        not null,
  phone      text        not null,
  code       text        not null,
  expires_at timestamptz not null,
  verified   boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists sms_otp_codes_lookup_idx
  on public.sms_otp_codes (session_id, phone, verified, created_at desc);

-- 정책을 두지 않는다 — service_role(엣지 함수)만 접근한다.
alter table public.sms_otp_codes enable row level security;

comment on table public.sms_otp_codes is
  'OTP 임시 코드. 인증 전 단계라 org 가 없다(가드 예외). service_role 전용 — 정책 없음.';

-- ===========================================================================
-- 2. get_server_time — 시험 타이머 서버 동기화
-- ===========================================================================
create or replace function public.get_server_time()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select now() $$;

comment on function public.get_server_time() is '서버 현재 시각. 응시 타이머가 클라이언트 시계 조작을 피하려고 사용.';

revoke all on function public.get_server_time() from public, anon;
grant execute on function public.get_server_time() to authenticated, service_role;

-- ===========================================================================
-- 3. get_user_emails — 관리자 화면의 응시자 이메일 표시
-- ===========================================================================
-- 원본은 전역으로 열려 있었다. 여기서는 "내가 관리자인 조직의 멤버"로만 좁힌다.
-- auth.users 를 직접 읽으므로 SECURITY DEFINER 가 필요하다.
create or replace function public.get_user_emails()
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct u.id, u.email::text
  from auth.users u
  where exists (
    select 1
    from public.org_members m
    where m.user_id = u.id
      and (
        public.is_platform_admin()
        or public.is_org_admin(m.org_id)
      )
  )
$$;

comment on function public.get_user_emails() is
  '내가 관리자인 조직의 멤버 이메일만 반환(플랫폼 운영자는 전체). 원본의 전역 노출을 조직 스코프로 좁힘.';

revoke all on function public.get_user_emails() from public, anon;
grant execute on function public.get_user_emails() to authenticated, service_role;

-- ===========================================================================
-- 4. get_exam_questions_for_session — 응시 화면 문제 로딩
-- ===========================================================================
-- 새 스키마(points / answer_key / question_set_items)를 화면이 기대하는
-- 구 Question 형태로 투영한다. correct_answer 는 절대 내보내지 않는다
-- (원본은 클라이언트에서 지웠는데, 그러면 네트워크 탭에 정답이 그대로 보인다).
create or replace function public.get_exam_questions_for_session(_session_id uuid)
returns table (
  id                uuid,
  exam_id           uuid,
  set_id            uuid,
  content           text,
  type              public.question_type,
  difficulty        public.question_difficulty,
  max_score         integer,
  order_num         integer,
  category          text,
  grade             text,
  tags              jsonb,
  options           jsonb,
  correct_answer    text,
  allow_file_upload boolean,
  attachments       jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _sess public.exam_sessions;
begin
  select * into _sess from public.exam_sessions s where s.id = _session_id;
  if not found then
    raise exception '세션을 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;

  -- 본인 응시 세션이거나, 그 조직의 스태프여야 한다.
  if not (
    _sess.applicant_id = auth.uid()
    or public.is_platform_admin()
    or _sess.org_id = any (public.user_org_ids())
  ) then
    raise exception '이 세션의 문제를 볼 권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    q.id,
    _sess.exam_id,
    (select i.set_id
       from public.question_set_items i
      where i.question_id = q.id
      order by i.created_at
      limit 1)                                              as set_id,
    q.content,
    q.type,
    q.difficulty,
    coalesce(eq.points_override, q.points)                  as max_score,
    eq.sort_order                                           as order_num,
    q.answer_key ->> 'category'                             as category,
    q.answer_key ->> 'grade'                                as grade,
    coalesce(q.answer_key -> 'tags',    '[]'::jsonb)        as tags,
    coalesce(q.answer_key -> 'options', '[]'::jsonb)        as options,
    null::text                                              as correct_answer,
    coalesce((q.answer_key ->> 'allow_file_upload')::boolean, q.type = 'file_upload') as allow_file_upload,
    coalesce(q.attachments, '[]'::jsonb)                    as attachments
  from public.exam_questions eq
  join public.questions q on q.id = eq.question_id
  where eq.exam_id = _sess.exam_id
  order by eq.sort_order;
end $$;

comment on function public.get_exam_questions_for_session(uuid) is
  '응시 세션의 문제 목록을 구 Question 형태로 투영. 정답(correct_answer)은 항상 NULL 로 내보낸다.';

revoke all on function public.get_exam_questions_for_session(uuid) from public, anon;
grant execute on function public.get_exam_questions_for_session(uuid) to authenticated, service_role;

-- ===========================================================================
-- 5. get_invitation_by_code — 초대코드로 게스트 진입 (미인증 호출)
-- ===========================================================================
-- 로그인 화면에서 anon 이 호출한다. exam_invitations 에는 평문 코드가 없고
-- code_hash 만 있으므로 입력 코드를 같은 방식으로 해싱해 대조한다.
--   code_hash = encode(sha256(convert_to(upper(btrim(code)), 'UTF8')), 'hex')
-- pgcrypto 의 digest() 는 extensions 스키마에 있어 search_path 를 잠그면 안 잡힌다.
-- 내장 sha256() 은 pg_catalog 에 있고 확장 의존도 없어 이식성 방어선에도 맞는다(§8).
-- 반환은 게스트 진입에 필요한 최소 정보뿐이다(코드 존재 여부 + 표시용 이름/시험명).
create or replace function public.get_invitation_by_code(p_code text)
returns table (
  id                uuid,
  invite_code       text,
  email             text,
  name              text,
  exam_id           uuid,
  exam_title        text,
  is_used           boolean,
  is_test_mode      boolean,
  has_active_session boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    inv.id,
    upper(btrim(p_code))                as invite_code,
    inv.email,
    inv.name,
    inv.exam_id,
    e.title                             as exam_title,
    (inv.accepted_at is not null)       as is_used,
    (e.status = 'draft')                as is_test_mode,
    exists (
      select 1 from public.exam_sessions s
      where s.id = inv.session_id
        and s.status in ('waiting', 'in_progress')
    )                                   as has_active_session
  from public.exam_invitations inv
  join public.exams e on e.id = inv.exam_id
  where inv.code_hash = encode(sha256(convert_to(upper(btrim(p_code)), 'UTF8')), 'hex')
  limit 1
$$;

comment on function public.get_invitation_by_code(text) is
  '초대코드(평문)를 해싱해 초대를 조회. 미인증 응시자의 게스트 진입 경로라 anon 실행을 연다 — 코드를 아는 사람만 자기 초대 1건을 본다.';

revoke all on function public.get_invitation_by_code(text) from public;
grant execute on function public.get_invitation_by_code(text) to anon, authenticated, service_role;
