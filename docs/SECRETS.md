# 외부 서비스 키 목록

> 코드가 실제로 참조하는 값만 적었습니다. 근거: `grep -r "Deno.env.get" supabase/functions`
> 작성 기준: 마이그레이션 `0007` 시점

## 대원칙 — 원본과 계정 공간을 분리한다

기존 러버블 프로젝트(`champion-monito` / aicapa.kr)는 **운영 중인 NIA 납품 시스템**입니다.
그 프로젝트의 키를 이 레포에서 재사용하면 안 됩니다.

| 이유 | 설명 |
|---|---|
| 사고 전파 | 한쪽에서 키가 유출돼 폐기하면 다른 쪽이 같이 죽습니다 |
| 데이터 혼입 | 특히 R2·Daily 는 버킷/방이 섞이면 NIA 응시자 녹화와 신규 고객사 녹화가 한 곳에 쌓입니다 |
| 요금 분리 | 어느 쪽이 얼마 썼는지 나눌 수 없으면 고객사 청구 근거가 없습니다 |
| 보안심사 | "다른 서비스와 자격증명을 공유하는가"는 실제 심사 문항입니다 |

**계정 자체는 재사용해도 됩니다.** 분리해야 하는 것은 그 안의
프로젝트/버킷/도메인/키입니다. 아래 "분리 단위" 열이 그 기준입니다.

## 넣는 위치는 세 곳뿐

| 위치 | 무엇 | 왜 |
|---|---|---|
| **Supabase → Edge Functions → Secrets** | 서버 전용 키 전부 | Edge Function 이 Supabase 에서 돌기 때문 |
| **Cloudflare Workers → Build variables** | `VITE_*` 3개 | 빌드 시점에 번들에 박히므로 런타임 변수가 아니라 **빌드** 변수 |
| **로컬 `.env`** | `VITE_*` 3개 | `.gitignore` 로 커밋되지 않습니다 |

`service_role` 키는 `.env` 에도 Cloudflare 에도 **절대** 넣지 마세요.
브라우저로 나가는 순간 RLS 가 통째로 우회됩니다.

---

## 1. 지금 당장 필요 — 이미 설정됨

| 키 | 값 | 위치 |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://eoeiqpgzoyltrawfflhj.supabase.co` | 빌드 변수 + `.env` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | 빌드 변수 + `.env` |
| `VITE_SUPABASE_PROJECT_ID` | `eoeiqpgzoyltrawfflhj` | 빌드 변수 + `.env` |

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 는
**등록할 필요가 없습니다.** Supabase 가 Edge Function 에 자동 주입합니다.

## 2. 다음 차례 — 초대 메일

| 키 | 발급처 | 분리 단위 | 비고 |
|---|---|---|---|
| `RESEND_API_KEY` | Resend → API Keys | **키를 새로 발급** | 원본과 다른 키. 권한은 `Sending access` 만 |
| `MAIL_FROM` | 직접 지정 | **발신 도메인 분리** | 예: `AI CAPA <noreply@aicapa.io>` |

**추가로 필요한 것: 발신 도메인 인증.** Resend 에 도메인을 등록하고 SPF·DKIM·DMARC
DNS 레코드를 넣어야 합니다. 원본이 쓰는 `aicapa.kr` 을 그대로 쓰면 두 시스템이
같은 발신자로 메일을 보내게 되므로, 별도 도메인이나 서브도메인(`mail.aicapa.io`)을
권합니다. DNS 반영에 시간이 걸리니 미리 걸어두세요.

## 3. SMS 본인확인 — 네이버 클라우드 SENS

| 키 | 발급처 | 분리 단위 |
|---|---|---|
| `NCP_ACCESS_KEY` | NCP → 마이페이지 → 인증키 관리 | 계정 재사용 가능 |
| `NCP_SECRET_KEY` | 같은 화면 | 계정 재사용 가능 |
| `NCP_SENS_SERVICE_ID` | SENS → Project → SMS | **서비스(프로젝트)를 새로 생성** |
| `NCP_SMS_SEND_NO` | 사전등록·승인된 발신번호 | 원본과 같은 번호 가능 |
| `SEND_SMS_HOOK_SECRET` | Supabase → Auth → Hooks 등록 시 자동 발급 | — |

**추가로 필요한 것: 발신번호 사전등록.** 통신서비스 이용증명원 등 서류가 필요하고
승인에 1~2일 걸립니다. 미리 신청하세요.

`SEND_SMS_HOOK_SECRET` 을 빠뜨리면 훅이 500 을 반환하며 문자를 보내지 않습니다 —
검증 없이 발송하지 않는 안전 실패입니다.

## 4. AI 채점 — 공급자 중립

| 키 | 기본값 | 비고 |
|---|---|---|
| `AI_API_KEY` | 없음(필수) | OpenAI 호환 엔드포인트의 키 |
| `AI_BASE_URL` | `https://api.openai.com/v1` | 다른 공급자면 여기만 바꿉니다 |
| `AI_MODEL` | `gpt-4o-mini` | 호출부에서 개별 지정 가능 |

원본은 러버블 AI 게이트웨이를 썼고 그건 제거했습니다. **어느 공급자를 쓸지는
아직 정해지지 않았습니다** — 결정되면 이 세 개만 채우면 됩니다.

## 5. 감독·녹화 — `0008` 착지할 때

| 서비스 | 키 | 분리 단위 | 주의 |
|---|---|---|---|
| Cloudflare R2 | `R2_ACCOUNT_ID` `R2_BUCKET` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` | **버킷을 새로 생성** | 원본 버킷 공유 시 NIA 운영 녹화와 신규 고객사 녹화가 섞입니다. CORS 설정도 별도 |
| Daily.co | `DAILY_API_KEY` | **도메인(서브도메인) 분리 권장** | 방 이름 충돌·동시 참가자 한도를 나누기 위해 |
| AWS Rekognition | `AWS_REKOGNITION_ACCESS_KEY_ID` `AWS_REKOGNITION_SECRET_ACCESS_KEY` | **IAM 사용자를 새로 생성** | 최소 권한: `rekognition:CompareFaces` 만 |
| Face++ | `FACEPP_API_KEY` `FACEPP_API_SECRET` | 키 새로 발급 | 무료 티어는 QPS 제한이 낮아 대규모 응시에 부적합 |

## 6. 결정 필요 — Zoom

| 키 | 상태 |
|---|---|
| `ZOOM_ACCOUNT_ID` `ZOOM_CLIENT_ID` `ZOOM_CLIENT_SECRET` | Server-to-Server OAuth 앱 |
| `ZOOM_SDK_KEY` `ZOOM_SDK_SECRET` | Meeting SDK 앱 |

원본에 **Daily.co 와 Zoom 이 둘 다** 들어 있습니다. 화상 감독을 둘 중
무엇으로 갈지 정하지 않으면 키를 다섯 개 더 관리해야 합니다.
정리하고 하나만 남기시길 권합니다.

---

## 요약 — 서비스별 "추가로 만들어야 하는 것"

키 발급만으로 끝나지 않는 항목입니다.

| 서비스 | 키 외에 필요한 것 | 리드타임 |
|---|---|---|
| Resend | 발신 도메인 등록 + SPF/DKIM DNS | 수 시간 |
| 네이버 SENS | **발신번호 사전등록(서류 심사)** | **1~2일** |
| Cloudflare R2 | 새 버킷 + CORS 규칙 | 즉시 |
| Daily.co | 전용 서브도메인 | 즉시 |
| AWS | 전용 IAM 사용자 + 최소 권한 정책 | 즉시 |
| Google OAuth | 동의 화면 + 클라이언트 (완료) | 완료 |
| 카카오 | 앱 + Client Secret 활성화 (완료) | 완료 |
| 카카오(추가) | **비즈 앱 전환** — 이메일 필수 동의를 받으려면 필요 | 사업자 심사 |

카카오 항목은 초대 수락과 직결됩니다. 이메일이 선택 동의면 이메일 없는 계정이
생기고, `accept_org_invitation` 이 이메일 일치를 요구하므로 초대를 수락할 수
없습니다.
