-- 0032_seed_question_fixtures.sql
--
-- 문항 실습 문서 14건. 생성 파일이다 — 직접 고치지 말고
-- supabase/fixtures/docs/ 를 고친 뒤 다시 만든다:
--   node scripts/gen-fixture-docs.mjs > supabase/migrations/0032_seed_question_fixtures.sql
--
-- 왜 Storage 가 아니라 테이블인가
--   question-attachments 버킷은 public read 다(0012). 경로만 알면 누구나 받는다.
--   시험 콘텐츠를 거기 두면 그대로 문제 유출 통로가 된다. 문서 픽스처는 전부
--   작은 텍스트이므로 테이블에 두고 RLS 로 "그 시험을 치르는 사람"에게만 연다.
--   덤으로 업로드 운영 단계가 사라진다(샌드박스 픽스처와 같은 원칙).

begin;

-- ===========================================================================
-- 1. 테이블
-- ===========================================================================
create table if not exists public.question_fixtures (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  org_id      uuid references public.organizations(id) on delete cascade,
  path        text not null,
  mime_type   text not null default 'text/markdown',
  sort_order  int  not null default 0,
  content     text not null,
  created_at  timestamptz not null default now(),

  constraint question_fixtures_path_not_blank check (length(btrim(path)) > 0),
  constraint question_fixtures_content_not_blank check (length(content) > 0)
);

comment on table public.question_fixtures is
  '문항 실습 문서. 응시자가 받아 보는 자료이며 그 시험을 치르는 사람에게만 열린다. '
  'public read 버킷에 두면 문제 유출이 되므로 Storage 를 쓰지 않는다.';

create unique index if not exists question_fixtures_path_uniq
  on public.question_fixtures (question_id, path);
create index if not exists question_fixtures_org_idx on public.question_fixtures (org_id);

-- org_id 는 문항에서 상속한다(0006 의 공용 트리거 함수). 플랫폼 문항이면 NULL.
drop trigger if exists question_fixtures_inherit_org on public.question_fixtures;
create trigger question_fixtures_inherit_org
  before insert or update of question_id on public.question_fixtures
  for each row execute function public.inherit_org_from_question();

-- ===========================================================================
-- 2. 권한 · RLS
-- ===========================================================================
alter table public.question_fixtures enable row level security;

-- Supabase default privileges 가 anon·authenticated 에 ALL 을 주므로(0030 참고)
-- 쓰기를 먼저 회수한다. 정책이 없다고 UPDATE·DELETE 가 막히지 않는다.
revoke insert, update, delete, truncate on public.question_fixtures from anon, authenticated;
revoke select on public.question_fixtures from anon;
grant select on public.question_fixtures to authenticated;
grant all    on public.question_fixtures to service_role;

-- 읽기: 그 문항이 출제된 시험을 (a) 지금 치르는 응시자이거나 (b) 그 시험을
-- 운영하는 조직의 평가자. 플랫폼 문항은 org_id 가 NULL 이라 org 로는 판정할 수
-- 없으므로 두 경우 모두 exam_questions 를 거쳐 판정한다.
drop policy if exists "question fixture read" on public.question_fixtures;
create policy "question fixture read" on public.question_fixtures
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.exam_questions eq
      join public.exam_sessions s on s.exam_id = eq.exam_id
      where eq.question_id = question_fixtures.question_id
        and s.applicant_id = auth.uid()
        and s.status = 'in_progress'
    )
    or exists (
      select 1
      from public.exam_questions eq
      where eq.question_id = question_fixtures.question_id
        and public.is_org_examiner(eq.org_id)
    )
  );

-- ===========================================================================
-- 3. 시드
-- ===========================================================================
insert into public.question_fixtures (question_id, path, mime_type, sort_order, content)
select q.id, v.path, v.mime_type, v.sort_order, v.content
from (values
    ('CAPA-02', '고시_원문.md', 'text/markdown', 10, '# 중소기업 재직자 AI 활용 교육훈련비 지원 고시

**제정** 2026-03-20 / **시행** 2026-04-01

## 제1조 (목적)
이 고시는 중소기업 재직자의 인공지능 활용 능력 향상을 위한 교육훈련비 지원의
대상·범위·절차를 정하는 것을 목적으로 한다.

## 제2조 (적용 대상)
① 이 고시는 상시근로자 300명 미만인 기업의 재직자에게 적용한다.
② 다음 각 호의 업종은 적용하지 아니한다.
   1. 금융 및 보험업
   2. 부동산 임대업
   3. 「식품위생법」상 유흥주점영업 및 단란주점영업

## 제3조 (지원율)
① 「중소기업기본법」상 중소기업: 교육훈련비의 80퍼센트
② 「중견기업 성장촉진법」상 중견기업: 교육훈련비의 50퍼센트
③ 제1항·제2항에 따른 지원율은 같은 기업이 같은 회계연도에 신청하는 모든
   과정에 동일하게 적용한다.

## 제4조 (신청 기한)
지원금 신청은 교육훈련이 종료된 날부터 60일 이내에 하여야 한다. 다만 천재지변
등 부득이한 사유가 있는 경우에는 그 사유가 종료된 날부터 30일 이내에 신청할 수
있다.

## 제5조 (제출 서류)
① 지원금 신청서
② 교육훈련 수료증 사본
③ 교육훈련비 납입을 증명하는 서류
④ 사업자등록증 사본

## 제6조 (중복 지원의 제한)
같은 교육훈련에 대하여 다른 법령·지침에 따른 국고 지원을 받은 경우에는 이
고시에 따른 지원을 하지 아니한다.

## 제7조 (교육기관)
교육훈련은 이 고시에 따라 등록된 교육기관이 실시한 과정이어야 한다. 등록 절차와
요건은 따로 정한다.

## 부칙
제1조 이 고시는 2026년 4월 1일부터 시행한다.
제2조 이 고시 시행 전에 종료된 교육훈련에 대해서는 종전의 기준을 적용한다.
'),
    ('CAPB-01', '규정_본문.md', 'text/markdown', 10, '# 소상공인 경영개선 지원금 운영규정 (발췌)

**시행** 2024-01-01 / 최종개정 2024-01-01

## 제3조 (지원 대상)
다음 요건을 **모두** 갖춘 사업자를 지원 대상으로 한다.
1. 사업장 소재지가 우리 시 관할구역 내에 있는 자
2. 최근 1개 회계연도 매출액이 **30억원 이하**인 자
3. 상시근로자 수가 10명 미만인 자
4. 사업 개시 후 **1년 이상** 경과한 자

## 제4조 (지원 제외)
1. 국세·지방세를 체납한 자
2. 같은 회계연도에 같은 목적의 시 지원금을 이미 받은 자
3. 휴업 또는 폐업 상태인 자

## 제5조 (지원 한도)
사업자당 연간 500만원 이내로 한다.

## 제9조 (다른 지침과의 관계)
이 규정에서 정하지 아니한 사항은 따로 정하는 연도별 시행지침에 따른다.
**다만 이 규정과 시행지침이 다른 경우에는 이 규정을 따른다.**
'),
    ('CAPB-01', '문의_12건.csv', 'text/csv', 20, '문의번호,상호,사업장소재지,대표자주소,임차여부,임대차계약서상소재지,최근매출액(원),상시근로자수,사업개시일,세금체납,당해연도동일지원수령,상태
Q01,가온베이커리,우리시 중앙로 11,우리시 중앙로 11,자가,,1850000000,4,2023-03-02,없음,없음,영업중
Q02,나래문구,우리시 서문길 5,옆시 행복로 20,임차,우리시 서문길 5,2400000000,2,2024-11-10,없음,없음,영업중
Q03,다온정비,옆시 공단로 3,우리시 남천동 7,자가,,900000000,3,2022-05-18,없음,없음,영업중
Q04,라온카페,우리시 호수로 88,우리시 호수로 88,임차,옆시 창고단지 2,2750000000,5,2021-09-01,없음,없음,영업중
Q05,마중물세탁,우리시 북구 대로 2,우리시 북구 대로 2,자가,,2950000000,9,2020-01-15,있음,없음,영업중
Q06,바로텍전자,우리시 테크로 9,우리시 테크로 9,자가,,3100000000,7,2019-07-07,없음,없음,영업중
Q07,사계꽃집,우리시 꽃길 1,우리시 꽃길 1,임차,우리시 꽃길 1,450000000,1,2026-02-20,없음,없음,영업중
Q08,아침해분식,우리시 역전로 14,우리시 역전로 14,자가,,1200000000,11,2018-04-30,없음,없음,영업중
Q09,자유여행사,우리시 공항로 6,우리시 공항로 6,자가,,2100000000,3,2017-10-02,없음,있음,영업중
Q10,차오름약국,우리시 보건로 4,우리시 보건로 4,자가,,2050000000,2,2015-06-11,없음,없음,휴업
Q11,카나리인쇄,우리시 인쇄골목 3,우리시 인쇄골목 3,자가,,2080000000,6,2016-12-01,없음,없음,영업중
Q12,타임공방,우리시 예술로 7,우리시 예술로 7,임차,우리시 예술로 7,2250000000,2,2025-08-25,없음,없음,영업중
'),
    ('CAPB-01', '지침_2025.md', 'text/markdown', 30, '# 2025년 소상공인 경영개선 지원금 시행지침

**시행** 2025-01-01

## 1. 지원 대상 판단 기준
- 관할구역 요건은 **대표자 주민등록 주소**를 기준으로 판단한다.
- 매출액 요건은 **20억원 이하**로 한다.
- 사업 개시 경과기간은 6개월 이상으로 완화한다.

## 2. 증빙
- 관할구역 판단: 주민등록초본
- 매출액 판단: 부가가치세 과세표준증명원

## 3. 적용
이 지침은 2025년 신청 건에 적용한다.
'),
    ('CAPB-01', '지침_2026.md', 'text/markdown', 40, '# 2026년 소상공인 경영개선 지원금 시행지침

**시행** 2026-01-01

## 1. 지원 대상 판단 기준
- 관할구역 요건은 **사업장 소재지**를 기준으로 판단한다. 다만 사업장을 임차한
  경우에는 **임대차계약서상 소재지**를 사업장 소재지로 본다.
- 매출액 요건은 운영규정 제3조에 따른다.
- 사업 개시 경과기간은 운영규정 제3조에 따른다.

## 2. 증빙
- 관할구역 판단: 사업자등록증 또는 임대차계약서
- 매출액 판단: 부가가치세 과세표준증명원

## 3. 적용
이 지침은 2026년 신청 건에 적용하며, 2025년 지침은 2026년 신청 건에 적용하지
아니한다.
'),
    ('CAPD-01', '메모.md', 'text/markdown', 10, '# 담당자 메모 (정리 안 됨)

- 사업명: 소상공인 디지털 전환 지원사업. 2026.3.2 ~ 2026.12.31. 소관은 경제진흥과.
  총사업비 4억 8천만원.
- 3월에 모집공고 냈고 신청 212건 들어옴. 계획은 180건이었음.
- 4월 심사. 선정 150건. 계획 150건이었으니 맞춤.
- 5월에 컨설팅 시작했는데 컨설턴트 2명이 빠져서 늦어짐. 계획 150건 중 112건만 완료.
- 6월에 보충 투입해서 누적 150건 다 끝냄.
- 예산: 컨설팅비 3억(집행 2억 7천4백), 홍보비 4천만원(집행 3천8백만원),
  운영비 8천만원(집행 5천1백만원), 예비비 4천만원(집행 0).
- 문제: 컨설턴트 이탈로 5월 일정 지연. 7월까지 인력풀 확대하기로 함. 담당 김주무관.
- 문제: 신청자 중 폐업 예정자가 6건 섞여 있었음. 사전 확인 절차 추가. 8월까지. 담당 이주무관.
- 하반기엔 성과평가 용역 발주 예정. 10월.
'),
    ('CAPD-01', '지정서식.md', 'text/markdown', 20, '# [지정 서식] 사업 추진 보고서

> 항목 순서와 표 구조를 바꿀 수 없습니다. 분량은 A4 2장입니다.

## 1. 사업 개요
(사업명·기간·소관부서·총사업비를 한 문단으로)

## 2. 추진 배경

## 3. 추진 경과
### [표 1] 월별 추진 실적
| 월 | 계획 | 실적 | 달성률(%) | 비고 |
|---|---|---|---|---|

## 4. 예산 집행 현황
### [표 2] 예산 집행
| 항목 | 예산액(천원) | 집행액(천원) | 집행률(%) | 잔액(천원) |
|---|---|---|---|---|

## 5. 주요 성과

## 6. 문제점 및 조치사항
### [표 3] 문제점·조치
| 구분 | 문제점 | 조치사항 | 조치기한 | 담당 |
|---|---|---|---|---|

## 7. 향후 계획

## 8. 행정사항

## 9. 붙임
'),
    ('CAPD-01', '집계표.csv', 'text/csv', 30, '월,계획건수,실적건수
3,180,212
4,150,150
5,150,112
6,150,150
'),
    ('CAPD-01', '회의록.md', 'text/markdown', 40, '# 사업 추진상황 점검회의 (요약)

일시 2026-07-03 / 참석 경제진흥과장, 담당 2명, 수행기관 2명

1. 과장: 5월 지연은 종료됐지만 보고서에는 지연 사실과 조치를 반드시 적을 것.
2. 수행기관: 참여 업체 만족도 조사 결과 평균 4.2점(5점). 응답 118건.
3. 담당: 매출 증가 효과는 아직 측정 불가. 연말 성과평가 용역에서 확인 예정.
   보고서에 추정치를 쓰지 말 것으로 정리.
4. 과장: 예비비는 연말까지 집행 계획 없으면 반납 검토.
'),
    ('CAPE-01', '정책동향_보고서.md', 'text/markdown', 10, '# AI 활용 정책 동향 보고 (초안)

작성: 정책기획팀 / 2026-02

## 1. 국내 기업 AI 활용 현황

한국노동연구원이 2024년에 실시한 『기업 AI 활용 실태조사』에 따르면, 국내
기업의 생성형 AI 도입률은 **47.3%** 로 나타났다. 도입 기업 중 전사 확산
단계에 이른 곳은 9.2% 에 그쳐, 도입과 정착 사이에 상당한 간극이 있음을 보여
준다.

미도입 사유로는 보안 우려가 38.4% 로 가장 높았고, 활용 방법을 모른다는 응답이
27.1% 로 뒤를 이었다.

## 2. 정부 예산

산업통상자원부 『2026년 디지털 전환 예산 개요』에 따르면 2026년 디지털 전환
관련 총 예산은 **1조 2,450억원** 이며, 이 중 중소기업 대상 사업이 612억원이다.
전년 대비 8.3% 증가한 규모다.

## 3. 도입 성과

한국무역협회 분석에 따르면 AI를 도입한 기업의 전년 대비 평균 매출 증가율은
6.4% 로, 미도입 기업(4.1%)보다 높았다. **AI를 도입했기 때문에 매출이 2.3%p
더 증가한 것으로, 도입 효과가 수치로 확인된다.**

## 4. 교육훈련 참여 현황

| 구분 | AI 관련 과정 수강 비율 | 구성비 |
|---|---|---|
| 대기업 | 24.6% | 50.3% |
| 중견기업 | 15.2% | 31.1% |
| 중소기업 | 8.9% | 26.6% |
| 합계 | — | 108.0% |

중소기업의 수강 비율이 8.9% 로 대기업의 3분의 1 수준에 머물러, 기업 규모에
따른 격차가 뚜렷하다.

## 5. 시사점

도입률과 정착률의 간극, 그리고 규모별 교육 격차를 함께 고려할 때, 중소기업
재직자를 대상으로 한 실무 중심 교육 지원이 우선 과제로 판단된다.
'),
    ('CAPE-01', '참고자료.md', 'text/markdown', 20, '# 참고자료 모음 (원문 발췌)

> 보고서 작성에 사용된 1차 자료의 발췌입니다. 수치·연도·기관명은 이 자료가
> 기준입니다.

## [자료 A] 한국직업능력연구원, 『기업 AI 활용 실태조사』, 2025년 11월

- 조사 대상: 국내 기업 2,104개사 (상시근로자 10인 이상)
- 조사 시점: 2025년 8월 ~ 9월
- 생성형 AI를 업무에 **도입했다고 응답한 기업 비율: 31.8%**
- 도입 기업 중 **전사 확산 단계라고 응답한 비율: 9.2%**
- 미도입 사유 1순위: 보안 우려 38.4%, 2순위: 활용 방법을 몰라서 27.1%

## [자료 B] 산업통상자원부, 『2026년 디지털 전환 예산 개요』, 2026년 1월

- 2026년 디지털 전환 관련 총 예산: **1,245억원**
- 이 중 중소기업 대상 사업: 612억원
- 전년 대비 증감: +8.3%

## [자료 C] 한국무역협회, 『AI 도입 기업의 성과 분석』, 2025년 12월

- 분석 대상: AI 도입 기업 340개사
- 도입 기업의 전년 대비 평균 매출 증가율: 6.4%
- 미도입 기업의 전년 대비 평균 매출 증가율: 4.1%
- 보고서 본문: "두 집단 간 차이가 관찰되었으나, 도입 기업이 상대적으로 업력이
  길고 규모가 큰 경향이 있어 **도입 자체의 효과로 단정하기 어렵다**."

## [자료 D] 고용노동부, 『직업능력개발 통계연보』, 2025년

- 기업 교육훈련 참여자 중 AI 관련 과정 수강 비율
  - 대기업 24.6%
  - 중견기업 15.2%
  - 중소기업 8.9%
'),
    ('CAPF-01', '업무실태_설문.csv', 'text/csv', 10, '부서,직무,반복업무명,월간_처리건수,건당_소요분,연간_소요시간,AI적용_희망도(1-5)
경영지원,총무,회의록 작성,22,45,198,5
경영지원,총무,비품 발주 정리,15,20,60,4
경영지원,인사,입퇴사 서류 점검,8,60,96,4
경영지원,인사,교육 수요조사 집계,2,240,96,5
영업1,영업관리,주간 실적 취합,4,180,144,5
영업1,영업관리,거래처 메일 회신,80,10,160,3
영업2,영업관리,견적서 작성,45,25,225,4
생산관리,생산기획,생산일보 집계,22,50,220,5
생산관리,품질,불량 원인 보고서,6,120,144,4
연구개발,연구기획,특허 동향 조사,2,480,192,5
연구개발,연구기획,주간 보고 작성,4,90,72,3
품질보증,품질,검사성적서 정리,30,35,210,4
'),
    ('CAPF-01', '현황_메모.md', 'text/markdown', 20, '# 업무 실태 조사 메모

- 조사 대상: 6개 부서 12개 반복업무. 담당자 자기기입식. 2026년 9월 조사.
- 연간 소요시간은 월간 처리건수 × 건당 소요분 × 12 ÷ 60 으로 계산했습니다.
- 인건비 환산 단가는 시간당 32,000원(사무직 평균, 간접비 포함)을 씁니다.
- 현재 도입 가능한 예산은 연 2,000만원 수준입니다.
- 작년 RPA 과제는 6개월 만에 중단됐습니다. 대상 업무가 분기마다 양식이 바뀌어
  유지보수가 안 됐습니다.
'),
    ('CAPF-02', '반대의견.md', 'text/markdown', 10, '# AI 도입 과제에 대한 부서 의견 (취합)

## 의견 1 — 정보보안팀 (팀장)

> 외부 AI 서비스에 업무 자료를 넣는 구조라면 동의하기 어렵습니다. 작년에
> 협력사 직원이 설계도를 개인 계정 번역 서비스에 올린 사고가 있었고, 그때
> 저희가 전사 공지를 냈습니다. 이번 과제가 그 공지와 어긋나는 것처럼 보이면
> 현장에서 "보안팀이 말을 바꾼다"는 말이 나옵니다. 사고가 나면 책임은 결국
> 저희 팀으로 옵니다. 어디까지 올려도 되는지 선이 문서로 없으면 승인할 수
> 없습니다.

## 의견 2 — 생산관리팀 (파트장)

> 저희 파트에 보고서 쓰는 일만 하는 직원이 두 명 있습니다. 그 일을 AI가
> 한다고 하면 그 두 사람은 뭘 하게 됩니까. 작년 자동화 과제 때도 "업무가
> 줄어드는 게 아니라 다른 일을 한다"고 했는데, 실제로는 인력 재배치 심의에
> 올라가서 한 명이 다른 사업장으로 갔습니다. 그 일이 또 반복될 거라고 보면
> 저는 팀원들에게 이 과제를 설명할 수가 없습니다.

## 의견 3 — 경영지원팀 (차장)

> 효과 수치를 못 믿겠습니다. 지난 세 번의 디지털 과제 모두 기획서에는 "연간
> 몇 천만원 절감"이 적혀 있었는데, 종료 보고에서 그 숫자를 다시 측정한 적이
> 없습니다. 이번에도 교육비와 라이선스비는 확실히 나가고 효과는 추정입니다.
> 돈을 쓰기 전에 "무엇이 안 되면 중단한다"는 기준을 먼저 보고 싶습니다.
')
) as v(code, path, mime_type, sort_order, content)
join public.questions q on q.org_id is null and q.code = v.code
on conflict (question_id, path) do update
  set content = excluded.content,
      mime_type = excluded.mime_type,
      sort_order = excluded.sort_order;

-- ===========================================================================
-- 4. 채점 기준(심어 둔 오류) — answer_key 에만 둔다
-- ===========================================================================
-- 응시 경로(questions_public · get_exam_questions_for_session ·
-- get_exam_question_tools)는 answer_key 를 내리지 않는다. 여기 둬야 안전하다.
update public.questions q
set answer_key = q.answer_key || v.payload
from (values
    ('CAPE-01', '{"planted_errors":[{"위치":"1절 첫 문장","유형":"기관명","틀림":"한국노동연구원","바름":"한국직업능력연구원","근거":"자료 A"},{"위치":"1절 첫 문장","유형":"연도","틀림":"2024년 실시","바름":"2025년 11월 발간, 조사 시점 2025년 8~9월","근거":"자료 A"},{"위치":"1절 첫 문장","유형":"수치·출처불일치","틀림":"도입률 47.3%","바름":"31.8%","근거":"자료 A"},{"위치":"2절","유형":"단위","틀림":"1조 2,450억원","바름":"1,245억원","근거":"자료 B"},{"위치":"3절 마지막 문장","유형":"인과 단정","틀림":"도입했기 때문에 2.3%p 더 증가","바름":"자료 C 원문이 \"도입 자체의 효과로 단정하기 어렵다\"고 명시","근거":"자료 C"},{"위치":"4절 표","유형":"합계 오류","틀림":"구성비 합계 108.0%","바름":"구성비 열 자체가 근거 없음(자료 D 는 구성비를 제시하지 않음)","근거":"자료 D"}],"non_errors":["미도입 사유 38.4% / 27.1% (자료 A 와 일치)","중견기업 15.2%, 중소기업 8.9% (자료 D 와 일치)","중소기업 대상 사업 612억원, 전년 대비 +8.3% (자료 B 와 일치)"]}'::jsonb)
) as v(code, payload)
where q.org_id is null and q.code = v.code;

-- ===========================================================================
-- 5. 응시 화면용 조회 RPC
-- ===========================================================================
create or replace function public.get_question_fixtures(_session_id uuid)
returns table (question_id uuid, path text, mime_type text, content text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  _sess public.exam_sessions;
begin
  select * into _sess from public.exam_sessions s where s.id = _session_id;
  if not found then
    raise exception '세션을 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;

  if not (
    _sess.applicant_id = auth.uid()
    or public.is_platform_admin()
    or _sess.org_id = any (public.user_org_ids())
  ) then
    raise exception '이 세션의 자료를 볼 권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;

  return query
  select f.question_id, f.path, f.mime_type, f.content
  from public.exam_questions eq
  join public.question_fixtures f on f.question_id = eq.question_id
  where eq.exam_id = _sess.exam_id
  order by f.question_id, f.sort_order, f.path;
end $fn$;

comment on function public.get_question_fixtures(uuid) is
  '응시 세션에 출제된 문항들의 실습 문서. 채점 기준(answer_key)은 포함하지 않는다.';

revoke all on function public.get_question_fixtures(uuid) from public, anon;
grant execute on function public.get_question_fixtures(uuid) to authenticated, service_role;

commit;
