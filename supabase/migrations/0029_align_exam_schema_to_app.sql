-- 0029_align_exam_schema_to_app.sql
-- 시험 도메인 DB 를 화면(응시·감독·초대·채점)에 맞춘다.
--
-- 배경: 0001~ squash 재설계 때 시험 테이블을 새로 그리면서, 원본이 운영하며 쌓은
-- 기능 컬럼(테스트모드·대기실 생략·지각 입장·2단계 시험·감독 예외·플래그 …)이 빠졌다.
-- 화면과 엣지 함수는 원본 기능 그대로 남아 있어 시험 생성→응시→채점 경로가
-- 한 번도 돌지 못했다(운영 DB 시험·세션·답안 0건).
--
-- 원칙: 시험 "기능"은 화면이 기준이다 — 화면이 쓰는 이름·컬럼을 DB 에 들인다.
-- 단, 재설계에서 의도적으로 바꾼 것은 유지한다.
--   · org_id + RLS (조직 경계) — 화면은 org_id 를 몰라도 된다. 하위 테이블은 트리거가 상속.
--   · 문항(questions)·문항세트는 조직 문제은행 구조 유지 — 응시 화면은 RPC 투영으로 읽는다(0025).
--   · 등급 체계(grade_scales)·인증서 동결 라벨 유지 — 화면의 grade 는 표시용 텍스트로 병행.
-- 데이터가 0건이라 이름 변경·타입 변경에 이관 비용이 없다.

-- ===========================================================================
-- 1. exams — 회차 운영 옵션
-- ===========================================================================
alter table public.exams
  add column grade                text,                                   -- 표시용 등급(예: green/blue/black). 등급 체계는 grade_scale_id
  add column pass_score           int     not null default 75,
  add column is_test_mode         boolean not null default false,          -- 관리자 테스트 회차(재응시 허용·통계 제외)
  add column skip_waiting_checks  boolean not null default false,
  add column skip_face_match      boolean not null default false,
  add column allow_dual_monitor   boolean not null default false,
  add column alert_event_types    text[]  not null default '{}',           -- 빈 배열 = 감독 알림 OFF
  add column use_absolute_end     boolean not null default false,          -- 종료 시각을 exam_date+duration 으로 고정
  add column entry_start_minutes  int     not null default 30,             -- 시작 몇 분 전부터 입장
  add column block_late_entry     boolean not null default false,
  add column late_entry_minutes   int     not null default 10,
  add column phased_enabled       boolean not null default false,          -- 2단계(1부/2부) 시험
  add column phase1_minutes       int     not null default 30,
  add column custom_texts         jsonb   not null default '{}'::jsonb,    -- 대기실·서약·제출 화면 문구
  add column daily_room_name      text,
  add column daily_room_url       text;

alter table public.exams
  add constraint exams_pass_score_range check (pass_score between 0 and 100),
  add constraint exams_minutes_non_negative
    check (entry_start_minutes >= 0 and late_entry_minutes >= 0 and phase1_minutes >= 0);

-- ===========================================================================
-- 2. exam_sessions — 화면 이름으로 + 감독 컬럼
-- ===========================================================================
alter table public.exam_sessions rename column started_at   to start_time;
alter table public.exam_sessions rename column submitted_at to submit_time;
alter table public.exam_sessions rename column score        to score_total;

alter table public.exam_sessions
  add column is_flagged          boolean not null default false,
  add column monitoring_notes    text,
  add column phase1_completed_at timestamptz,
  add column submit_reason       text;   -- manual / timeout / violation 등

-- 채점 무결성 가드(0014)를 새 이름으로 다시 만든다. plpgsql 본문은 컬럼 rename 을 따라가지 않는다.
-- 합격/불합격 판정(status passed·failed)도 채점 결과이므로 같은 가드에 넣는다 —
-- 응시자는 자기 세션을 submitted 까지만 옮길 수 있다.
create or replace function public.guard_exam_session_scoring()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.score_total    is distinct from old.score_total
     or new.max_score      is distinct from old.max_score
     or new.grade_level_id is distinct from old.grade_level_id
     or (new.status is distinct from old.status and new.status in ('passed', 'failed'))
  then
    if current_user not in ('service_role', 'supabase_admin', 'postgres')
       and not (public.is_org_examiner(old.org_id) or public.is_platform_admin())
    then
      raise exception '점수·등급·합격 판정은 채점자만 수정할 수 있습니다.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 3. exam_invitations — 응시코드 평문 + 사용 여부 + 감독 예외
-- ===========================================================================
-- 화면은 관리자가 응시코드를 보고·복사하고·재발급하는 흐름이다(명단 일괄 배포).
-- 그래서 invite_code 를 다시 둔다. 조회는 RLS(조직 관리자)로 막히고,
-- 게스트 진입은 기존처럼 get_invitation_by_code RPC 로만 한다.
-- code_hash / accepted_at 은 트리거로 동기화해 기존 함수(0025·0026)가 그대로 돈다.
alter table public.exam_invitations
  add column invite_code           text,
  add column is_used               boolean not null default false,
  add column allow_no_webcam       boolean not null default false,
  add column allow_no_screen_share boolean not null default false,
  add column allow_dual_monitor    boolean not null default false,
  add column exemption_reason      text;

create or replace function public.sync_exam_invitation_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.invite_code is null or btrim(new.invite_code) = '' then
    new.invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  new.invite_code := upper(btrim(new.invite_code));
  new.code_hash   := encode(sha256(convert_to(new.invite_code, 'UTF8')), 'hex');

  -- is_used ↔ accepted_at
  if tg_op = 'INSERT' then
    if new.accepted_at is not null then new.is_used := true; end if;
    if new.is_used and new.accepted_at is null then new.accepted_at := now(); end if;
  else
    if new.accepted_at is distinct from old.accepted_at then
      new.is_used := new.accepted_at is not null;
    elsif new.is_used is distinct from old.is_used then
      new.accepted_at := case when new.is_used then now() else null end;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.sync_exam_invitation_code() from public, anon, authenticated;

create trigger exam_invitations_sync_code
  before insert or update on public.exam_invitations
  for each row execute function public.sync_exam_invitation_code();

alter table public.exam_invitations
  alter column invite_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  alter column invite_code set not null;   -- 기본값·트리거가 채운다(기존 0건)
create unique index exam_invitations_invite_code_uidx on public.exam_invitations (invite_code);

-- 초대코드 조회 RPC: 저장된 코드·is_used·is_test_mode 를 그대로 내보낸다.
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
    inv.invite_code,
    inv.email,
    inv.name,
    inv.exam_id,
    e.title          as exam_title,
    inv.is_used,
    e.is_test_mode,
    exists (
      select 1 from public.exam_sessions s
      where s.id = inv.session_id
        and s.status in ('waiting', 'in_progress')
    )                as has_active_session
  from public.exam_invitations inv
  join public.exams e on e.id = inv.exam_id
  where inv.invite_code = upper(btrim(p_code))
  limit 1
$$;

-- ===========================================================================
-- 4. 출제 순서 — exam_questions
-- ===========================================================================
alter table public.exam_questions rename column sort_order to order_num;
alter table public.exam_questions
  add column id uuid not null default gen_random_uuid();
create unique index exam_questions_id_uidx on public.exam_questions (id);

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
    eq.order_num,
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
  order by eq.order_num;
end $$;

-- ===========================================================================
-- 5. 답안 — 화면은 텍스트 답안 + 슬롯 값 + 파일 URL 을 쓴다
-- ===========================================================================
alter table public.answers
  alter column content drop default,
  alter column content type text using nullif(content #>> '{}', ''),
  alter column content set default '',
  alter column content drop not null;
alter table public.answers
  add column slot_values  jsonb,
  add column file_url     text,
  add column submitted_at timestamptz;

-- ===========================================================================
-- 6. 채점 잡 — 세션 단위 (ai-grade 가 세션별로 큐잉)
-- ===========================================================================
alter table public.grading_jobs
  add column session_id    uuid references public.exam_sessions(id) on delete cascade,
  add column result_status text,
  add column result_total  numeric(6,2),
  add column error_message text,
  alter column exam_id drop not null;

alter table public.grading_jobs drop constraint grading_jobs_status_valid;
alter table public.grading_jobs add constraint grading_jobs_status_valid
  check (status in ('pending', 'processing', 'completed', 'failed', 'queued', 'running', 'done', 'cancelled'));
alter table public.grading_jobs add constraint grading_jobs_target_present
  check (exam_id is not null or session_id is not null);
create index grading_jobs_session_idx on public.grading_jobs (session_id);

-- 세션만 주어지면 회차를 세션에서 찾아 채운다(org 상속은 기존 트리거가 이어서 한다).
create or replace function public.fill_grading_job_exam()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.exam_id is null and new.session_id is not null then
    select exam_id into new.exam_id from public.exam_sessions where id = new.session_id;
  end if;
  return new;
end $$;

revoke all on function public.fill_grading_job_exam() from public, anon, authenticated;

-- 트리거는 이름순으로 돈다: a_ 접두어로 inherit_org 보다 먼저.
create trigger a_grading_jobs_fill_exam
  before insert or update of session_id, exam_id on public.grading_jobs
  for each row execute function public.fill_grading_job_exam();

-- ===========================================================================
-- 7. 공지·채팅 — message / sender_id
-- ===========================================================================
alter table public.exam_chat_messages rename column body to message;
alter table public.exam_announcements rename column body to message;
alter table public.exam_announcements rename column created_by to sender_id;

-- ===========================================================================
-- 8. 인증서 — 표시용 grade (동결 라벨 grade_label/grade_code 와 병행)
-- ===========================================================================
alter table public.certifications add column grade text;

-- ===========================================================================
-- 9. 프로필 — 응시자 소속 정보
-- ===========================================================================
alter table public.profiles
  add column organization text,
  add column department   text,
  add column position     text;

-- ===========================================================================
-- 10. 재응시 — 화면은 같은 사람에게 새 초대·새 세션을 만든다
-- ===========================================================================
-- 0007 은 회차당 1인 1세션 / 1이메일 1초대로 막았다. 화면의 재응시(관리자 "재응시 초대",
-- 응시자 마이페이지의 제출 후 재응시)가 이 제약에 걸려 실패한다.
-- 원래 막으려던 것은 "동시에 두 개"이므로 진행 중인 것만 유일하게 좁힌다.
drop index public.exam_sessions_one_per_applicant;
create unique index exam_sessions_one_active_per_applicant
  on public.exam_sessions (exam_id, applicant_id)
  where applicant_id is not null and status in ('waiting', 'in_progress');

drop index public.exam_invitations_exam_email_uniq;
create unique index exam_invitations_exam_email_open_uniq
  on public.exam_invitations (exam_id, email)
  where not is_used;

-- 이메일은 소문자로 저장(0007 형식 제약). 화면은 입력 그대로 보내므로 트리거가 정규화한다.
create or replace function public.normalize_exam_invitation_email()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end $$;

revoke all on function public.normalize_exam_invitation_email() from public, anon, authenticated;

create trigger exam_invitations_normalize_email
  before insert or update of email on public.exam_invitations
  for each row execute function public.normalize_exam_invitation_email();
