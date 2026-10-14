-- 0030_exam_questions_tool_req.sql
-- 응시 화면이 문항별 작업 환경(tool_req)을 알아야 한다.
--
-- 0022 가 문항 메타를 answer_key.meta 에 표준화했다(sector·job_roles·tool_req·level).
-- 그런데 응시 경로는 answer_key 를 보지 않는다 — 정답·루브릭이 함께 올라오기 때문에
-- 일부러 차단해 둔 것이다. 그래서 응시 화면은 "이 문항이 샌드박스를 요구하는지"를
-- 알 수가 없어 시험 에이전트를 띄울 조건을 판단할 수 없었다.
--
-- meta 는 비밀이 아니다(채점 기준이 아니라 출제 분류다). 응시용 투영에 두 컬럼을
-- 더해 내려 준다. answer_key 전체를 열지 않고 meta 만 꺼내는 것이 핵심이다.
--
-- OUT 컬럼이 늘어나므로 create or replace 로는 바꿀 수 없다 — drop 후 재생성한다.

drop function if exists public.get_exam_questions_for_session(uuid);

create function public.get_exam_questions_for_session(_session_id uuid)
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
  attachments       jsonb,
  tool_req          text,
  meta              jsonb
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
    eq.sort_order                                           as order_num,
    q.answer_key ->> 'category'                             as category,
    q.answer_key ->> 'grade'                                as grade,
    coalesce(q.answer_key -> 'tags',    '[]'::jsonb)        as tags,
    coalesce(q.answer_key -> 'options', '[]'::jsonb)        as options,
    null::text                                              as correct_answer,
    coalesce((q.answer_key ->> 'allow_file_upload')::boolean, q.type = 'file_upload') as allow_file_upload,
    coalesce(q.attachments, '[]'::jsonb)                    as attachments,
    -- 작업 환경. 값이 없으면 대화창만 쓰는 문항으로 본다(샌드박스를 띄우지 않는다).
    coalesce(q.answer_key -> 'meta' ->> 'tool_req', 'chat') as tool_req,
    -- 분류 메타만. 정답(options.is_correct)·루브릭(slots.rubric)은 포함되지 않는다.
    coalesce(q.answer_key -> 'meta',    '{}'::jsonb)        as meta
  from public.exam_questions eq
  join public.questions q on q.id = eq.question_id
  where eq.exam_id = _sess.exam_id
  order by eq.sort_order;
end $$;

comment on function public.get_exam_questions_for_session(uuid) is
  '응시 세션의 문제 목록을 구 Question 형태로 투영. 정답(correct_answer)은 항상 NULL 로 내보내고, '
  'answer_key 중 분류 메타(meta)와 작업 환경(tool_req)만 추가로 내려 준다.';

revoke all on function public.get_exam_questions_for_session(uuid) from public, anon;
grant execute on function public.get_exam_questions_for_session(uuid) to authenticated, service_role;
