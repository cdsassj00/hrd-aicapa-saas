-- 0017_storage_idcards_answerfiles.sql
-- 민감 파일 버킷 2종을 비공개로 생성하고 org 스코프 RLS 를 건다 (감사 P0-4 후속).
--   id-cards    : 신분증 이미지. 서비스 롤(upload-id-card)만 접근 — 정책 없음 = anon/authenticated 전면 차단.
--   answer-files: 작업형 답안 파일. 게스트(anon)도 업로드하므로 세션 상태로 검증한다.
--
-- 경로 규약(프론트 업로더가 지킨다): 두 버킷 모두 오브젝트 이름의 첫 폴더가 session_id 다.
--   answer-files: {session_id}/answers/...  ·  {session_id}/slots/...  ·  {session_id}/id-photos/...
-- 스토리지 정책에서 exam_sessions 를 직접 조회하면 그 테이블 RLS 를 다시 타서 anon 은
-- 아무 것도 못 본다 → SECURITY DEFINER 헬퍼로 우회한다.

-- ── SECURITY DEFINER 헬퍼 (스토리지 정책 전용) ──
-- 세션의 org 를 반환(정책의 스태프 판정용).
create or replace function public.storage_session_org(_session_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$ select org_id from public.exam_sessions where id = _session_id $$;
revoke all on function public.storage_session_org(uuid) from public, anon;
grant execute on function public.storage_session_org(uuid) to authenticated, service_role;

-- 세션이 쓰기 가능한 상태(in_progress)인지. 게스트(anon) 업로드 검증용이라 anon 에도 연다.
create or replace function public.storage_session_writable(_session_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists(
  select 1 from public.exam_sessions where id = _session_id and status = 'in_progress'
) $$;
revoke all on function public.storage_session_writable(uuid) from public;
grant execute on function public.storage_session_writable(uuid) to anon, authenticated, service_role;

-- 세션의 응시자 본인인지(self read 용).
create or replace function public.storage_is_session_applicant(_session_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists(
  select 1 from public.exam_sessions where id = _session_id and applicant_id = auth.uid()
) $$;
revoke all on function public.storage_is_session_applicant(uuid) from public, anon;
grant execute on function public.storage_is_session_applicant(uuid) to authenticated, service_role;

-- ── id-cards : 비공개, 정책 없음(서비스 롤 전용) ──
insert into storage.buckets (id, name, public) values ('id-cards', 'id-cards', false)
on conflict (id) do nothing;

-- ── answer-files : 비공개 + 세션 스코프 정책 ──
insert into storage.buckets (id, name, public) values ('answer-files', 'answer-files', false)
on conflict (id) do nothing;

-- 쓰기: 게스트 포함, in_progress 세션 폴더에만.
create policy "answerfiles_insert"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'answer-files'
    and public.storage_session_writable(((storage.foldername(name))[1])::uuid)
  );

create policy "answerfiles_update"
  on storage.objects for update to anon, authenticated
  using (
    bucket_id = 'answer-files'
    and public.storage_session_writable(((storage.foldername(name))[1])::uuid)
  );

-- 읽기: 그 세션 org 의 스태프, 플랫폼 운영자, 또는 응시자 본인.
create policy "answerfiles_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'answer-files'
    and (
      public.is_org_examiner(public.storage_session_org(((storage.foldername(name))[1])::uuid))
      or public.is_platform_admin()
      or public.storage_is_session_applicant(((storage.foldername(name))[1])::uuid)
    )
  );
