-- 0038_log_user_actions.sql
--
-- 응시자 행동 로그(src/lib/userActions.ts)의 저장 경로를 audit_logs 로 옮긴다.
--
-- 증상: 응시 중 POST /rest/v1/user_actions 가 매번 404. 원본의 user_actions
-- 테이블은 squash 때 audit_logs 로 승격하기로 했고(설계문서 §4) 새 스키마에는
-- 없다. 로깅 실패는 조용히 버려지므로 시험은 진행되지만, 기록은 하나도 안 남는다.
--
-- audit_logs 는 INSERT 정책이 없다(append-only, SECURITY DEFINER 만 기록).
-- 그 원칙을 지키며 이 함수가 대신 쓴다:
--   - 본인 세션(applicant_id = auth.uid())에 묶인 행동만 받는다
--   - org_id 는 클라이언트가 아니라 세션에서 가져온다
--   - 세션 없는 행동(login 등)은 조직을 정할 수 없으니 버린다
--   - 한 번에 50건까지(클라이언트 배치 상한과 같다)

create or replace function public.log_user_actions(_actions jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
  _n   integer;
begin
  if _uid is null then
    raise exception '인증이 필요합니다' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(_actions) <> 'array' or jsonb_array_length(_actions) > 50 then
    raise exception '잘못된 요청입니다' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, metadata, created_at)
  select s.org_id,
         _uid,
         'applicant.' || left(a ->> 'action_type', 40),
         'exam_session',
         s.id::text,
         coalesce(a -> 'metadata', '{}'::jsonb),
         now()
  from jsonb_array_elements(_actions) a
  join public.exam_sessions s
    on s.id = nullif(a ->> 'session_id', '')::uuid
   and s.applicant_id = _uid
  where coalesce(a ->> 'action_type', '') <> '';

  get diagnostics _n = row_count;
  return _n;
end $$;

comment on function public.log_user_actions(jsonb) is
  '응시자 행동 로그를 audit_logs 에 기록. 본인 세션에 묶인 행동만 받고 org_id 는 세션에서 정한다.';

revoke all on function public.log_user_actions(jsonb) from public, anon;
grant execute on function public.log_user_actions(jsonb) to authenticated;
