-- 0021_questions_code.sql
-- 문항 관리코드 복원. 원본(champion-monito) questions.code 를 새 스키마에서 되살린다.
-- 엑셀 일괄등록이 code 로 기존 문항을 조회·덮어쓰기(upsert)하는데 컬럼이 없어
-- 실패하던 문제 해결. 조직 내에서 code 는 유일(업서트 식별키), null 허용.
alter table public.questions
  add column if not exists code text;

create unique index if not exists questions_org_code_uidx
  on public.questions(org_id, code) where code is not null;

comment on column public.questions.code is '문항 관리코드(엑셀 업서트 식별용, 조직 내 유일). null 허용.';
