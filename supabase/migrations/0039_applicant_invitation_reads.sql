-- 0039_applicant_invitation_reads.sql
--
-- 응시자 화면이 운영진 전용 테이블을 직접 읽던 두 곳을 좁은 함수로 바꾼다.
-- (0037 과 같은 이유: 원본은 조직 개념 없는 RLS 라 직접 조회가 통했다)
--
-- 1) 개인별 감독 면제(allow_no_webcam / allow_no_screen_share)
--    WaitingRoom·ExamPage 가 exam_invitations 를 직접 읽는데 정책이 운영진
--    전용이라 0건 → 관리자가 면제해 준 응시자도 캠·화면공유를 강제당했다.
-- 2) 정원(max_participants) 확인용 인원 수
--    exam_sessions 는 응시자에게 본인 행만 보여서 count 가 늘 0~1 → 정원이
--    사실상 동작하지 않았다.

-- 본인 이메일로 발급된 이 회차 초대장 1건(최신).
create or replace function public.get_my_exam_invitation(_exam_id uuid)
returns setof public.exam_invitations
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.*
  from public.exam_invitations i
  where i.exam_id = _exam_id
    and lower(btrim(i.email)) = (select lower(btrim(u.email)) from auth.users u where u.id = auth.uid())
  order by i.created_at desc
  limit 1
$$;

comment on function public.get_my_exam_invitation(uuid) is
  '로그인한 응시자 본인 이메일로 발급된 이 회차 초대장(최신 1건). 개인별 감독 면제 확인용.';

-- 이 회차의 응시 중·제출 인원 수. 이 회차에 세션이 있는 응시자나 운영진만.
create or replace function public.count_exam_participants(_exam_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _org uuid;
begin
  select org_id into _org from public.exams where id = _exam_id;
  if _org is null then
    return 0;
  end if;
  if not (
    public.is_platform_admin()
    or public.is_org_examiner(_org)
    or exists (select 1 from public.exam_sessions s where s.exam_id = _exam_id and s.applicant_id = auth.uid())
  ) then
    raise exception '권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;
  return (select count(*)::int from public.exam_sessions s
           where s.exam_id = _exam_id and s.status in ('in_progress', 'submitted'));
end $$;

comment on function public.count_exam_participants(uuid) is
  '회차의 응시 중·제출 인원 수. 대기실 정원 확인용.';

revoke all on function public.get_my_exam_invitation(uuid) from public, anon;
revoke all on function public.count_exam_participants(uuid) from public, anon;
grant execute on function public.get_my_exam_invitation(uuid) to authenticated;
grant execute on function public.count_exam_participants(uuid) to authenticated;
