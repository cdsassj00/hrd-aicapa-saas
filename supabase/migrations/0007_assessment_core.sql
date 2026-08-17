-- 0007_assessment_core.sql
-- 시험 도메인 (설계문서 §4)
--
-- 테넌시 루트는 exams 다. 나머지는 exam_id 또는 session_id 를 타고 내려간다.
-- 그런데 RLS 는 **모든 행마다** 평가되므로, answers 에서 org 를 알기 위해
-- answers → exam_sessions → exams 2홉을 매번 타면 대량 조회에서 그대로 비용이
-- 된다. org_id 를 비정규화해 두고 트리거로 정합성을 강제한다(§4).
--
-- 비정규화의 위험은 "어긋난 행"이다. org_id 가 부모와 다르면 그 행은 RLS 상
-- 다른 조직 소유가 된다 — 조용한 유출이다. 그래서 앱이 org_id 를 쓰게 두지
-- 않고 트리거가 항상 덮어쓴다.

-- ===========================================================================
-- 1. 시험(진단 회차)
-- ===========================================================================
create table public.exams (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  title             text not null,
  description       text,

  -- 0005 에서 만든 조직별 체계를 참조. NULL 이면 플랫폼 기본을 쓴다는 뜻.
  framework_id      uuid references public.competency_frameworks(id) on delete set null,
  grade_scale_id    uuid references public.grade_scales(id) on delete set null,

  status            public.exam_status not null default 'draft',
  registration_mode public.registration_mode not null default 'invite_only',

  exam_date         timestamptz,
  duration_minutes  int not null default 90,
  max_participants  int,
  instructions      text,

  -- 감독 수준을 회차별로 정한다. 자가진단은 끄고 인증 회차만 켠다 —
  -- 전 회차에 감독을 강제하면 현황 파악용 진단조차 부담스러워진다.
  proctoring        boolean not null default false,
  require_identity  boolean not null default false,

  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint exams_title_not_blank check (length(btrim(title)) > 0),
  constraint exams_duration_positive check (duration_minutes > 0),
  constraint exams_max_participants_positive
    check (max_participants is null or max_participants > 0),
  -- 신원 확인은 감독의 일부다. 감독을 끈 채 신원 확인만 켜면 응시자는
  -- 신분증을 올리는데 아무도 보지 않는 상태가 된다.
  constraint exams_identity_requires_proctoring
    check (not require_identity or proctoring)
);

comment on table public.exams is '진단 회차. 테넌시 루트 — 하위 테이블은 여기서 org_id 를 상속';

create index exams_org_status_idx on public.exams (org_id, status, exam_date desc);

create trigger exams_set_updated_at
  before update on public.exams
  for each row execute function public.set_updated_at();

-- 회차가 참조하는 역량·등급 체계는 그 조직이 볼 수 있는 것이어야 한다
-- (자기 조직 것 또는 플랫폼 기본).
create or replace function public.check_exam_refs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _o uuid;
begin
  if new.framework_id is not null then
    select org_id into _o from public.competency_frameworks where id = new.framework_id;
    if _o is not null and _o <> new.org_id then
      raise exception '다른 조직의 역량 체계는 쓸 수 없습니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.grade_scale_id is not null then
    select org_id into _o from public.grade_scales where id = new.grade_scale_id;
    if _o is not null and _o <> new.org_id then
      raise exception '다른 조직의 등급 체계는 쓸 수 없습니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.check_exam_refs() from public, anon, authenticated;

create trigger exams_check_refs
  before insert or update of framework_id, grade_scale_id, org_id on public.exams
  for each row execute function public.check_exam_refs();

-- ===========================================================================
-- 2. org_id 상속 — 공용 트리거 두 개
-- ===========================================================================
create or replace function public.inherit_org_from_exam()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _org uuid;
begin
  select org_id into _org from public.exams where id = new.exam_id;
  if _org is null then
    raise exception 'org_id 상속 실패: 존재하지 않는 회차 %', new.exam_id
      using errcode = 'foreign_key_violation';
  end if;
  new.org_id := _org;
  return new;
end $$;

create or replace function public.inherit_org_from_session()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _org uuid;
begin
  select org_id into _org from public.exam_sessions where id = new.session_id;
  if _org is null then
    raise exception 'org_id 상속 실패: 존재하지 않는 세션 %', new.session_id
      using errcode = 'foreign_key_violation';
  end if;
  new.org_id := _org;
  return new;
end $$;

revoke all on function public.inherit_org_from_exam()    from public, anon, authenticated;
revoke all on function public.inherit_org_from_session() from public, anon, authenticated;

-- ===========================================================================
-- 3. 출제 (회차 × 문항)
-- ===========================================================================
create table public.exam_questions (
  exam_id         uuid not null references public.exams(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete restrict,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  sort_order      int not null default 0,
  points_override int,
  created_at      timestamptz not null default now(),

  primary key (exam_id, question_id),
  constraint exam_questions_points_positive
    check (points_override is null or points_override > 0)
);

create index exam_questions_org_idx      on public.exam_questions (org_id);
create index exam_questions_question_idx on public.exam_questions (question_id);

-- 문항을 회차에 넣을 때 그 문항을 쓸 자격이 있는지 본다. RLS 는 SELECT 를
-- 걸러 줄 뿐, INSERT 로 남의 문항 id 를 직접 박는 것은 막지 않는다.
create or replace function public.check_exam_question()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _exam_org uuid; _q record;
begin
  select org_id into _exam_org from public.exams where id = new.exam_id;
  if _exam_org is null then
    raise exception 'org_id 상속 실패: 존재하지 않는 회차 %', new.exam_id
      using errcode = 'foreign_key_violation';
  end if;

  select org_id, visibility into _q from public.questions where id = new.question_id;
  if not found then
    raise exception '존재하지 않는 문항입니다' using errcode = 'foreign_key_violation';
  end if;

  if _q.visibility = 'org' and _q.org_id is distinct from _exam_org then
    raise exception '다른 조직의 문항은 출제할 수 없습니다' using errcode = 'insufficient_privilege';
  end if;

  if _q.visibility = 'licensed' and not exists (
    select 1 from public.question_set_items i
    join public.question_licenses l on l.set_id = i.set_id
    where i.question_id = new.question_id and l.org_id = _exam_org
      and (l.expires_at is null or l.expires_at > now())
  ) then
    raise exception '라이선스가 없는 문항입니다' using errcode = 'insufficient_privilege';
  end if;

  new.org_id := _exam_org;
  return new;
end $$;

revoke all on function public.check_exam_question() from public, anon, authenticated;

create trigger exam_questions_check
  before insert or update on public.exam_questions
  for each row execute function public.check_exam_question();

-- ===========================================================================
-- 4. 응시 세션
-- ===========================================================================
create table public.exam_sessions (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references public.exams(id) on delete cascade,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  -- 게스트 응시(초대 코드만으로 들어오는 경우)를 위해 NULL 허용
  user_id        uuid references auth.users(id) on delete set null,
  status         public.session_status not null default 'waiting',

  started_at     timestamptz,
  submitted_at   timestamptz,

  score          numeric(6,2),
  max_score      numeric(6,2),
  grade_level_id uuid references public.grade_levels(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint exam_sessions_score_range
    check (score is null or score >= 0),
  constraint exam_sessions_submitted_after_start
    check (submitted_at is null or started_at is null or submitted_at >= started_at)
);

comment on table public.exam_sessions is
  '응시 세션. answers·감독 기록이 여기서 org_id 를 상속받는다';

create index exam_sessions_exam_idx   on public.exam_sessions (exam_id, status);
create index exam_sessions_user_idx   on public.exam_sessions (user_id);
create index exam_sessions_org_idx    on public.exam_sessions (org_id, created_at desc);
create unique index exam_sessions_one_per_user
  on public.exam_sessions (exam_id, user_id) where user_id is not null;

create trigger exam_sessions_set_updated_at
  before update on public.exam_sessions
  for each row execute function public.set_updated_at();

create trigger exam_sessions_inherit_org
  before insert or update of exam_id on public.exam_sessions
  for each row execute function public.inherit_org_from_exam();

-- ===========================================================================
-- 5. 답안
-- ===========================================================================
create table public.answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.exam_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  org_id      uuid not null references public.organizations(id) on delete cascade,

  -- 타입별 응답. 객관식은 {"choice":"a"}, 수행형은 {"slots":{"s1":"..."}}
  content     jsonb not null default '{}'::jsonb,
  file_paths  jsonb not null default '[]'::jsonb,

  score       numeric(6,2),
  slot_scores jsonb,
  feedback    text,
  graded_at   timestamptz,
  graded_by   uuid references auth.users(id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (session_id, question_id),
  constraint answers_score_non_negative check (score is null or score >= 0)
);

create index answers_session_idx on public.answers (session_id);
create index answers_org_idx     on public.answers (org_id);

create trigger answers_set_updated_at
  before update on public.answers
  for each row execute function public.set_updated_at();

create trigger answers_inherit_org
  before insert or update of session_id on public.answers
  for each row execute function public.inherit_org_from_session();

-- ===========================================================================
-- 6. 채점 잡
-- ===========================================================================
create table public.grading_jobs (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid not null references public.exams(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  status       text not null default 'queued',
  progress     int not null default 0,
  total        int not null default 0,
  error        text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint grading_jobs_status_valid
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  constraint grading_jobs_progress_range check (progress between 0 and 100)
);

create index grading_jobs_org_idx  on public.grading_jobs (org_id, created_at desc);
create index grading_jobs_exam_idx on public.grading_jobs (exam_id);

create trigger grading_jobs_set_updated_at
  before update on public.grading_jobs
  for each row execute function public.set_updated_at();

create trigger grading_jobs_inherit_org
  before insert or update of exam_id on public.grading_jobs
  for each row execute function public.inherit_org_from_exam();

-- ===========================================================================
-- 7. 초대 · 공지
-- ===========================================================================
create table public.exam_invitations (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  name        text,
  session_id  uuid references public.exam_sessions(id) on delete set null,
  -- 조직 초대(0004)와 같은 원칙: 원문은 저장하지 않고 해시만 남긴다
  code_hash   text not null unique,
  sent_at     timestamptz,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint exam_invitations_email_format
    check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$')
);

create unique index exam_invitations_exam_email_uniq
  on public.exam_invitations (exam_id, email);
create index exam_invitations_org_idx on public.exam_invitations (org_id);

create trigger exam_invitations_inherit_org
  before insert or update of exam_id on public.exam_invitations
  for each row execute function public.inherit_org_from_exam();

create table public.exam_announcements (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references public.exams(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  body       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint exam_announcements_body_not_blank check (length(btrim(body)) > 0)
);

create index exam_announcements_exam_idx on public.exam_announcements (exam_id, created_at desc);
create index exam_announcements_org_idx  on public.exam_announcements (org_id);

create trigger exam_announcements_inherit_org
  before insert or update of exam_id on public.exam_announcements
  for each row execute function public.inherit_org_from_exam();

create table public.exam_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.exam_sessions(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  sender_id   uuid references auth.users(id) on delete set null,
  sender_role public.app_role,
  body        text not null,
  created_at  timestamptz not null default now(),

  constraint exam_chat_messages_body_not_blank check (length(btrim(body)) > 0)
);

create index exam_chat_messages_session_idx on public.exam_chat_messages (session_id, created_at);
create index exam_chat_messages_org_idx     on public.exam_chat_messages (org_id);

create trigger exam_chat_messages_inherit_org
  before insert or update of session_id on public.exam_chat_messages
  for each row execute function public.inherit_org_from_session();

-- ===========================================================================
-- 8. 권한 · RLS
-- ===========================================================================
alter table public.exams              enable row level security;
alter table public.exam_questions     enable row level security;
alter table public.exam_sessions      enable row level security;
alter table public.answers            enable row level security;
alter table public.grading_jobs       enable row level security;
alter table public.exam_invitations   enable row level security;
alter table public.exam_announcements enable row level security;
alter table public.exam_chat_messages enable row level security;

grant select, insert, update, delete on
  public.exams, public.exam_questions, public.exam_sessions, public.answers,
  public.grading_jobs, public.exam_invitations, public.exam_announcements,
  public.exam_chat_messages to authenticated;
grant all on
  public.exams, public.exam_questions, public.exam_sessions, public.answers,
  public.grading_jobs, public.exam_invitations, public.exam_announcements,
  public.exam_chat_messages to service_role;

-- 평가자·관리자 판정. examiner 는 감독·채점을 하므로 조직 데이터를 본다.
create or replace function public.is_org_examiner(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid() and org_id = _org_id
      and role in ('org_owner', 'org_admin', 'examiner') and status = 'active'
  )
$$;

revoke all on function public.is_org_examiner(uuid) from public, anon;
grant execute on function public.is_org_examiner(uuid) to authenticated, service_role;

-- exams: 조직 구성원은 읽고(응시자도 회차 정보는 봐야 한다), 관리자만 쓴다.
-- 단 draft 는 아직 공개된 회차가 아니므로 평가자 이상만 본다.
create policy "exam read" on public.exams
  for select to authenticated
  using (
    public.is_platform_admin()
    or (org_id = any (public.user_org_ids())
        and (status <> 'draft' or public.is_org_examiner(org_id)))
  );

create policy "exam write" on public.exams
  for all to authenticated
  using      (public.is_org_admin(org_id) or public.is_platform_admin())
  with check (public.is_org_admin(org_id) or public.is_platform_admin());

-- exam_questions: 출제 내용이다. 응시자에게 보이면 시험 전에 문제를 다 본다.
create policy "exam question examiner only" on public.exam_questions
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_admin(org_id)   or public.is_platform_admin());

-- exam_sessions: 본인 세션 + 평가자 이상
create policy "session read" on public.exam_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_examiner(org_id) or public.is_platform_admin());

create policy "session write by staff" on public.exam_sessions
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

-- 응시자가 자기 세션의 상태를 진행/제출로 바꾸는 경로.
-- 점수·등급은 못 건드린다 — 그건 채점 결과다.
create policy "session update self" on public.exam_sessions
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- answers: 본인 답안 + 평가자 이상
create policy "answer read" on public.answers
  for select to authenticated
  using (
    public.is_org_examiner(org_id) or public.is_platform_admin()
    or exists (select 1 from public.exam_sessions s
               where s.id = session_id and s.user_id = auth.uid())
  );

create policy "answer write self" on public.answers
  for all to authenticated
  using (exists (select 1 from public.exam_sessions s
                 where s.id = session_id and s.user_id = auth.uid()
                   and s.status = 'in_progress'))
  with check (exists (select 1 from public.exam_sessions s
                      where s.id = session_id and s.user_id = auth.uid()
                        and s.status = 'in_progress'));

create policy "answer grade by staff" on public.answers
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

create policy "grading job staff" on public.grading_jobs
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

create policy "exam invitation staff" on public.exam_invitations
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_admin(org_id)    or public.is_platform_admin());

-- 공지는 응시자도 봐야 한다
create policy "announcement read" on public.exam_announcements
  for select to authenticated
  using (org_id = any (public.user_org_ids()) or public.is_platform_admin());

create policy "announcement write" on public.exam_announcements
  for all to authenticated
  using      (public.is_org_examiner(org_id) or public.is_platform_admin())
  with check (public.is_org_examiner(org_id) or public.is_platform_admin());

-- 감독 채팅: 그 세션의 응시자와 평가자만
create policy "chat read" on public.exam_chat_messages
  for select to authenticated
  using (
    public.is_org_examiner(org_id) or public.is_platform_admin()
    or exists (select 1 from public.exam_sessions s
               where s.id = session_id and s.user_id = auth.uid())
  );

create policy "chat write" on public.exam_chat_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (public.is_org_examiner(org_id)
         or exists (select 1 from public.exam_sessions s
                    where s.id = session_id and s.user_id = auth.uid()))
  );
