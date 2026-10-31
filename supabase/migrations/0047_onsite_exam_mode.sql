-- 0047 현장(오프라인) 시험 모드
--
-- 시험장에 모여 응시하는 회차. 원격 감독(웹캠·화면공유·녹화)과 온라인 본인확인(신분증·얼굴 대조·
-- 이메일 인증)을 하지 않고, 감독관이 현장에서 신분증을 확인한 뒤 6자리 입실 코드를 알려준다.
-- 응시자는 대기실에서 그 코드를 입력하고, 서버는 코드를 확인받은 응시자에게만 문항을 준다.
--
-- 보안 설계
--   - 코드는 exams 가 아니라 운영진 전용 테이블(exam_onsite_codes)에 둔다. exams 는 응시자도 읽는다.
--   - 확인 기록(exam_onsite_checkins)은 응시자가 직접 쓸 수 없다. exam_sessions 는 응시자가
--     자기 행을 수정할 수 있어서 거기에 두면 스스로 '확인됨'으로 바꿀 수 있다.
--   - 원격에서 코드를 무작위로 넣어 보는 것을 막기 위해 세션당 10회 틀리면 잠근다(감독관이 해제).
--   - 원격 감독을 하지 않으므로 개인정보(얼굴·신분증·녹화)를 아예 수집하지 않는다.

alter table public.exams
  add column if not exists onsite_mode boolean not null default false;

create table if not exists public.exam_onsite_codes (
  exam_id    uuid primary key references public.exams(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  code       text not null check (code ~ '^[0-9]{6}$'),
  rotated_at timestamptz not null default now(),
  rotated_by uuid
);
alter table public.exam_onsite_codes enable row level security;
revoke all on public.exam_onsite_codes from anon, authenticated;
grant select on public.exam_onsite_codes to authenticated;
drop policy if exists "onsite code read by staff" on public.exam_onsite_codes;
create policy "onsite code read by staff" on public.exam_onsite_codes
  for select to authenticated
  using (public.is_org_examiner(org_id) or public.is_platform_admin());

create table if not exists public.exam_onsite_checkins (
  session_id  uuid primary key references public.exam_sessions(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  exam_id     uuid not null references public.exams(id) on delete cascade,
  attempts    integer not null default 0,
  verified_at timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.exam_onsite_checkins enable row level security;
revoke all on public.exam_onsite_checkins from anon, authenticated;
grant select on public.exam_onsite_checkins to authenticated;
drop policy if exists "onsite checkin read" on public.exam_onsite_checkins;
create policy "onsite checkin read" on public.exam_onsite_checkins
  for select to authenticated
  using (
    public.is_org_examiner(org_id) or public.is_platform_admin()
    or exists (select 1 from public.exam_sessions s where s.id = session_id and s.applicant_id = auth.uid())
  );

-- 코드 발급·재발급 (운영진). 새 코드를 돌려준다.
create or replace function public.rotate_onsite_code(_exam_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  _org uuid;
  _code text;
begin
  select org_id into _org from public.exams where id = _exam_id;
  if _org is null then
    raise exception '시험을 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;
  if not (public.is_org_examiner(_org) or public.is_platform_admin()) then
    raise exception '권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;
  _code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.exam_onsite_codes (exam_id, org_id, code, rotated_at, rotated_by)
  values (_exam_id, _org, _code, now(), auth.uid())
  on conflict (exam_id) do update
    set code = excluded.code, rotated_at = excluded.rotated_at, rotated_by = excluded.rotated_by;
  return _code;
end $$;
revoke all on function public.rotate_onsite_code(uuid) from public, anon;
grant execute on function public.rotate_onsite_code(uuid) to authenticated;

-- 응시자 입실 코드 확인. 'ok' | 'wrong' | 'locked' | 'no_code'
create or replace function public.verify_onsite_code(_session_id uuid, _code text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  _sess public.exam_sessions;
  _row public.exam_onsite_checkins;
  _expected text;
begin
  select * into _sess from public.exam_sessions where id = _session_id;
  if not found or _sess.applicant_id <> auth.uid() then
    raise exception '이 세션의 응시자가 아닙니다' using errcode = 'insufficient_privilege';
  end if;

  insert into public.exam_onsite_checkins (session_id, org_id, exam_id)
  values (_session_id, _sess.org_id, _sess.exam_id)
  on conflict (session_id) do nothing;
  select * into _row from public.exam_onsite_checkins where session_id = _session_id for update;

  if _row.verified_at is not null then return 'ok'; end if;
  if _row.attempts >= 10 then return 'locked'; end if;

  select code into _expected from public.exam_onsite_codes where exam_id = _sess.exam_id;
  if _expected is null then return 'no_code'; end if;

  if btrim(coalesce(_code, '')) = _expected then
    update public.exam_onsite_checkins set verified_at = now(), updated_at = now() where session_id = _session_id;
    return 'ok';
  end if;
  update public.exam_onsite_checkins set attempts = attempts + 1, updated_at = now() where session_id = _session_id;
  return case when _row.attempts + 1 >= 10 then 'locked' else 'wrong' end;
end $$;
revoke all on function public.verify_onsite_code(uuid, text) from public, anon;
grant execute on function public.verify_onsite_code(uuid, text) to authenticated;

-- 감독관: 잠긴 응시자 해제 또는 코드 없이 직접 입실 확인
create or replace function public.staff_onsite_checkin(_session_id uuid, _verify boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  _sess public.exam_sessions;
begin
  select * into _sess from public.exam_sessions where id = _session_id;
  if not found then raise exception '세션을 찾을 수 없습니다' using errcode = 'no_data_found'; end if;
  if not (public.is_org_examiner(_sess.org_id) or public.is_platform_admin()) then
    raise exception '권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;
  insert into public.exam_onsite_checkins (session_id, org_id, exam_id, attempts, verified_at)
  values (_session_id, _sess.org_id, _sess.exam_id, 0, case when _verify then now() end)
  on conflict (session_id) do update
    set attempts = 0, verified_at = case when _verify then now() else null end, updated_at = now();
end $$;
revoke all on function public.staff_onsite_checkin(uuid, boolean) from public, anon;
grant execute on function public.staff_onsite_checkin(uuid, boolean) to authenticated;

-- 문항 RPC: SEB 검사 다음에 현장 입실 확인 검사를 추가 (나머지는 0046 과 동일)
create or replace function public.get_exam_questions_for_session(
  _session_id uuid, _seb_url text default null, _seb_hash text default null)
returns table (
  id uuid, exam_id uuid, set_id uuid, content text, type public.question_type,
  difficulty public.question_difficulty, max_score integer, order_num integer,
  category text, grade text, tags jsonb, options jsonb, correct_answer text,
  allow_file_upload boolean, attachments jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  _sess public.exam_sessions;
  _exam public.exams;
begin
  select * into _sess from public.exam_sessions s where s.id = _session_id;
  if not found then
    raise exception '세션을 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;
  if not (_sess.applicant_id = auth.uid() or public.is_platform_admin()
          or _sess.org_id = any (public.user_org_ids())) then
    raise exception '이 세션의 문제를 볼 권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;

  select * into _exam from public.exams e where e.id = _sess.exam_id;
  if _exam.seb_required
     and _sess.applicant_id = auth.uid()
     and not public.is_org_examiner(_sess.org_id)
     and not public.is_platform_admin()
     and not public.seb_hash_valid(_exam.seb_config_keys, _session_id, _seb_url, _seb_hash) then
    raise exception 'SEB_REQUIRED: 이 시험은 Safe Exam Browser 에서만 응시할 수 있습니다'
      using errcode = 'insufficient_privilege';
  end if;

  -- 현장 시험: 감독관이 알려준 입실 코드를 확인받은 응시자만 문항을 받는다(0047).
  if _exam.onsite_mode
     and _sess.applicant_id = auth.uid()
     and not public.is_org_examiner(_sess.org_id)
     and not public.is_platform_admin()
     and not exists (select 1 from public.exam_onsite_checkins c
                     where c.session_id = _session_id and c.verified_at is not null) then
    raise exception 'ONSITE_REQUIRED: 현장 입실 코드 확인이 필요합니다'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select q.id, _sess.exam_id,
    (select i.set_id from public.question_set_items i
      where i.question_id = q.id order by i.created_at limit 1) as set_id,
    q.content, q.type, q.difficulty,
    coalesce(eq.points_override, q.points) as max_score,
    eq.order_num as order_num,
    q.answer_key ->> 'category' as category,
    q.answer_key ->> 'grade' as grade,
    coalesce(q.answer_key -> 'tags', '[]'::jsonb) as tags,
    -- 보기의 정답 표시(is_correct)는 응시자에게 보내지 않는다 (0046 이전에는 그대로 나갔다)
    case when jsonb_typeof(q.answer_key -> 'options') = 'array' then
      (select coalesce(jsonb_agg(case when jsonb_typeof(o) = 'object'
                                      then o - 'is_correct' - 'correct' - 'isCorrect' else o end
                                 order by ord), '[]'::jsonb)
         from jsonb_array_elements(q.answer_key -> 'options') with ordinality t(o, ord))
    else '[]'::jsonb end as options,
    null::text as correct_answer,
    coalesce((q.answer_key ->> 'allow_file_upload')::boolean, q.type = 'file_upload') as allow_file_upload,
    coalesce(q.attachments, '[]'::jsonb) as attachments
  from public.exam_questions eq
  join public.questions q on q.id = eq.question_id
  where eq.exam_id = _sess.exam_id
  order by eq.order_num;
end $function$;

revoke all on function public.get_exam_questions_for_session(uuid, text, text) from public, anon;
grant execute on function public.get_exam_questions_for_session(uuid, text, text) to authenticated;
