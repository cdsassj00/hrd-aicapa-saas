# 응시 환경 잠금 — 브라우저 정책 계층

## 어디서 막고 어디서 열 것인가

통제 계층을 둘로 나눕니다. 이 구분이 이 제품의 평가 설계 그 자체입니다.

| 계층 | 무엇을 | 왜 |
|---|---|---|
| **브라우저(응시자 PC)** | 시험 사이트 외 접속 차단 | 메신저·검색·다른 사람에게 묻기를 막는다 |
| **시험 에이전트(샌드박스)** | **막지 않는다** | 도구를 얼마나 잘 쓰는지가 평가 대상이다 |

에이전트 안에서 MCP·웹검색·코드 실행·파일을 제한하면 측정되는 것은 역량이
아니라 "제한된 환경에서의 역량"입니다. 실무는 도구를 자유롭게 씁니다. 그래서
**사이트 차단은 브라우저가, 능력 차이는 에이전트가** 맡습니다.

다만 에이전트 환경은 **회차 전원에게 동일**해야 합니다. 응시자가 각자 API 키나
MCP 서버를 들고 오면 측정되는 것이 능력이 아니라 준비물이 됩니다. 회차에
연결할 MCP·스킬·검색은 `exams.agent_env` 가 정하고, 실제 적용된 환경은
`exam_agent_sessions.env_snapshot` 에 남습니다(0034).

## 1. 관리형 크롬 — URL 허용목록

기업 응시자는 대부분 관리형 크롬을 씁니다. 정책 두 개면 됩니다.

```json
{
  "URLBlocklist":  ["*"],
  "URLAllowlist": [
    "app.ai-hrd.com",
    "ai-hrd.com",
    "eoeiqpgzoyltrawfflhj.supabase.co",
    "*.daily.co"
  ]
}
```

- `URLBlocklist: ["*"]` 로 전부 막고 필요한 곳만 엽니다. 반대로 하면(차단 목록
  나열) 빠뜨린 도메인이 그대로 구멍입니다.
- Supabase 도메인은 API·Storage·엣지 함수 호출에 필요합니다. 빼면 시험이 안
  돌아갑니다.
- 화상감독을 쓰는 회차는 Daily 도메인이 필요합니다.

적용 위치
- **Windows(그룹 정책)**: `컴퓨터 구성 → 관리 템플릿 → Google Chrome →
  URL 차단 목록 / URL 허용 목록`
- **Chrome Enterprise(클라우드 관리)**: 관리 콘솔 → 기기 → Chrome → 설정 →
  사용자 및 브라우저 → URL 차단
- **macOS**: 구성 프로파일의 `com.google.Chrome` 에 같은 키

## 2. 관리형 크롬이 없을 때

개인 PC 응시는 OS 수준 통제가 불가능합니다. 현실적인 선은 **차단이 아니라
탐지와 기록**입니다. 이미 구현돼 있습니다.

| 수단 | 코드 |
|---|---|
| 전체화면 이탈·탭 전환 감지 | `src/components/exam/FullscreenGuard.tsx` |
| 화면 공유 녹화 | `DailyProctor` · R2 업로드 |
| 안면 이탈·다중 인원 감지 | `src/components/exam/FaceMonitor.tsx` |
| 에이전트 과정 로그 | `exam_agent_events` (추가 전용) |

웹 기반에서 완전 차단은 불가능합니다. 완전 차단이 요구되는 회차는 시험장
PC(키오스크 모드) 또는 설치형 락다운이 필요합니다.

```bash
# 시험장 PC 키오스크 예시
chrome --kiosk --incognito \
  --disable-extensions --disable-background-networking \
  https://app.ai-hrd.com/exam
```

## 2-1. Safe Exam Browser(SEB) 필수 회차 — 개인 PC 차단

관리형 크롬이 없는 개인 PC에서도 **차단**이 필요하면 회차 설정에서
"🔒 Safe Exam Browser 필수"를 켭니다(0046). SEB는 무료 오픈소스 잠금 브라우저
(Windows·macOS·iPad)로, 실행 중에는 다른 프로그램 전환·다른 사이트 접속·
화면 캡처·복수 모니터를 막습니다.

| 단계 | 동작 | 코드 |
|---|---|---|
| 설정 파일 | 앱이 회차용 `.seb`(XML plist)를 만든다. 시작 URL = `/applicant`, URL 필터 = 앱 도메인 + `*.supabase.co`, 웹캠·마이크 허용, 모니터 1대 | `src/lib/seb.ts` `buildSebSettings` |
| 키 등록 | 같은 설정의 Config Key(SHA-256)를 계산해 `exams.seb_config_keys`에 저장. 직접 만든 설정의 키도 추가 가능 | `ExamManagePage` |
| 응시자 | SEB 밖이면 대기실·응시 화면이 설치 안내와 `.seb` 받기를 띄운다 | `SebRequiredNotice` |
| 서버 검증 | SEB JS API가 주는 `SHA256(현재 URL + Config Key)`를 문항 RPC가 재계산해 비교. 실패하면 문항을 주지 않는다 | `get_exam_questions_for_session` |

- SEB 안에서는 `getDisplayMedia`가 없으므로 화면공유 점검·녹화는 생략하고(SEB가 화면을 잠금), 웹캠 감독은 그대로 합니다.
- 운영진(감독·관리자)은 SEB 없이 미리보기할 수 있습니다.
- **배포 전 확인**: Config Key 계산은 SEB 문서·Moodle 구현과 같은 규칙이지만, 실제 SEB 앱(Windows·macOS)에서 키가 일치하는지는 실기기로 한 번 확인해야 합니다. 불일치하면 SEB Config Tool에 표시되는 Config Key를 "직접 만든 설정의 Config Key"에 붙여 넣으면 됩니다.
- 한계: `.seb` 파일과 Config Key는 비밀이 아닙니다. 개발 지식이 있는 응시자는 일반 브라우저에서 해시를 흉내 낼 수 있습니다(Moodle 등 모든 SEB 연동의 공통 한계). 웹캠 감독과 과정 로그가 2차 방어선입니다.

## 3. 샌드박스 송신을 좁혀야 하는 경우

기본은 개방입니다. 아래 경우에만 `SANDBOX_EGRESS=allowlist` 로 바꿉니다.

- 폐쇄망 반입 회차
- 공공 조달처럼 송신 범위를 문서로 증빙해야 하는 경우

허용목록은 `_shared/sandbox.ts` 의 `DEFAULT_ALLOW_OUT` + `SANDBOX_ALLOW_OUT`
입니다. 이 모드에서는 시험 중 패키지 설치가 막힐 수 있으므로 커스텀 템플릿
(`supabase/e2b/`)을 함께 써야 합니다.

## 4. 남는 구멍 — 솔직하게

- **다른 기기**: 응시자가 옆에 둔 휴대폰은 어떤 브라우저 정책으로도 막히지
  않습니다. 화상감독의 몫입니다.
- **개인 PC**: 관리형 크롬이 아니면 정책이 적용되지 않습니다. 응시 안내에
  "관리형 기기 또는 시험장 응시"를 조건으로 걸지 여부는 회차 설계 문제입니다.
- **에이전트를 통한 외부 접근**: 의도적으로 열어 둔 것입니다. 무엇을 했는지는
  과정 로그에 전부 남고, 그 자체가 채점 자료입니다.
