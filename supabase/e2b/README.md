# 시험용 샌드박스 템플릿

응시자가 시험 중 코드를 돌리는 환경입니다. `_shared/sandbox.ts` 가 이 템플릿을
띄웁니다.

## 왜 커스텀 이미지가 필요한가

응시 중 샌드박스의 외부 송신은 **허용목록 방식**입니다(전면 차단이 아닙니다).
이 시험의 평가 대상이 "AI 를 써서 일을 끝내는 것"이라 작업에 필요한 송신을
막으면 시험 자체가 성립하지 않습니다. 막아야 하는 것은 형평성을 깨는 통로뿐입니다
— 다른 AI 서비스를 따로 쓰는 것, 메신저로 사람에게 물어보는 것.

E2B 는 거부 목록에 도메인을 쓸 수 없고 허용 목록에만 쓸 수 있습니다. 그래서
"필요한 곳만 연다"가 그 둘을 막는 유일한 방법입니다. 다만 허용목록이 좁으면
응시 중 패키지 설치가 매번 네트워크를 타게 되므로, 자주 쓰는 패키지와 한글
폰트는 이미지에 미리 넣습니다.

## 빌드

로컬에서 한 번만 하면 됩니다(E2B 계정 필요).

```bash
npm i -g @e2b/cli
e2b auth login
cd supabase/e2b
e2b template build -c "/root/.jupyter/start-up.sh" --name hrd-exam
```

출력된 템플릿 ID 를 Supabase 엣지 함수 시크릿에 넣습니다.

| 시크릿 | 값 | 없을 때 동작 |
|---|---|---|
| `E2B_API_KEY` | E2B API 키 | 에이전트가 동작하지 않음 |
| `E2B_TEMPLATE` | 위에서 받은 템플릿 ID | 기본 `base` 이미지 — 한글 폰트·pandas 없음 |
| `SANDBOX_ALLOW_OUT` | (선택) 추가 허용 호스트 | 기본 허용목록만 열림 |
| `SANDBOX_EGRESS` | (선택) `open` | 미설정이면 허용목록 방식 |
| `SEARCH_API_URL` / `SEARCH_API_KEY` | (선택) 검색 API | 에이전트에 `web_search` 도구가 아예 노출되지 않음 |

기본 허용목록은 `_shared/sandbox.ts` 의 `DEFAULT_ALLOW_OUT` 입니다 — 패키지
저장소(PyPI)와 공개 데이터·법령·통계 사이트입니다. `SANDBOX_ALLOW_OUT` 은
쉼표로 호스트·IP·CIDR 을 **더합니다**(기본 목록을 덮지 않습니다). 도메인 매칭은
HTTP(:80) 의 Host 헤더와 TLS(:443) 의 SNI 로 동작하므로, 다른 포트를 열려면
IP·CIDR 로 적어야 합니다.

허용목록에 **없는** 것이 통제의 핵심입니다. 다른 AI 서비스(`api.openai.com`,
`api.anthropic.com`, `chatgpt.com`, `claude.ai`, `gemini.google.com`)와
메신저(telegram·kakao·slack·discord)는 목록에 없으므로 자동으로 막힙니다.

`SANDBOX_EGRESS=open` 은 리서치 문항처럼 열린 웹이 필요한 회차용입니다. 이
모드에서는 다른 AI 서비스·메신저를 도메인으로 막을 수 없으므로(거부목록이
IP·CIDR 만 받음) 형평성은 감독과 과정 로그로만 봅니다.

## 웹 검색은 샌드박스가 아니라 서버를 거칩니다

검색이 필요한 문항은 샌드박스에서 직접 나가게 하지 않고 에이전트의
`web_search` 도구로 처리합니다. 질의와 결과가 과정 로그에 남아야 "무엇을
찾아봤는지"가 채점 자료가 되기 때문입니다. 샌드박스에서 `curl` 로 나가면
아무 기록도 남지 않습니다.

## 실습 데이터

문항 실습 파일은 `supabase/fixtures/fixtures.py` 가 샌드박스 안에서 생성합니다
(Storage 업로드 단계가 없습니다). 원본을 고친 뒤에는 생성 모듈을 다시 만듭니다:

```bash
node scripts/gen-fixture-module.mjs
python3 supabase/fixtures/fixtures.py CAPA-01 20260101 /tmp/out   # 로컬 확인
```

## 버전을 고정하는 이유

`pip install` 에 버전을 못박아 두었습니다. 회차마다 라이브러리가 달라지면 같은
답안이 회차에 따라 다르게 채점됩니다. 그건 평가가 아닙니다. 패키지를 올릴 때는
템플릿을 새로 빌드하고 시행 중인 회차가 없는 시점에 교체합니다.
