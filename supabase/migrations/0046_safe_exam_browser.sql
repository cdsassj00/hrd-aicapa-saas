-- 0046 Safe Exam Browser(SEB) 필수 응시
--
-- exams.seb_required = true 인 시험은 SEB 안에서만 문항을 받을 수 있다.
-- SEB 는 페이지에 SHA256(현재 URL + Config Key) 를 주고(JS API: SafeExamBrowser.security.configKey),
-- 클라이언트가 그 값과 URL 을 문항 RPC 에 넘기면 서버가 허용된 Config Key 로 재계산해 비교한다.
-- Config Key 는 앱이 만든 .seb 설정에서 계산되어 저장되며, 관리자가 직접 만든 설정의 키를 추가할 수도 있다.
-- 운영진(감독·관리자)은 검사하지 않는다(미리보기·채점 화면에서 같은 RPC 를 쓴다).
--
-- 함께 고친 것: 이 RPC 가 객관식 보기(answer_key.options)를 그대로 내보내 보기마다 붙은
-- is_correct(정답 표시)가 응시자 브라우저로 전달되고 있었다. 이제 정답 표시를 제거하고 보낸다.

alter table public.exams
  add column if not exists seb_required boolean not null default false,
  add column if not exists seb_config_keys text[] not null default '{}';

alter table public.exams drop constraint if exists exams_seb_config_keys_hex;
alter table public.exams add constraint exams_seb_config_keys_hex
  check (array_to_string(seb_config_keys, ',') ~ '^([0-9a-f]{64}(,[0-9a-f]{64})*)?$');

-- 해시 검증. URL 은 해당 세션 페이지여야 한다(다른 페이지에서 얻은 값 재사용 방지).
create or replace function public.seb_hash_valid(_keys text[], _session_id uuid, _url text, _hash text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(_url, '') <> ''
     and coalesce(_hash, '') <> ''
     and position(_session_id::text in _url) > 0
     and exists (
       select 1 from unnest(_keys) k
       where encode(sha256(convert_to(split_part(_url, '#', 1) || k, 'UTF8')), 'hex') = lower(_hash)
     );
$$;
revoke all on function public.seb_hash_valid(text[], uuid, text, text) from public, anon;
grant execute on function public.seb_hash_valid(text[], uuid, text, text) to authenticated;

-- 문항 RPC: 선택 인자 2개 추가. 기존 1인자 호출은 그대로 동작한다.
drop function if exists public.get_exam_questions_for_session(uuid);
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
