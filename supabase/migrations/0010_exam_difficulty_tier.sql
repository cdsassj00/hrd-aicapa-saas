-- 0010_exam_difficulty_tier.sql
-- 시험 난이도 등급을 되살린다 — 결과 등급과는 다른 축이다.
--
-- 두 개의 서로 다른 "등급"이 있다. 초기 설계에서 이 둘을 뭉개는 실수가 있었다:
--
--   · 난이도 등급  = 어느 난이도의 시험을 보는가.  exams 의 속성.
--                    원본의 green/blue/black 이 이것이었다("등급시험").
--                    AI 접근·과금이 여기에 묶인다(ASSESSMENT_DESIGN.md §7).
--
--   · 결과 등급    = 평가를 본 뒤 몇 등급/몇 점인가.  세션의 결과.
--                    exam_sessions.grade_level_id → grade_levels(우수/양호/보통/미흡).
--                    0005·0007 에 이미 있다. 이건 건드리지 않는다.
--
-- 난이도 등급은 플랫폼 제품 티어라 앱/설정이 값으로 분기한다. 티어 명칭을 아직
-- 확정하지 않았으므로 text 로 두고, 시험 화면 이식 때 통제 어휘로 굳힌다.
-- (org 별로 다르지 않은 플랫폼 개념이라 org_id 스코프가 아니다 — exams 는 이미
--  org 스코프이고, tier 는 그 시험이 '어느 난이도'인지를 나타내는 라벨일 뿐이다.)

alter table public.exams
  add column difficulty_tier text;

comment on column public.exams.difficulty_tier is
  '시험 난이도 등급(그린/블루/블랙 계열). 결과 등급(grade_levels)과 다른 축 — 이건 시험이 요구하는 난이도이며 AI 접근·과금이 여기 묶인다(ASSESSMENT_DESIGN.md §7). 결과로 받는 등급은 exam_sessions.grade_level_id 를 볼 것.';
