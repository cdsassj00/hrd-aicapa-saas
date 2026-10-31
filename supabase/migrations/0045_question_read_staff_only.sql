-- 0045 문항 원본(questions) 읽기를 운영진으로 제한
--
-- 문제: 0006 의 "question read" 정책은 visibility='platform' 문항을 로그인한 누구나 읽게 했고,
--       'org' 문항도 같은 조직의 응시자(applicant)까지 읽을 수 있었다. questions.answer_key 에는
--       정답·허용 답안·심어 둔 오류·채점 기준이 들어 있어, 응시자가 REST 로 정답을 그대로 받을 수 있었다.
-- 수정: 원본 문항은 운영진(org_owner·org_admin·examiner·viewer)만 읽는다.
--       응시 화면은 정답을 뺀 get_exam_questions_for_session RPC(security definer)로만 문항을 받는다.

create or replace function public.staff_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(org_id), '{}')
  from public.org_members
  where user_id = auth.uid()
    and status = 'active'
    and role in ('org_owner', 'org_admin', 'examiner', 'viewer')
$$;
revoke all on function public.staff_org_ids() from public, anon;
grant execute on function public.staff_org_ids() to authenticated;

create or replace function public.can_read_licensed_question(_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.question_set_items i
    join public.question_licenses l on l.set_id = i.set_id
    where i.question_id = _question_id
      and l.org_id = any (public.staff_org_ids())
      and (l.expires_at is null or l.expires_at > now())
  )
$$;
revoke all on function public.can_read_licensed_question(uuid) from public, anon;
grant execute on function public.can_read_licensed_question(uuid) to authenticated;

drop policy if exists "question read" on public.questions;
create policy "question read" on public.questions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (visibility = 'org' and org_id = any (public.staff_org_ids()))
    or (visibility = 'platform' and cardinality(public.staff_org_ids()) > 0)
    or (visibility = 'licensed' and public.can_read_licensed_question(id))
  );

-- questions_public 뷰는 security_invoker 라 위 정책을 그대로 따른다. anon 쓰기 권한은 의미가 없으니 회수.
revoke insert, update, delete, truncate, references, trigger on public.questions_public from anon, authenticated;
revoke all on public.questions_public from anon;
