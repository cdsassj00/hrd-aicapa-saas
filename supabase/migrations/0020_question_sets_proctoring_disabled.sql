-- 0020_question_sets_proctoring_disabled.sql
-- 세트 단위 감독(프록터링) 정책 토글.
-- 프런트(SetManageSection '감독 OFF' 스위치)가 question_sets.proctoring_disabled 를
-- 업데이트하는데 컬럼이 없어 "schema cache" 오류가 났다. 추가한다.
-- true 이면 해당 세트 풀이 중 전체화면/얼굴/음성 감지를 일시 중지.
-- 기존 RLS/org 스코프는 question_sets 정책을 그대로 상속(컬럼 추가만).

alter table public.question_sets
  add column if not exists proctoring_disabled boolean not null default false;

comment on column public.question_sets.proctoring_disabled is
  'true면 이 세트 응시 중 감독(전체화면/얼굴/음성 감지) 일시 중지';
