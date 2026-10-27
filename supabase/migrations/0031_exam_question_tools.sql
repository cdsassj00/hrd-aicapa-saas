-- 0031_exam_question_tools.sql
-- 응시 화면이 문항별 작업 환경(tool_req)을 알아야 한다.
--
-- 0022 가 문항 메타를 answer_key.meta 에 표준화했다(sector·job_roles·tool_req·level).
-- 그런데 응시 경로는 answer_key 를 보지 않는다 — 정답·루브릭이 함께 올라오기 때문에
-- 일부러 차단해 둔 것이다. 그래서 응시 화면은 "이 문항이 샌드박스를 요구하는지"를
-- 알 수가 없어 시험 에이전트를 띄울 조건을 판단할 수 없었다.
--
-- 처음에는 get_exam_questions_for_session 에 두 컬럼을 더하려 했다. OUT 컬럼이
-- 늘면 create or replace 가 안 되므로 drop 후 재생성해야 하는데, 그 함수는 응시
-- 경로의 유일한 문제 로딩 경로다 — 재생성이 실패하면 시험 자체가 멈춘다.
-- 멀쩡히 도는 함수를 건드릴 이유가 없으므로 메타만 주는 함수를 따로 둔다.
-- 권한 판정은 같은 규칙을 쓴다(본인 세션이거나 그 조직 구성원).
--
-- meta 는 비밀이 아니다 — 채점 기준이 아니라 출제 분류다. 정답(options.is_correct)과
-- 루브릭(slots.rubric)은 answer_key 의 다른 키이고 여기에 포함되지 않는다.

create or replace function public.get_exam_question_tools(_session_id uuid)
returns table (
  question_id uuid,
  tool_req    text,
  meta        jsonb
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
    -- 값이 없으면 대화창만 쓰는 문항으로 본다(샌드박스를 띄우지 않는다).
    coalesce(q.answer_key -> 'meta' ->> 'tool_req', 'chat'),
    coalesce(q.answer_key -> 'meta', '{}'::jsonb)
  from public.exam_questions eq
  join public.questions q on q.id = eq.question_id
  where eq.exam_id = _sess.exam_id;
end $$;

comment on function public.get_exam_question_tools(uuid) is
  '응시 세션 문항들의 작업 환경(tool_req)과 출제 분류 메타. answer_key 의 정답·루브릭은 내보내지 않는다.';

revoke all on function public.get_exam_question_tools(uuid) from public, anon;
grant execute on function public.get_exam_question_tools(uuid) to authenticated, service_role;
