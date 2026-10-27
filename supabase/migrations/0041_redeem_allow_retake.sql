-- 0041_redeem_allow_retake.sql
--
-- redeem_exam_invitation(0038) 이 재응시를 막던 것을 푼다.
--
-- 0038 은 이 회차에 세션이 하나라도 있으면 "이미 응시를 마친 회차입니다" 로
-- 거부했다. 당시 운영 DB 에 회차당 1인 1세션 인덱스가 있었기 때문이다.
-- 그런데 0037_align_exam_schema_to_app 이 그 인덱스를 "동시에 진행 중인 세션은
-- 하나" 로 좁혔다 — 원본 화면의 재응시(관리자 "재응시 발급" → 같은 사람에게
-- 새 응시코드)를 살리기 위해서다. 운영에도 이미 반영돼 있다.
--
-- 재응시는 새 코드로 들어오므로 막을 필요가 있는 건 "쓴 코드의 재사용" 뿐이고,
-- 그건 아래 is_used 검사가 이미 한다. 진행 중 세션 재사용도 그대로다.

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
