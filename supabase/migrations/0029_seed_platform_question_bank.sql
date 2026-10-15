-- 0029_seed_platform_question_bank.sql
--
-- 플랫폼 문제은행 시드. ai-lit-screening 20문항 · ai-cap-core 18문항.
--
-- 생성 파일이다. 직접 고치지 말고 scripts/gen-question-seed.mjs 를 고친 뒤
--   node scripts/gen-question-seed.mjs > supabase/migrations/0029_seed_platform_question_bank.sql
-- 로 다시 만든다.
--
-- 출제 근거는 cdsassj00/vibestack `curriculum/data.js` 의 AI 업무활용 역량 모듈이다.
-- 문항마다 answer_key.meta.curriculum 에 근거 모듈 id 를 남겼다.
--
-- 역량 축은 0022 의 'ai-competency-6' 프레임워크(CAP.A~F + LIT)를 쓴다.
-- 소유는 플랫폼(org_id IS NULL · visibility='platform') — 구독 조직 전체가 읽는다.
--
-- 멱등성: questions 의 (org_id, code) 유니크 인덱스는 org_id 가 NULL 이면
-- 중복을 막지 못한다(NULL 은 서로 다른 값으로 취급). NOT EXISTS 로 직접 막는다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 문항 세트 (플랫폼 공용)
-- ---------------------------------------------------------------------------
insert into public.question_sets (org_id, visibility, code, name, description)
select null, 'platform', v.code, v.name, v.description
from (values
    ('ai-lit-screening', 'AI 리터러시 스크리닝', '객관식·단답 20문항. 보안 경계, 환각 검증, 활용 방법 구분 등 AI 업무활용의 개념 기초를 가린다. 수행형 평가 전 선별용.'),
    ('ai-cap-core', 'AI 활용 6대 역량 수행형 코어', '6대 역량별 3문항씩 18문항. 정답이 아니라 과업 완수와 과정을 본다. 대화 로그·생성 파일을 함께 채점한다.')
) as v(code, name, description)
where not exists (
  select 1 from public.question_sets s where s.org_id is null and s.code = v.code
);

-- ---------------------------------------------------------------------------
-- 2. 문항
-- ---------------------------------------------------------------------------
insert into public.questions
  (org_id, visibility, type, content, difficulty, points, answer_key, rubric, code, is_active)
select null, 'platform', v.qtype::public.question_type, v.content,
       v.difficulty::public.question_difficulty, v.points, v.answer_key, v.rubric, v.code, true
from (values
    ('LIT-01', 'multiple_choice', '다음 업무 중 추가 시스템 연결 없이 AI 대화창만으로 가장 신뢰도 높게 처리할 수 있는 것은 무엇입니까?', 'easy', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":10,"curriculum":["O11"],"source":"vibestack/curriculum"},"explanation":"LLM 은 주어진 텍스트에서 정보를 추출·조합·변환하는 일에 강합니다. 시스템에 들어 있는 사실 조회나 정확한 수치 집계는 원본 데이터를 연결하지 않으면 환각이 생깁니다.","options":[{"id":"a","text":"사내 인사규정 제12조의 현행 조문을 정확히 인용하기","is_correct":false},{"id":"b","text":"회의 녹취록에서 결정사항·담당자·기한을 표로 추출하기","is_correct":true},{"id":"c","text":"지난달 ERP 매출 실적의 정확한 합계 산출","is_correct":false},{"id":"d","text":"특정 직원의 연차 잔여일수 조회","is_correct":false}]}'::jsonb, null),
    ('LIT-02', 'multiple_choice', '외부 상용 AI 서비스 대화창에 그대로 입력해도 되는 자료는 무엇입니까?', 'easy', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":20,"curriculum":["O2","O5"],"source":"vibestack/curriculum"},"explanation":"이미 공개된 정보는 입력해도 추가 위험이 없습니다. 개인정보·미공개 정보·계약상 비밀은 입력 금지 대상이며 로컬 또는 기관 LLM 으로 처리합니다.","options":[{"id":"a","text":"주민등록번호가 포함된 대상자 명단","is_correct":false},{"id":"b","text":"미공개 입찰 예정가가 적힌 내부 검토안","is_correct":false},{"id":"c","text":"이미 보도자료로 공개된 사업 개요","is_correct":true},{"id":"d","text":"거래처와 체결한 비밀유지계약 전문","is_correct":false}]}'::jsonb, null),
    ('LIT-03', 'multiple_choice', 'AI 가 제시한 통계 수치를 보고서에 넣기 전에 가장 먼저 해야 할 일은 무엇입니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":30,"curriculum":["O6"],"source":"vibestack/curriculum"},"explanation":"교차질의는 보조 수단일 뿐 같은 오류를 반복할 수 있습니다. 1차 출처 대조만이 검증입니다.","options":[{"id":"a","text":"다른 AI 에게 같은 질문을 던져 답이 같은지 본다","is_correct":false},{"id":"b","text":"출처 기관·연도·원문 위치를 확인해 원자료와 대조한다","is_correct":true},{"id":"c","text":"소수점을 반올림해 표현을 부드럽게 한다","is_correct":false},{"id":"d","text":"문장을 공문체로 다듬는다","is_correct":false}]}'::jsonb, null),
    ('LIT-04', 'multiple_choice', '무엇을 어떻게 물어야 할지 모르는 업무를 AI 로 처리할 때 가장 효과적인 접근은 무엇입니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":40,"curriculum":["O10"],"source":"vibestack/curriculum"},"explanation":"메타 프롬프트 방식입니다. 받은 프롬프트를 실행·평가·수정하며 재사용 템플릿으로 다듬습니다.","options":[{"id":"a","text":"질문을 최대한 짧게 한 문장으로 쓴다","is_correct":false},{"id":"b","text":"상황·목표·제약을 설명하고 이 업무에 맞는 프롬프트를 설계해 달라고 요청한다","is_correct":true},{"id":"c","text":"같은 질문을 여러 번 반복해 답을 평균낸다","is_correct":false},{"id":"d","text":"영어로 번역해 묻는다","is_correct":false}]}'::jsonb, null),
    ('LIT-05', 'multiple_choice', '다음 중 전용 AI 서비스에 맡기는 위임형 활용에 해당하는 것은 무엇입니까?', 'easy', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":50,"curriculum":["O1","R2"],"source":"vibestack/curriculum"},"explanation":"대화창 안의 기능(첨부·프로젝트·딥리서치)은 대화형이고, 다른 주소나 앱을 여는 목적별 서비스가 위임형입니다.","options":[{"id":"a","text":"ChatGPT 대화창에 첨부파일을 올려 요약을 요청","is_correct":false},{"id":"b","text":"Claude 프로젝트에 참고문서를 넣고 질의","is_correct":false},{"id":"c","text":"NotebookLM 에 보고서 20건을 올려 근거 질의응답","is_correct":true},{"id":"d","text":"Gemini 대화창의 딥리서치 기능 사용","is_correct":false}]}'::jsonb, null),
    ('LIT-06', 'multiple_choice', 'AI 로 만든 이미지를 기관 홍보 포스터에 쓰려 합니다. 가장 먼저 확인할 사항은 무엇입니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":60,"curriculum":["O5","C1"],"source":"vibestack/curriculum"},"explanation":"저작권·초상권 분쟁은 약관과 생성물 권리 귀속에서 출발합니다. 품질 판단보다 앞섭니다.","options":[{"id":"a","text":"이미지 해상도","is_correct":false},{"id":"b","text":"사용한 서비스 약관의 상업적·공적 이용 범위와 생성물 권리 귀속","is_correct":true},{"id":"c","text":"파일 형식","is_correct":false},{"id":"d","text":"생성에 걸린 시간","is_correct":false}]}'::jsonb, null),
    ('LIT-07', 'multiple_choice', '에이전트에게 조사 업무를 위임할 때 결과 검수를 위해 반드시 함께 요구해야 하는 것은 무엇입니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"web","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":70,"curriculum":["O12","R3"],"source":"vibestack/curriculum"},"explanation":"위임형은 작업 과정이 보이지 않습니다. 근거를 되짚을 수 있는 형태로 산출물을 요구해야 검수가 가능합니다.","options":[{"id":"a","text":"더 많은 분량","is_correct":false},{"id":"b","text":"주장마다 출처 링크와 수집 시각","is_correct":true},{"id":"c","text":"영어 원문 병기","is_correct":false},{"id":"d","text":"더 화려한 서식","is_correct":false}]}'::jsonb, null),
    ('LIT-08', 'multiple_choice', '같은 질문인데도 결과 품질이 크게 달라지는 가장 큰 이유는 무엇입니까?', 'easy', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":80,"curriculum":["O2","O10"],"source":"vibestack/curriculum"},"explanation":"프롬프트 문구보다 컨텍스트(맥락 자료)의 양과 정확도가 결과를 지배합니다.","options":[{"id":"a","text":"모델이 매번 다른 답을 내기 때문","is_correct":false},{"id":"b","text":"역할·배경자료·출력형식·예시 같은 맥락을 얼마나 주었는지의 차이","is_correct":true},{"id":"c","text":"질문의 길이","is_correct":false},{"id":"d","text":"접속 시간대","is_correct":false}]}'::jsonb, null),
    ('LIT-09', 'multiple_choice', '외부망이 차단된 업무 PC 에서 AI 대화창을 쓰려 합니다. 올바른 절차는 무엇입니까?', 'hard', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":90,"curriculum":["O14"],"source":"vibestack/curriculum"},"explanation":"반입 승인과 사양에 맞는 모델 선택이 정석입니다. 나머지는 모두 보안 위반입니다.","options":[{"id":"a","text":"모바일 테더링으로 외부에 접속해 사용한다","is_correct":false},{"id":"b","text":"외부망에서 설치 파일과 모델을 받아 승인 절차를 거쳐 반입하고 PC 사양에 맞는 모델을 고른다","is_correct":true},{"id":"c","text":"업무 자료를 개인 PC 로 옮겨 처리한다","is_correct":false},{"id":"d","text":"사내 메일로 자료를 외부 AI 에 전송한다","is_correct":false}]}'::jsonb, null),
    ('LIT-10', 'multiple_choice', 'AI 가 짜 준 코드를 실행하는 제작형 활용에서 비개발자에게 가장 중요한 역량은 무엇입니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":100,"curriculum":["O13","O8"],"source":"vibestack/curriculum"},"explanation":"제작형은 코드를 직접 짜는 단계가 아니라 실행과 오류 해결 루프를 돌리는 단계입니다.","options":[{"id":"a","text":"알고리즘을 직접 설계하는 능력","is_correct":false},{"id":"b","text":"실행 환경을 준비하고 오류 메시지를 AI 에 전달해 고쳐 나가는 능력","is_correct":true},{"id":"c","text":"코드 문법을 외우는 능력","is_correct":false},{"id":"d","text":"최신 프레임워크를 고르는 능력","is_correct":false}]}'::jsonb, null),
    ('LIT-11', 'multiple_choice', '개인정보가 담긴 엑셀 원본을 올리지 않고 수식만 도움받으려 합니다. 가장 적절한 요청 방식은 무엇입니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"office","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":110,"curriculum":["A1","O2"],"source":"vibestack/curriculum"},"explanation":"구조와 규칙만 주어도 수식을 얻을 수 있고 원문은 밖으로 나가지 않습니다.","options":[{"id":"a","text":"파일 전체를 복사해 붙여넣는다","is_correct":false},{"id":"b","text":"열 구조와 가명 처리한 샘플 2~3행, 원하는 계산 규칙을 설명하고 수식을 요청한다","is_correct":true},{"id":"c","text":"화면을 캡처해 이미지로 올린다","is_correct":false},{"id":"d","text":"결과값만 알려 달라고 한다","is_correct":false}]}'::jsonb, null),
    ('LIT-12', 'multiple_choice', '녹음 전사 결과를 회의록으로 다듬을 때 AI 에게 맡기면 안 되는 작업은 무엇입니까?', 'easy', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":120,"curriculum":["D7","O6"],"source":"vibestack/curriculum"},"explanation":"없는 내용을 만들어 넣는 것이 환각입니다. 빠진 부분은 참석자 확인으로 메웁니다.","options":[{"id":"a","text":"문장 다듬기","is_correct":false},{"id":"b","text":"발언 요지 정리","is_correct":false},{"id":"c","text":"전사에 없는 결정사항을 추정해 채우기","is_correct":true},{"id":"d","text":"안건별로 재배열하기","is_correct":false}]}'::jsonb, null),
    ('LIT-13', 'multiple_choice', '내부 문서를 AI 가 근거로 쓰게 만드는 방식(RAG)에서 답변 품질을 가장 크게 좌우하는 것은 무엇입니까?', 'hard', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":130,"curriculum":["R6","R13"],"source":"vibestack/curriculum"},"explanation":"검색이 엉뚱한 근거를 가져오면 모델이 아무리 좋아도 답이 틀립니다. 지식베이스 정비가 먼저입니다.","options":[{"id":"a","text":"모델 크기","is_correct":false},{"id":"b","text":"문서 정비 상태와 분할·검색 단계의 적합도","is_correct":true},{"id":"c","text":"GPU 수량","is_correct":false},{"id":"d","text":"프롬프트 길이","is_correct":false}]}'::jsonb, null),
    ('LIT-14', 'multiple_choice', '매주 반복하는 수작업을 자동화하려 합니다. 가장 먼저 해야 할 일은 무엇입니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":140,"curriculum":["O3","P4","P9"],"source":"vibestack/curriculum"},"explanation":"업무 분해가 선행되지 않은 자동화는 유지보수가 안 되는 도구만 남깁니다.","options":[{"id":"a","text":"자동화 도구를 먼저 고른다","is_correct":false},{"id":"b","text":"현재 절차를 입력·판단·출력 단계로 쪼개 규칙화 가능한 구간을 가린다","is_correct":true},{"id":"c","text":"코드를 먼저 짜 본다","is_correct":false},{"id":"d","text":"예산을 신청한다","is_correct":false}]}'::jsonb, null),
    ('LIT-15', 'short_answer', 'AI 가 사실이 아닌 내용을 그럴듯하게 만들어 내는 현상을 가리키는 용어를 쓰십시오.', 'easy', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":150,"curriculum":["O6"],"source":"vibestack/curriculum"},"explanation":"환각(hallucination). 검증 없이 인용하면 그대로 문서의 오류가 됩니다.","accepted":["환각","할루시네이션","hallucination","환각현상"]}'::jsonb, null),
    ('LIT-16', 'short_answer', '외부망 연결 없이 업무 PC 에서 AI 대화를 쓰기 위해 설치하는 로컬 LLM 실행 도구를 하나만 쓰십시오.', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":160,"curriculum":["O14"],"source":"vibestack/curriculum"},"explanation":"Ollama·LM Studio·Msty·Open WebUI 등이 대표적입니다.","accepted":["Ollama","올라마","LM Studio","LMStudio","Msty","Open WebUI","llama.cpp","GPT4All"]}'::jsonb, null),
    ('LIT-17', 'short_answer', '내부 문서를 검색해 그 내용을 근거로 답을 생성하는 방식의 약어를 쓰십시오.', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":170,"curriculum":["R6"],"source":"vibestack/curriculum"},"explanation":"RAG(검색증강생성). 근거 문서를 찾아 모델에 함께 넣어 답하게 합니다.","accepted":["RAG","검색증강생성","검색 증강 생성","Retrieval Augmented Generation"]}'::jsonb, null),
    ('LIT-18', 'short_answer', 'AI 에게 역할·맥락·형식·예시·검증 조건을 담아 주는 지시문을 무엇이라 합니까?', 'easy', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":180,"curriculum":["O10"],"source":"vibestack/curriculum"},"explanation":"프롬프트. 5요소(역할·맥락·형식·예시·검증)로 점검합니다.","accepted":["프롬프트","prompt","지시문"]}'::jsonb, null),
    ('LIT-19', 'short_answer', 'AI 모델을 외부 프로그램·데이터와 표준 방식으로 연결하기 위한 프로토콜의 약어를 쓰십시오.', 'hard', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":190,"curriculum":["R6","P6"],"source":"vibestack/curriculum"},"explanation":"MCP. 도구·데이터 연결을 표준화해 에이전트가 기관 자원을 쓰게 합니다.","accepted":["MCP","Model Context Protocol","모델 컨텍스트 프로토콜"]}'::jsonb, null),
    ('LIT-20', 'short_answer', '개인정보가 포함된 자료를 외부 AI 에 넣지 않기 위해 이름·번호를 임의 값으로 바꾸는 처리를 무엇이라 합니까?', 'medium', 5, '{"meta":{"sector":"common","job_roles":[],"tool_req":"office","level":"일반","competency":"LIT","set":"ai-lit-screening","sort":200,"curriculum":["O2","O5"],"source":"vibestack/curriculum"},"explanation":"가명처리·비식별화. 구조는 유지하면서 식별 가능성을 없앱니다.","accepted":["가명처리","가명 처리","비식별화","비식별 처리","익명화","마스킹"]}'::jsonb, null),
    ('CAPA-01', 'work_based', '처음 보는 형식의 서버 접속 로그 파일(access_log.txt, 약 2만 행)이 주어집니다. 담당자는 "지난주 어느 시간대에 장애 조짐이 있었는지 알려 달라"고만 요청했습니다.

샌드박스에서 AI 를 자유롭게 활용해 다음을 끝까지 완결하십시오.
1) 로그 형식을 스스로 파악하고 필요한 항목을 뽑는다
2) 시간대별 오류 비율을 계산한다
3) 장애 조짐 시간대와 판단 근거를 한 장으로 정리해 파일로 제출한다

막히는 지점은 AI 에게 물어 해결하고, 어떤 시도가 실패했는지도 남기십시오.', 'hard', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"CAP.A","set":"ai-cap-core","sort":310,"curriculum":["O4","A4","P4"],"source":"vibestack/curriculum"},"slots":[{"id":"parse","label":"낯선 로그 형식을 스스로 해석하고 필요한 항목을 추출했는가","max_score":8,"rubric":"형식 추론 근거가 보이면 가점. AI 가 준 가정을 실제 파일로 확인했는지 본다."},{"id":"analyze","label":"시간대별 오류 비율을 올바른 기준으로 산출했는가","max_score":8,"rubric":"분모·분자 정의가 명시되어야 한다. 단순 건수 집계만이면 감점."},{"id":"finish","label":"요청받은 산출물을 파일로 완결해 제출했는가","max_score":8,"rubric":"미완성·중간 산출물 제출은 감점. 결론 문장이 있어야 한다."},{"id":"autonomy","label":"막힌 지점을 스스로 질문·재시도로 돌파한 흔적이 있는가","max_score":6,"rubric":"대화 로그에서 실패 → 원인 추정 → 재시도 사이클을 확인한다. 한 번에 받은 코드를 그대로 낸 경우 감점."}]}'::jsonb, null),
    ('CAPA-02', 'work_based', '다음 주부터 시행되는 신규 제도의 고시 원문(첨부)을 받았습니다. 담당 경험이 없는 업무이고 물어볼 선임도 없습니다.

AI 를 활용해 제도를 스스로 익힌 뒤, 직원 대상 안내문(1장)과 예상 질의 10건에 대한 답변안을 작성하십시오. 원문에 없어 확인이 필요한 항목은 추측하지 말고 "확인 필요"로 표시하고 확인처를 적으십시오.', 'medium', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.A","set":"ai-cap-core","sort":320,"curriculum":["O3","D8","R7"],"source":"vibestack/curriculum"},"slots":[{"id":"comprehend","label":"원문의 적용 대상·시점·예외를 정확히 파악했는가","max_score":8,"rubric":"적용 제외 대상 누락은 핵심 감점 항목."},{"id":"deliver","label":"안내문이 대상 독자 기준으로 바로 쓸 수 있는 수준인가","max_score":8,"rubric":"용어 풀이, 시행일, 담당 연락처 포함 여부."},{"id":"faq","label":"예상 질의 10건이 실제 문의 가능성이 높은 항목인가","max_score":8,"rubric":"원문을 반복하는 질문만 나열하면 감점."},{"id":"gap","label":"원문으로 확정할 수 없는 항목을 추측 없이 표시했는가","max_score":6,"rubric":"확인 필요 표시 없이 단정한 문장이 있으면 감점."}]}'::jsonb, null),
    ('CAPA-03', 'file_upload', '한 번도 써 본 적 없는 방식으로 업무 도구를 하나 만들어 제출하십시오. 주제는 본인 업무에서 반복되는 작업 하나를 고르면 됩니다.

제출물 두 가지
1) 동작하는 도구 파일(실행 방법 포함)
2) 학습 기록: 처음 몰랐던 것 / AI 에게 물은 순서 / 막혔던 지점과 해결 방법

완성도보다 모르는 상태에서 동작하는 결과까지 간 경로를 봅니다.', 'medium', 25, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"CAP.A","set":"ai-cap-core","sort":330,"curriculum":["O1","P1","P3"],"source":"vibestack/curriculum"}}'::jsonb, '동작 여부(8) · 선택한 업무가 실제 반복 작업인가(5) · 학습 기록의 구체성(7) · 막힌 지점의 해결 과정이 재현 가능한가(5). 학습 기록이 결과 요약에 그치면 7점 항목에서 2점 이하.'),
    ('CAPB-01', 'work_based', '보조금 지급 가능 여부를 묻는 문의 12건과, 근거가 되는 규정·지침 3개 파일이 주어집니다. 규정끼리 조건이 일부 어긋납니다.

AI 를 활용해 다음을 작성하십시오.
1) 판단에 필요한 조건을 열로 둔 조건표(각 문의 1행)
2) 규정 간 충돌 지점과 어느 규정을 우선했는지, 그 근거
3) 조건표만 보고도 같은 결론이 나오도록 판단 규칙 정리', 'hard', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"office","level":"일반","competency":"CAP.B","set":"ai-cap-core","sort":340,"curriculum":["O3","R7","D11"],"source":"vibestack/curriculum"},"slots":[{"id":"structure","label":"판단에 필요한 조건을 빠짐없이 열로 구조화했는가","max_score":9,"rubric":"규정에 있으나 표에 없는 조건이 있으면 감점."},{"id":"conflict","label":"규정 간 충돌을 찾아내고 우선순위 근거를 밝혔는가","max_score":9,"rubric":"충돌을 못 찾았으면 이 항목 0점. 상위법·최신 개정 등 근거 제시 필요."},{"id":"reproducible","label":"판단 규칙이 제3자가 같은 결론에 이를 만큼 명확한가","max_score":7,"rubric":"\"종합적으로 판단\" 같은 표현은 감점."},{"id":"context","label":"AI 에게 규정·조건·출력형식을 구조화해 전달했는가","max_score":5,"rubric":"대화 로그에서 맥락 설계 수준을 본다. 파일만 던지고 \"판단해 줘\"는 감점."}]}'::jsonb, null),
    ('CAPB-02', 'essay', '상급자에게 "그 보고서 좀 정리해 줘"라는 지시를 받았습니다. 대상 독자, 분량, 기한, 포함할 내용 모두 정해지지 않았습니다.

이 지시를 수행 가능한 과업 명세로 다시 정의해 쓰십시오. 상급자에게 되물을 질문과, 답을 받기 전에 가정으로 진행할 범위를 구분해 제시하십시오.', 'medium', 20, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.B","set":"ai-cap-core","sort":350,"curriculum":["O3","O10"],"source":"vibestack/curriculum"}}'::jsonb, '과업 명세의 완결성(목적·독자·산출물 규격·기한)(7) · 되물을 질문이 꼭 필요한 것으로 추려졌는가(5) · 가정과 확인 대상을 구분했는가(5) · 되묻지 않고 진행할 범위 판단이 합리적인가(3). 질문을 10개 이상 나열하면 추리기 항목 감점.'),
    ('CAPB-03', 'work_based', '부서에서 매달 같은 형식의 실적 보고서를 씁니다. 담당자가 바뀌어도 같은 품질이 나오도록, AI 에게 줄 맥락 패키지를 설계해 제출하십시오.

포함할 것
1) 역할·배경 설명
2) 넣어야 할 참고자료 목록과 반입 가능 여부(개인정보·미공개 정보 분리)
3) 출력 규격(항목·표 구조·분량)
4) 결과 검증 조건(무엇이 맞으면 통과인가)
5) 변수 칸을 둔 재사용 템플릿', 'medium', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.B","set":"ai-cap-core","sort":360,"curriculum":["O2","O10","D2"],"source":"vibestack/curriculum"},"slots":[{"id":"package","label":"맥락 패키지 5개 요소를 모두 갖추었는가","max_score":8,"rubric":"빠진 요소마다 감점."},{"id":"security","label":"참고자료의 반입 가능 여부를 가려 분리했는가","max_score":7,"rubric":"개인정보 포함 자료를 외부 AI 입력 대상으로 둔 경우 이 항목 0점."},{"id":"spec","label":"출력 규격이 사람이 보고 바로 재현할 수 있을 만큼 구체적인가","max_score":8,"rubric":"\"깔끔하게\" 같은 표현은 감점."},{"id":"verify","label":"검증 조건이 통과·실패를 가릴 수 있게 쓰였는가","max_score":7,"rubric":"검증 항목이 주관적 서술뿐이면 감점."}]}'::jsonb, null),
    ('CAPC-01', 'work_based', '매달 받는 거래 명세 CSV 12개 파일이 주어집니다. 지금은 담당자가 하나씩 열어 양식을 맞추고 합친 뒤 오류를 눈으로 찾습니다.

샌드박스에서 AI 를 활용해 이 작업을 한 번에 처리하는 스크립트를 만들고 실행해 결과를 제출하십시오.
1) 12개 파일을 읽어 하나로 합친다(열 이름이 파일마다 조금씩 다릅니다)
2) 중복·금액 누락·날짜 형식 오류를 찾아 별도 목록으로 남긴다
3) 다음 달에 파일만 바꿔 다시 돌릴 수 있게 만든다', 'hard', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"CAP.C","set":"ai-cap-core","sort":370,"curriculum":["P4","D4","A3"],"source":"vibestack/curriculum"},"slots":[{"id":"works","label":"스크립트가 실제로 12개 파일을 합쳐 결과를 만들었는가","max_score":8,"rubric":"실행 로그와 산출 파일로 확인. 수작업으로 만든 결과는 0점."},{"id":"validate","label":"오류 검출 항목(중복·누락·형식)을 모두 구현했는가","max_score":8,"rubric":"검출 결과가 비어 있으면 검출 로직이 작동하는지 역으로 확인."},{"id":"reusable","label":"파일만 바꿔 재실행 가능한 구조인가","max_score":7,"rubric":"경로·열 이름이 코드에 박혀 있으면 감점."},{"id":"handover","label":"다른 담당자가 실행할 수 있는 안내가 있는가","max_score":7,"rubric":"실행 명령, 필요한 준비물, 실패 시 확인할 지점."}]}'::jsonb, null),
    ('CAPC-02', 'work_based', '분기마다 제출하는 집계표를 만드는 과정이 주어집니다(현재 절차 설명서 첨부). 원본은 부서별 엑셀 7개이고, 매번 같은 변환을 손으로 합니다.

자동화하되 사람이 반드시 확인해야 하는 지점을 남기십시오. 전부 자동으로 돌려 버리면 안 되는 구간이 어디인지 판단해 근거와 함께 제시하십시오.', 'medium', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"CAP.C","set":"ai-cap-core","sort":380,"curriculum":["A3","A11","P10"],"source":"vibestack/curriculum"},"slots":[{"id":"automate","label":"반복 변환 구간을 실제로 자동화했는가","max_score":9,"rubric":"실행 가능한 산출물 필요."},{"id":"checkpoint","label":"사람 확인이 필요한 지점을 가려내고 근거를 밝혔는가","max_score":9,"rubric":"전 구간 자동화 또는 전 구간 수동이면 이 항목 3점 이하."},{"id":"failsafe","label":"입력이 예상과 다를 때 멈추거나 알리는 처리가 있는가","max_score":6,"rubric":"조용히 잘못된 결과를 내는 구조는 감점."},{"id":"effect","label":"절감 효과를 측정 가능한 지표로 제시했는가","max_score":6,"rubric":"소요 시간·오류 건수 등. \"편해진다\"만 쓰면 감점."}]}'::jsonb, null),
    ('CAPC-03', 'essay', '본인 부서 업무 중 자동화 후보 5개를 뽑고, 무엇을 먼저 할지 순서를 정해 근거와 함께 쓰십시오. 각 후보마다 실패했을 때의 피해 크기와 되돌릴 수 있는지도 함께 판단하십시오.', 'medium', 20, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.C","set":"ai-cap-core","sort":390,"curriculum":["O3","P9","O9"],"source":"vibestack/curriculum"}}'::jsonb, '후보 선정이 실제 반복 업무인가(5) · 우선순위 근거가 빈도·소요시간·위험으로 설명되는가(6) · 실패 피해와 복구 가능성 판단(6) · 먼저 하지 않을 것을 고른 근거(3). 모든 후보를 "전부 자동화 가능"으로 평가하면 위험 판단 항목 감점.'),
    ('CAPD-01', 'work_based', '지정 서식(첨부: 항목 9개, 표 3종, 분량 2장)에 맞춰 사업 추진 보고서를 작성하십시오. 내용 자료는 함께 제공되는 메모·회의록·집계표에서 가져와야 하며, 서식의 항목 순서와 표 구조를 바꿀 수 없습니다.', 'medium', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"office","level":"일반","competency":"CAP.D","set":"ai-cap-core","sort":400,"curriculum":["D1","D5","D13"],"source":"vibestack/curriculum"},"slots":[{"id":"conform","label":"서식의 항목·순서·표 구조를 그대로 재현했는가","max_score":10,"rubric":"항목 누락·순서 변경·표 열 변경은 각각 감점. 가장 비중이 큰 항목."},{"id":"source","label":"내용이 제공 자료에 근거하는가","max_score":8,"rubric":"제공 자료에 없는 수치·사실이 들어가면 감점."},{"id":"volume","label":"분량 제약을 지켰는가","max_score":6,"rubric":"초과·미달 모두 감점."},{"id":"quality","label":"문장이 보고 문서 수준으로 정리되었는가","max_score":6,"rubric":"구어체·중복 문장 감점."}]}'::jsonb, null),
    ('CAPD-02', 'work_based', '원시 데이터(CSV)와 함께 결과물 규격이 주어집니다. 규격에는 차트 종류, 축 항목, 색 구분 기준, 표의 반올림 자리, 파일 형식이 지정되어 있습니다.

샌드박스에서 규격에 정확히 맞는 차트 이미지와 표 파일을 생성해 제출하십시오. 규격과 다르게 만든 부분이 있으면 그 이유를 적으십시오.', 'hard', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"CAP.D","set":"ai-cap-core","sort":410,"curriculum":["A4","C5","A8"],"source":"vibestack/curriculum"},"slots":[{"id":"spec_match","label":"지정 규격(차트 종류·축·색 기준·반올림·형식)을 모두 충족했는가","max_score":12,"rubric":"항목별로 확인한다. 임의 변경은 사유가 있어도 감점하되 사유 기재 시 감점 폭을 줄인다."},{"id":"correct","label":"데이터 처리 결과가 원시 데이터와 일치하는가","max_score":10,"rubric":"집계 오류·단위 혼동은 치명 감점."},{"id":"repeat","label":"같은 절차로 다시 생성 가능한 형태인가(코드·설정 제출)","max_score":8,"rubric":"수작업으로 그린 결과는 0점."}]}'::jsonb, null),
    ('CAPD-03', 'file_upload', '같은 사업 내용을 세 대상에게 전달해야 합니다. 하나의 원본에서 셋을 만들어 제출하십시오.
1) 경영진 보고용 요약(반 장, 숫자 중심)
2) 현장 직원 안내용(1장, 쉬운 말)
3) 대외 보도자료용(1장, 공식 문체)

세 문서의 사실·수치가 서로 어긋나지 않아야 합니다.', 'medium', 25, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.D","set":"ai-cap-core","sort":420,"curriculum":["D8","D9","C14"],"source":"vibestack/curriculum"}}'::jsonb, '세 문서가 대상에 맞게 실제로 달라졌는가(8) · 사실·수치 정합성(8) · 각 분량·문체 제약 준수(5) · 원본에서 변환한 경로가 재현 가능한가(4). 문체만 바꾸고 내용 구성이 동일하면 첫 항목 3점 이하.'),
    ('CAPE-01', 'work_based', 'AI 가 작성한 정책 동향 보고서(첨부)가 주어집니다. 이 안에는 사실·수치·출처 오류가 섞여 있습니다.

오류를 찾아 다음 형식으로 제출하십시오: 위치 / 무엇이 틀렸는지 / 확인한 근거(출처와 확인 방법) / 수정 문장. 틀리지 않은 문장을 오류로 지적하면 감점합니다.', 'medium', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.E","set":"ai-cap-core","sort":430,"curriculum":["O6","D14","R1"],"source":"vibestack/curriculum"},"slots":[{"id":"detect","label":"실제 오류를 찾아냈는가","max_score":10,"rubric":"심어 둔 오류 건수 대비로 채점. 수치·출처 오류를 문체 지적으로 대체하면 감점."},{"id":"evidence","label":"지적마다 확인 근거를 제시했는가","max_score":8,"rubric":"\"틀린 것 같다\"는 근거가 아니다. 1차 출처 확인 여부를 본다."},{"id":"fix","label":"수정 문장이 근거와 일치하는가","max_score":7,"rubric":"수정이 또 다른 오류를 만들면 감점."},{"id":"precision","label":"오류가 아닌 문장을 오류로 지적하지 않았는가","max_score":5,"rubric":"오탐 1건당 감점. 전부 의심하는 전략을 막는 항목."}]}'::jsonb, null),
    ('CAPE-02', 'work_based', '분석 코드와 그 실행 결과, 그리고 결과를 요약한 보고 문장이 함께 주어집니다. 결론은 그럴듯하지만 분석 과정에 문제가 있습니다.

샌드박스에서 직접 데이터를 다시 돌려 보고, 어디서부터 결론이 어긋나는지 찾아 제시하십시오. 올바른 결론도 함께 산출하십시오.', 'hard', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"code_sandbox","level":"일반","competency":"CAP.E","set":"ai-cap-core","sort":440,"curriculum":["A4","A12","O6"],"source":"vibestack/curriculum"},"slots":[{"id":"reproduce","label":"주어진 코드를 실제로 재실행해 결과를 확인했는가","max_score":8,"rubric":"실행 흔적 없이 코드만 읽고 판단한 경우 4점 이하."},{"id":"rootcause","label":"결론이 어긋나는 지점을 정확히 지목했는가","max_score":10,"rubric":"표본 선택·결측 처리·단위·인과 해석 중 실제 원인을 짚었는지 본다."},{"id":"correct","label":"올바른 결론을 근거와 함께 산출했는가","max_score":8,"rubric":"재계산 결과 제시 필요."},{"id":"report","label":"비전문가가 이해할 수 있게 설명했는가","max_score":4,"rubric":"용어 나열만이면 감점."}]}'::jsonb, null),
    ('CAPE-03', 'essay', '부서에서 AI 로 만든 문서를 결재 전에 점검할 체크리스트를 설계하십시오. 문서 종류(대외 공문·내부 검토·보도자료)에 따라 점검 강도가 달라야 합니다. 각 항목은 통과·실패를 가릴 수 있게 쓰십시오.', 'medium', 20, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.E","set":"ai-cap-core","sort":450,"curriculum":["O6","O12","D14"],"source":"vibestack/curriculum"}}'::jsonb, '점검 항목이 실제 위험(환각·개인정보·저작권·수치 오류)을 덮는가(7) · 문서 종류별 강도 차이의 근거(5) · 통과·실패 판정이 가능한 서술인가(5) · 점검에 드는 시간이 현실적인가(3). 항목이 20개를 넘고 운용 방안이 없으면 마지막 항목 0점.'),
    ('CAPF-01', 'work_based', '부서의 AI 도입 과제 하나를 기획해 제출하십시오. 현재 업무 실태 자료(첨부)를 근거로 써야 합니다.

포함할 것
1) 해결할 문제와 그 크기(수치)
2) 대안 3개 비교(비용·기간·위험·효과)
3) 권고안과 고르지 않은 대안을 버린 이유
4) 성과 지표와 측정 방법
5) 실패 시 되돌리는 방법', 'hard', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.F","set":"ai-cap-core","sort":460,"curriculum":["O9","O3","A8"],"source":"vibestack/curriculum"},"slots":[{"id":"problem","label":"문제를 자료 근거의 수치로 규정했는가","max_score":7,"rubric":"체감·추정만으로 문제 크기를 말하면 감점."},{"id":"options","label":"대안 3개를 같은 기준으로 비교했는가","max_score":8,"rubric":"기준이 대안마다 다르면 감점. 들러리 대안만 세운 경우도 감점."},{"id":"decide","label":"권고안과 탈락 사유가 비교표와 일관된가","max_score":7,"rubric":"비교표 결론과 권고가 어긋나면 이 항목 2점 이하."},{"id":"measure","label":"성과 지표가 측정 가능하고 되돌리는 방법이 있는가","max_score":8,"rubric":"지표가 산출물 수(건수)뿐이면 감점."}]}'::jsonb, null),
    ('CAPF-02', 'work_based', '위 과제를 반대하는 이해관계자가 있습니다(반대 의견 3건 첨부: 보안 우려, 인력 대체 우려, 효과 의심).

각 반대 의견에 대해 상대의 기준에서 납득 가능한 대응을 설계해 제출하십시오. 반박이 아니라 상대가 무엇을 잃을까 걱정하는지 짚고, 그 손실을 줄이는 조치를 제시하십시오.', 'medium', 30, '{"meta":{"sector":"common","job_roles":[],"tool_req":"chat","level":"일반","competency":"CAP.F","set":"ai-cap-core","sort":470,"curriculum":["O9","D8","O5"],"source":"vibestack/curriculum"},"slots":[{"id":"empathize","label":"반대 의견의 실제 이해관계를 정확히 읽었는가","max_score":8,"rubric":"표면 문장만 반박하면 감점."},{"id":"respond","label":"각 우려에 구체적 조치로 대응했는가","max_score":9,"rubric":"\"안전하게 관리하겠다\"류의 선언은 감점. 조치·책임자·확인 방법 필요."},{"id":"honest","label":"아직 해결하지 못하는 부분을 숨기지 않았는가","max_score":7,"rubric":"모든 우려를 해소했다고 주장하면 이 항목 2점 이하."},{"id":"channel","label":"전달 방식(대상·시점·형식)을 상대에 맞게 설계했는가","max_score":6,"rubric":"전 직원 메일 일괄 발송 같은 단일 방식만이면 감점."}]}'::jsonb, null),
    ('CAPF-03', 'file_upload', '기획한 과제를 의사결정권자에게 10분 안에 설명해야 합니다. 두 가지를 제출하십시오.
1) 원페이저(1장): 결론 먼저, 근거 세 줄, 요청 사항 한 줄
2) 구두 설명 스크립트(2분): 예상 반문 3개와 그 답 포함

슬라이드 장식보다 결론·근거·요청의 구조를 봅니다.', 'medium', 25, '{"meta":{"sector":"common","job_roles":[],"tool_req":"office","level":"일반","competency":"CAP.F","set":"ai-cap-core","sort":480,"curriculum":["C3","D8","O9"],"source":"vibestack/curriculum"}}'::jsonb, '원페이저가 결론 먼저 구조인가(7) · 근거가 검증 가능한 수치·출처를 갖추었는가(7) · 요청 사항이 결정 가능한 형태로 한 줄에 담겼는가(5) · 예상 반문과 답이 실제 쟁점을 다루는가(6). 결론이 마지막에 나오면 첫 항목 2점 이하.')
) as v(code, qtype, content, difficulty, points, answer_key, rubric)
where not exists (
  select 1 from public.questions x where x.org_id is null and x.code = v.code
);

-- ---------------------------------------------------------------------------
-- 3. 문항 × 역량 매핑 (answer_key.meta.competency 기준)
-- ---------------------------------------------------------------------------
insert into public.question_competencies (question_id, competency_id, weight)
select q.id, c.id, 1.00
from public.questions q
join public.competency_frameworks f on f.code = 'ai-competency-6'
join public.competencies c
  on c.framework_id = f.id
 and c.code = q.answer_key -> 'meta' ->> 'competency'
where q.org_id is null
  and q.answer_key -> 'meta' ->> 'source' = 'vibestack/curriculum'
on conflict (question_id, competency_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. 세트 담기 (answer_key.meta.set / .sort 기준)
-- ---------------------------------------------------------------------------
insert into public.question_set_items (set_id, question_id, sort_order)
select s.id, q.id, (q.answer_key -> 'meta' ->> 'sort')::int
from public.questions q
join public.question_sets s
  on s.org_id is null
 and s.code = q.answer_key -> 'meta' ->> 'set'
where q.org_id is null
  and q.answer_key -> 'meta' ->> 'source' = 'vibestack/curriculum'
on conflict (set_id, question_id) do nothing;

commit;
