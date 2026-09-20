-- 0022_competency_axis_and_question_meta.sql
-- AI 활용 6대 역량(독립축) 프레임워크 + 문항 메타(섹터·직무·도구요건·레벨) 표준화.
--
-- 배경: 기존 'ai-utilization' 프레임워크(GEN/DATA/SVC)는 "3개 작업형 영역"(채점 방식 축)이다.
-- 사용자 확정: 6대 역량은 그와 별개의 "독립축"으로 존재하며, 민간·공공 공통이고
-- 섹터·직무는 시나리오/실습파일로만 구분한다. 등급은 두지 않고 없으면 '일반'.
-- 문항의 역량 태깅은 관계형(question_competencies)으로, 섹터/직무/도구요건/레벨은
-- answer_key.meta 로 표준화해 카탈로그 필터에 사용한다.

begin;

-- 1) 6대 역량 프레임워크 (플랫폼 기본, org_id NULL). 코드 유니크가 없어 NOT EXISTS 로 idempotent 보장.
insert into public.competency_frameworks (org_id, code, name, description, is_default)
select null, 'ai-competency-6', 'AI 활용 6대 역량',
       '직무 공통 AI 활용 역량 6축 + AI 리터러시 기초 진단. 민간·공공 공통이며 섹터·직무는 시나리오로 구분한다.',
       false
where not exists (
  select 1 from public.competency_frameworks where code = 'ai-competency-6'
);

-- 2) 6대 역량 + AI 리터러시 항목. competencies.code 는 유니크이므로 on conflict 로 idempotent.
insert into public.competencies (framework_id, code, name, description, sort_order)
select f.id, v.code, v.name, v.description, v.sort_order
from public.competency_frameworks f
cross join (values
  ('CAP.A', '자기주도 과업완수 역량', '낯선 업무도 AI로 익혀 끝까지 완결하는 학습민첩성·실행력', 10),
  ('CAP.B', '과업 구조화 역량',       '자료·규정·조건을 구조화해 정확한 수행을 끌어내는 문제정의·맥락설계', 20),
  ('CAP.C', '업무 자동화 역량',       '반복 업무를 도구로 연계해 자동화하는 프로세스 개선력', 30),
  ('CAP.D', '산출물 재현·변환 역량',  '목표 산출물을 규격에 맞춰 재현·형식변환하는 정밀성·재현성', 40),
  ('CAP.E', '비판적 검증 역량',       '결과를 근거·수치와 대조해 오류를 잡아내는 비판적 사고·품질관리', 50),
  ('CAP.F', '전략기획·커뮤니케이션 역량', 'AI로 전략·기획을 세우고 납득되게 전달하는 전략적 사고·설득', 60),
  ('LIT',   'AI 리터러시',            '개념·상식 기초 진단(객관식·단답 스크리닝)', 70)
) as v(code, name, description, sort_order)
where f.code = 'ai-competency-6'
on conflict (framework_id, code) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- 3) 문항 메타 표준화: answer_key.meta = { sector, job_roles[], tool_req, level }.
--    이미 meta 가 있으면 건드리지 않는다. 섹터는 기존 tags 로 유추, 없으면 'common'.
--    도구요건은 category/type 로 유추, 레벨은 사용자 확정대로 '일반'.
update public.questions q
set answer_key = q.answer_key || jsonb_build_object(
      'meta', jsonb_build_object(
        'sector',
          case
            when (q.answer_key->'tags') ? '민간' then 'private'
            when (q.answer_key->'tags') ? '공공' then 'public'
            else 'common'
          end,
        'job_roles', '[]'::jsonb,
        'tool_req',
          case
            when (q.answer_key->>'category') in ('데이터분석', '서비스구현') then 'code_sandbox'
            when (q.answer_key->>'category') = '생성형AI활용' and q.type = 'work_based' then 'office'
            else 'chat'
          end,
        'level', '일반'
      )
    )
where q.answer_key->'meta' is null;

-- 4) meta 필터(섹터·직무·도구요건) 카탈로그 조회용 GIN 인덱스.
create index if not exists questions_meta_gin
  on public.questions using gin ((answer_key -> 'meta'));

commit;
