# CSAP(클라우드 보안인증) 전환 목록

공공기관에 SaaS로 납품하려면 CSAP SaaS 인증이 필요합니다. 지금은 민간 기업 HRD가
우선이라 착수하지 않지만(CLAUDE.md "이미 내려진 결정"), **무엇을 바꿔야 하는지**를
코드 기준으로 정리해 둡니다. 설계문서 §8 "이식성 방어선"의 실행 목록입니다.

> 인증 등급·세부 기준은 KISA 사전 상담으로 확정해야 합니다. 아래 등급 판단은 추정입니다.

## 0. 전제 — 왜 거의 모든 외부 서비스를 바꿔야 하나

- CSAP SaaS는 **CSAP 인증을 받은 국내 IaaS 위에서** 운영해야 합니다
  (NCP·KT Cloud·NHN Cloud 등의 공공 존).
- 이 서비스는 응시자 개인정보, 신분증 사진, 얼굴 영상(민감정보), 녹화를 다룹니다.
  공개 데이터만 다루는 **하등급이 아니라 중등급**일 가능성이 높습니다.
- 그러면 데이터가 인증 범위 밖(해외 SaaS·해외 리전)으로 나가는 구성은 쓸 수 없습니다.
  지금 쓰는 외부 서비스 대부분이 여기에 걸립니다.

## 1. 교체 목록 — 코드 위치 기준

| # | 구성 요소 | 지금 | CSAP 환경 대안 | 코드 영향 | 난이도 |
|---|---|---|---|---|---|
| 1 | DB·Auth·Storage·Realtime·Functions | Supabase Cloud (서울 리전, 미국 법인) | **Supabase 셀프호스팅**(오픈소스: Postgres·GoTrue·PostgREST·Realtime·Storage·Edge Runtime)을 CSAP IaaS VM/K8s에 설치 | SQL·RLS·RPC는 그대로. `SUPABASE_URL`만 교체 | 중 (운영 부담: 백업·PITR·패치 직접) |
| 2 | 프론트 호스팅 | Cloudflare Workers | IaaS 오브젝트 스토리지 + CDN, 또는 Nginx | 빌드 산출물 그대로 | 하 |
| 3 | 녹화 저장 | Cloudflare R2 | IaaS 오브젝트 스토리지(S3 호환) | `r2-upload`·`r2-playback`의 엔드포인트·키 교체 (S3 API 동일) | 하 |
| 4 | 화상감독(WebRTC) | Daily.co (미국) | **LiveKit / Jitsi / mediasoup 셀프호스팅** + TURN 서버 | `DailyProctor.tsx`, `DailyMonitorGrid.tsx`, `daily-room` 재작성 | **상** (가장 큼) |
| 5 | Zoom 연동 | Zoom API | 제거 | `zoom-meeting`, `zoom-sdk-signature` 삭제 | 하 |
| 6 | 신분증 얼굴 대조 | AWS Rekognition | 국내 IaaS 내 얼굴인식 모델 자체 운영(예: ArcFace 계열 오픈 모델) 또는 국내 클라우드의 얼굴인식 API (공공 존 제공 여부 확인 필요) | `verify-identity`, `aws-rekognition-compare-test` | 중 |
| 7 | 시험 중 얼굴 감지 모델 | `face-api.js` 가중치를 cdn.jsdelivr.net에서 로드 | 가중치 파일을 자체 호스팅 | `FaceMonitor.tsx`의 `MODEL_URL` 한 줄 | 하 |
| 8 | 폰트·외부 CDN | `index.html`의 cdn.jsdelivr.net | 자체 호스팅 | `index.html` | 하 |
| 9 | AI 채점·문항 생성·에이전트 LLM | `AI_BASE_URL`(OpenAI 호환 외부 API) | 국내 LLM(공공 존 제공 모델) 또는 오픈 모델 셀프호스팅(vLLM 등 GPU) | `_shared/ai.ts`가 OpenAI 호환이라 URL·모델명 교체로 끝. **채점 품질 재검증 필수** | 중 (GPU 비용) |
| 10 | 에이전트 코드 실행 샌드박스 | E2B (미국) | IaaS 안의 격리 실행 환경(Firecracker·gVisor 컨테이너) 자체 운영 | `_shared/sandbox.ts` 어댑터 교체 | **상** |
| 11 | 에이전트 웹 검색 | `SEARCH_API_URL` 외부 검색 API | 공공망 정책에 따라 **비활성화**가 기본. 허용 시 국내 검색 API | `exams.agent_env` 기본값 | 하 |
| 12 | 메일 | Resend (미국) | 국내 메일 발송 서비스(IaaS 제공) 또는 자체 SMTP | `send-*` 함수의 발송부 (`MAIL_FROM`, `RESEND_API_KEY`) | 하 |
| 13 | SMS | NCP SENS | 그대로 (NCP 공공 존 사용 시) | 없음 | — |
| 14 | 결제 | 토스페이먼츠 (카드·빌링) | 공공은 조달·계약 기반 → **결제 기능 비활성화**, 응시권은 플랫폼 관리자가 지급(`grant_seats`) | 플래그로 숨김 | 하 |
| 15 | 문의 접수 | Notion API | 제거(DB 저장만) | `submit-inquiry` | 하 |

## 2. 인증 심사에서 코드 밖으로 요구되는 것

코드 교체보다 이쪽이 일정을 좌우합니다.

- **관리체계 문서**: 정보보호 정책, 위험평가, 자산 목록, 변경관리, 사고대응 절차
- **접근통제**: 운영자 계정 MFA, 접근 기록 보존, 관리자 콘솔 접근 IP 제한
- **암호화**: 저장 데이터 암호화(DB·오브젝트 스토리지), 전송 구간 TLS, 키 관리(KMS)
- **로그·감사**: `audit_logs`(0003)는 이미 있음 → 보존 기간·위변조 방지 정책 추가
- **백업·복구**: 주기·복구 시험 기록 (셀프호스팅이면 직접 운영)
- **취약점 점검·모의해킹**: 인증 전후 정기 수행
- **개인정보**: 수집·이용 동의, 보존 기간 후 파기(녹화·신분증), 수탁자 고지

## 3. 지금 코드에 이미 있는 방어선

| 항목 | 상태 |
|---|---|
| 순수 SQL·RLS (Supabase 전용 문법 최소) | ✅ 셀프호스팅 Postgres로 그대로 이전 |
| 테넌트 경계를 멤버십 테이블로 판단 (JWT 클레임 미사용) | ✅ |
| 비즈니스 로직 순수 TS 모듈 분리 (`_shared/`, `src/lib/`) | 🔶 진행 중 — 채점·결제·SEB·리포트는 분리 완료, 일부 함수는 인라인 로직 잔존 |
| 녹화 저장 S3 호환 | ✅ |
| LLM 호출 OpenAI 호환 단일 어댑터 | ✅ `_shared/ai.ts` |
| 정답 노출 차단 (응시자는 정답 없는 RPC로만 문항 수신) | ✅ 0045·0046 |

## 4. 권장 순서 (공공 착수 시)

1. KISA 사전 상담으로 등급 확정 → 대상 IaaS 선정
2. 하 난이도 항목 일괄(2·3·5·7·8·12·14·15) — 플래그·설정 수준
3. Supabase 셀프호스팅 스테이징 구축, 전 E2E 재실행
4. 화상감독(4)·샌드박스(10) 교체 — 가장 큰 두 덩어리, 병렬 진행
5. 얼굴 대조(6)·LLM(9) 교체 후 **채점·본인확인 정확도 재검증**
6. 관리체계 문서·점검 → 인증 신청

에이전트 문항(10)을 공공 회차에서 빼면 4번이 화상감독 하나로 줄어 일정이 크게 단축됩니다.
