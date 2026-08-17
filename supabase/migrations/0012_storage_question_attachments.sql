-- 0012_storage_question_attachments.sql
-- 문제세트 첨부 저장용 Supabase Storage 버킷.
--
-- 증상: 세트 업로드 시 "첨부 업로드 실패 (…zip): Bucket not found"
-- 원인: squash 마이그레이션이 Storage 버킷을 만들지 않아 새 프로젝트에 버킷이 없음.
--       코드(src/lib/questionSetUpload.ts, BUCKET='question-attachments')는 이 버킷에
--       업로드하고 getPublicUrl 로 공개 URL 을 만든다 → 공개 읽기 버킷.
--
-- 경로는 safeStoragePath() 가 무작위 UUID 로 생성하므로 URL 추측 불가.
-- id-cards · answer-files 버킷은 민감정보(신분증·답안)라 org 스코프 RLS 가 필요하며,
-- 해당 도메인 이식 단계(0006~0007)에서 별도 마이그레이션으로 만든다.

insert into storage.buckets (id, name, public)
values ('question-attachments', 'question-attachments', true)
on conflict (id) do nothing;

-- 공개 읽기 (응시자가 시험 중 첨부 다운로드)
create policy "qattach_public_read"
  on storage.objects for select
  using (bucket_id = 'question-attachments');

-- 업로드/수정/삭제는 로그인 사용자 (문제은행은 org_admin/org_owner 전용 화면).
-- TODO: 경로에 org_id 를 넣어 조직 관리자만 쓰도록 조이는 건 도메인 이식 단계에서.
create policy "qattach_auth_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'question-attachments');

create policy "qattach_auth_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'question-attachments');

create policy "qattach_auth_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'question-attachments');
