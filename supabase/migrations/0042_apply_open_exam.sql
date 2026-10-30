-- 0042_apply_open_exam.sql
--
-- 공개(자율 신청) 회차에 조직 구성원이 스스로 응시 신청하는 경로를 복구한다.
--
-- 증상: ApplicantMyPage 의 "응시 신청"(handleApply)은 exam_sessions 를 클라이언트에서
-- 직접 INSERT 한다. exam_sessions 에는 응시자용 INSERT 정책이 없어서(0011) 공개
-- 회차 — 시험 생성 화면의 기본값 — 에 아무도 신청할 수 없다.
--
-- 정책을 열지 않는 이유는 0038 과 같다. 열면 남의 조직 회차에도 세션을 꽂을 수 있다.
-- 대신 이 함수가 확인한다:
--   - 호출자가 그 회차 조직의 활성 구성원이다(조직 밖 사람은 초대코드 경로로만)
--   - 회차가 접수중(open)이고 응시 방식이 공개 또는 혼합이다
--   - 진행 중인 세션이 있으면 그걸 돌려준다(새로고침·재진입). 1인 1활성 세션.
--   - 이미 응시를 마쳤으면 재응시는 관리자 재응시 발급(초대코드)으로만

create or replace function public.apply_open_exam(_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid     uuid := auth.uid();
  _exam    public.exams;
  _session public.exam_sessions;
begin
  if _uid is null then
    raise exception '인증이 필요합니다' using errcode = 'insufficient_privilege';
  end if;

  select * into _exam from public.exams where id = _exam_id;
  if _exam.id is null then
    raise exception '회차를 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.org_members m
     where m.org_id = _exam.org_id and m.user_id = _uid and m.status = 'active'
  ) then
    raise exception '이 조직의 구성원만 신청할 수 있습니다. 받은 응시코드가 있다면 응시코드로 들어와 주세요.'
      using errcode = 'insufficient_privilege';
  end if;

  if _exam.status <> 'open' then
    raise exception '이 회차는 현재 응시할 수 없습니다' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(_exam.registration_mode, 'open') not in ('open', 'hybrid') then
    raise exception '이 시험은 응시코드가 필요합니다' using errcode = 'invalid_parameter_value';
  end if;

  select * into _session
  from public.exam_sessions
  where exam_id = _exam_id and applicant_id = _uid and status in ('waiting', 'in_progress')
  order by created_at desc
  limit 1;
  if _session.id is not null then
    return _session.id;
  end if;

  if exists (select 1 from public.exam_sessions where exam_id = _exam_id and applicant_id = _uid) then
    raise exception '이미 응시한 시험입니다. 재응시는 담당자에게 요청해 주세요.'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.exam_sessions (exam_id, applicant_id)
  values (_exam_id, _uid)
  returning * into _session;   -- org_id 는 exam_sessions_inherit_org 가 채운다

  return _session.id;
end $$;

comment on function public.apply_open_exam(uuid) is
  '공개·혼합 회차에 조직 구성원이 스스로 응시 신청한다. 진행 중 세션이 있으면 재사용한다.';

revoke all on function public.apply_open_exam(uuid) from public, anon;
grant execute on function public.apply_open_exam(uuid) to authenticated;
