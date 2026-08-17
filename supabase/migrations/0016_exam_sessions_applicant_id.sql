-- 0016_exam_sessions_applicant_id.sql
-- 이식 정합성: exam_sessions 의 응시자 컬럼을 applicant_id 로 통일하고 id_card_url 추가.
--
-- squash 스키마(0007)는 exam_sessions.user_id 를 썼지만, 같은 squash 의 proctoring
-- 테이블(recording_chunks·monitoring_events·recording_diagnostics, 0008)은 이미
-- applicant_id 를 쓴다 — 스키마 내부가 불일치. 게다가 이식된 프론트/엣지함수/생성타입
-- (src/integrations/supabase/types.ts 포함)은 전부 applicant_id·id_card_url 을 기대한다.
--
-- 컬럼 하나를 rename 하면 이를 참조하는 RLS 정책(0007 session/answer, 0008 proctoring)과
-- 인덱스가 Postgres 에 의해 자동 갱신된다. 따라서 코드 수십 곳을 고치는 대신 스키마를
-- proctoring 테이블·이식 코드에 맞춰 통일한다. (org_members.user_id 등 다른 테이블의
-- user_id 는 이 rename 과 무관하다 — exam_sessions 컬럼만 바뀐다.)
alter table public.exam_sessions rename column user_id to applicant_id;

-- 신분증 이미지 경로. upload-id-card 가 여기에 저장 경로를 쓴다. 원본 이미지는 비공개
-- id-cards 버킷에 두고 여기엔 경로 문자열만 둔다(0017 에서 버킷 생성).
alter table public.exam_sessions add column if not exists id_card_url text;

-- 인덱스 이름도 의미에 맞춘다(정의 컬럼은 rename 으로 이미 applicant_id 기준).
alter index if exists exam_sessions_user_idx     rename to exam_sessions_applicant_idx;
alter index if exists exam_sessions_one_per_user rename to exam_sessions_one_per_applicant;
