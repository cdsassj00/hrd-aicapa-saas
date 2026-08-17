-- 0015_storage_question_attachments_org.sql
-- P0-4: question-attachments 버킷 쓰기를 org 스코프로 조인다.
--
-- 0012 의 정책은 아무 authenticated 사용자나 이 버킷에 insert/update/delete 할 수 있었다
-- → 한 테넌트가 다른 테넌트의 문제세트 첨부를 덮어쓰거나 삭제할 수 있는 교차테넌트 구멍.
-- 오브젝트 경로 첫 폴더를 org_id 로 두고(클라이언트 uploadAttachments 가 그렇게 올린다),
-- 그 org 의 관리자(is_org_admin)만 쓰도록 제한한다.
--
-- 읽기는 시험 중 응시자·게스트가 첨부를 받아야 하므로 public read 를 유지한다.
-- 경로가 무작위 UUID 라 URL 추측이 어렵고, 민감정보(신분증·답안)는 이 버킷에 넣지 않는다
-- (그 용도는 별도 비공개 버킷 — 시험 도메인 이식 단계에서 org 스코프로 생성).

drop policy if exists "qattach_auth_insert" on storage.objects;
drop policy if exists "qattach_auth_update" on storage.objects;
drop policy if exists "qattach_auth_delete" on storage.objects;

-- 경로: {org_id}/sets/{ts}/{i}_{rand}.{ext}
--   (storage.foldername(name))[1] = org_id
create policy "qattach_org_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'question-attachments'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

create policy "qattach_org_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'question-attachments'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'question-attachments'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

create policy "qattach_org_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'question-attachments'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );
