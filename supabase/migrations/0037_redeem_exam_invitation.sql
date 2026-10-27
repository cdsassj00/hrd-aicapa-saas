-- 0037_redeem_exam_invitation.sql
--
-- 응시자가 초대코드로 응시를 신청하는 경로를 복구한다.
--
-- 증상: 메일로 받은 유효한 코드를 넣어도 "유효하지 않은 응시코드입니다" 가 뜬다.
-- E2E 로 확인했다 — 초대장이 DB 에 있고 이메일도 정확히 일치하는데 응시자의
-- 조회가 0건으로 돌아온다.
--
-- 원인: ApplicantMyPage 는 세 가지를 클라이언트에서 직접 한다.
--   (1) exam_invitations SELECT   (2) exam_sessions INSERT   (3) exam_invitations UPDATE
-- 그런데 exam_invitations 의 정책은 운영진 전용이고(is_org_examiner / is_platform_admin),
-- exam_sessions 에는 응시자용 INSERT 정책이 아예 없다. 셋 다 막힌다.
--
-- 고치는 방향: 정책을 느슨하게 풀지 않는다. 코드로 초대장을 읽을 수 있게 열면
-- 코드 대입으로 응시자 이름·이메일이 새고, 세션 INSERT 를 열면 남의 회차에
-- 세션을 꽂을 수 있다. 대신 세 동작을 SECURITY DEFINER 함수 하나로 묶고
-- 그 안에서 **로그인 계정의 이메일이 초대받은 이메일과 같은지** 확인한다.
-- 코드를 맞혀도 그 사람 계정으로 로그인할 수 없으면 들어오지 못한다 —
-- 짧은 코드(현장 입력용)를 유지하면서 실질 방어선을 세우는 자리다.
--
-- get_invitation_by_code(0025) 와 같은 방식이다. 그 함수는 로그인 전
-- 게스트 OTP 경로가 쓰고, 이 함수는 로그인한 응시자가 쓴다.

create or replace function public.redeem_exam_invitation(_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid       uuid := auth.uid();
  _email     text;
  _inv       public.exam_invitations;
  _exam      public.exams;
  _session   public.exam_sessions;
  _test_mode boolean;
begin
  if _uid is null then
    raise exception '인증이 필요합니다' using errcode = 'insufficient_privilege';
  end if;

  select lower(btrim(u.email)) into _email from auth.users u where u.id = _uid;

  -- 코드 정규화는 get_invitation_by_code 와 반드시 같아야 한다
  select * into _inv
  from public.exam_invitations
  where invite_code = upper(btrim(_code))
  limit 1;

  if _inv.id is null then
    raise exception '유효하지 않은 응시코드입니다' using errcode = 'no_data_found';
  end if;

  -- 실질 방어선. 코드가 유출돼도 초대받은 계정이 아니면 들어오지 못한다.
  if _email is null or lower(btrim(_inv.email)) <> _email then
    raise exception '이 응시코드는 다른 분에게 발급된 코드입니다'
      using errcode = 'insufficient_privilege';
  end if;

  select * into _exam from public.exams where id = _inv.exam_id;
  if _exam.id is null then
    raise exception '회차를 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;
  if _exam.status <> 'open' then
    raise exception '이 회차는 현재 응시할 수 없습니다' using errcode = 'invalid_parameter_value';
  end if;

  _test_mode := coalesce(_exam.is_test_mode, false);

  -- 이미 진행 중인 세션이 있으면 그걸 돌려준다. 재사용이 먼저다 —
  -- 창을 닫았다 다시 들어온 응시자가 새 세션을 받으면 답안을 잃는다.
  select * into _session
  from public.exam_sessions
  where exam_id = _inv.exam_id
    and applicant_id = _uid
    and status in ('waiting', 'in_progress')
  order by created_at desc
  limit 1;

  if _session.id is null then
    -- 1인 1회 응시(exam_sessions_one_per_applicant). 이미 제출한 회차면
    -- DB 제약 오류 원문 대신 사람이 읽을 수 있는 안내를 준다.
    if exists (
      select 1 from public.exam_sessions
       where exam_id = _inv.exam_id and applicant_id = _uid
    ) then
      raise exception '이미 응시를 마친 회차입니다' using errcode = 'invalid_parameter_value';
    end if;

    -- 진행 중인 게 없을 때만 is_used 를 막는다. 테스트 모드는 예외.
    if coalesce(_inv.is_used, false) and not _test_mode then
      raise exception '이미 사용된 응시코드입니다' using errcode = 'invalid_parameter_value';
    end if;

    insert into public.exam_sessions (exam_id, applicant_id)
    values (_inv.exam_id, _uid)
    returning * into _session;   -- org_id 는 exam_sessions_inherit_org 가 채운다
  end if;

  -- 초대받은 응시자를 그 조직의 applicant 로 등록한다.
  --
  -- RLS 가 전부 조직 멤버십 위에 서 있다(설계문서 §6). 멤버십이 없으면 자기
  -- 세션은 읽히지만 회차(exams)를 못 읽어 대기실이 빈 화면이 된다 — E2E 로
  -- 확인했다. 문항·답안도 같은 벽에 걸린다.
  --
  -- 조직 관리자가 초대코드를 발급한 행위가 곧 "이 사람을 내 조직 응시자로
  -- 받는다"는 승인이므로 운영자 승인을 따로 끼우지 않는다. 고객사 직원
  -- 수백 명을 플랫폼 운영자가 일일이 승인하는 구조는 쓸 수 없다.
  -- 권한은 applicant 하나뿐이고, 그 역할로는 자기 세션만 보인다.
  insert into public.org_members (org_id, user_id, role, status, display_name)
  values (_exam.org_id, _uid, 'applicant', 'active', nullif(btrim(coalesce(_inv.name, '')), ''))
  on conflict (org_id, user_id, role) do update
    set status = 'active'
  where public.org_members.status <> 'active';

  if not _test_mode then
    update public.exam_invitations
       set is_used = true, session_id = _session.id, accepted_at = coalesce(accepted_at, now())
     where id = _inv.id;
  end if;

  return _session.id;
end $$;

comment on function public.redeem_exam_invitation(text) is
  '응시자가 초대코드로 응시 세션을 확보한다. 로그인 계정의 이메일이 초대 이메일과 '
  '일치할 때만 통과한다. 진행 중인 세션이 있으면 재사용한다.';

-- 로그인한 응시자만 쓴다. 비로그인 경로는 get_invitation_by_code + 게스트 OTP 다.
revoke all on function public.redeem_exam_invitation(text) from public, anon;
grant execute on function public.redeem_exam_invitation(text) to authenticated;
