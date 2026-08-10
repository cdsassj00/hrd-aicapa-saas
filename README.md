# HRD AI 역량진단 SaaS

기업 HRD를 대상으로 하는 **AI 활용 역량진단 · 인증평가 SaaS**입니다.

## 출처와 관계

`cdsassj00/champion-monito`(AI CAPA / aicapa.kr — NIA 공공 CBT 인증시험 플랫폼)의 코드 스냅샷에서 출발했습니다. 원본은 Lovable과 실시간 동기화되는 **운영 중 시스템이며 이 레포와 무관합니다.** 커밋 히스토리는 의도적으로 끊었고(`--depth 1` 후 재초기화), `.lovable/`·`.env`·기존 마이그레이션 72개는 제거했습니다.

## 시작하기 전에 읽을 것

| 문서 | 내용 |
|---|---|
| **`CLAUDE.md`** | 확정된 아키텍처 결정과 금지사항. 작업 전 필독 |
| **`docs/MULTITENANT_DESIGN.md`** | 멀티테넌트 스키마 설계, RLS 재설계, 마이그레이션 구성 |
| `docs/ORIGIN_SPEC.md` | 원본 시스템의 최초 빌드 사양 (도메인 참조용) |
| `docs/INFRA_CAPACITY.md` | 원본 인프라 용량 산정 (동시 응시 규모 근거) |

## 스택

Vite · React 18 · TypeScript · Tailwind · shadcn-ui(Radix) · TanStack Query
Supabase(Postgres 15 / Auth / Storage / Realtime / Edge Functions)
Cloudflare R2(녹화) · Daily.co(화상감독) · AWS Rekognition + Face++(신분증 대조) · Resend(메일)

## 개발 환경

```bash
npm install
cp .env.example .env      # 신규 Supabase 프로젝트(서울 리전) 값으로 채울 것
npm run dev
```

```bash
npm run lint      # ESLint
npm test          # Vitest
npm run build     # 프로덕션 빌드
```

> `service_role` 키는 `.env`에 절대 두지 마세요. Supabase Edge Function Secrets에만 보관합니다.

## 데이터베이스

```bash
npm run db:start    # 로컬 Postgres 기동 + 마이그레이션 전체 적용 (Docker 필요)
npm run db:reset    # 0001부터 깨끗하게 재적용
npm run db:check    # 테넌시 가드 + RBAC 스모크 테스트
```

`db:check`는 CI(`.github/workflows/db-guard.yml`)에서도 그대로 돌아갑니다.

| 검사 | 파일 | 내용 |
|---|---|---|
| 테넌시 가드 | `supabase/tests/tenancy_guard.sql` | `org_id` 누락 · RLS 미적용 · `org_id` 타입/FK · `search_path` 안 잠근 SECURITY DEFINER 함수 |
| RBAC 스모크 | `supabase/tests/rbac_smoke.sql` | 테넌트 격리, 권한 상승 차단, 마지막 `org_owner` 보호, 익명 브랜딩 읽기 |

가드에 걸린 테이블을 예외 목록에 넣는 것은 "이 테이블은 테넌트 경계 밖"이라는 보안 선언입니다. 사유 없이 추가하지 마세요.

## 현재 상태

부트스트랩 단계입니다. `docs/MULTITENANT_DESIGN.md` §7의 구성(`0001`~`0012`) 중 `0001`~`0003`(테넌시 코어 · RBAC · CI 가드)까지 작성되어 있습니다.

### 남은 정리 작업

- [ ] `0004`~`0012` 마이그레이션 (역량모델 → 문제은행 → 시험 도메인 → 감독 → 인증서 → 과금 → 감사 → RLS 정책 → 시드)
- [ ] 조직 초대 플로우 — 미가입 이메일 초대는 `auth.users` 행이 없어 `org_members`로 표현 불가. `org_invitations` 테이블 필요
- [ ] 프런트엔드 `user_roles` 참조 제거 (`src/contexts/AuthContext.tsx`, `src/pages/admin/UserManagePage.tsx`) → `org_members` 기반 조직 전환 UI로 교체
- [ ] `@lovable.dev/cloud-auth-js`, `@lovable.dev/mcp-js` 의존성 제거 — `src/lib/mcp/`가 참조 중이라 함께 정리 필요
- [ ] `supabase/config.toml`의 `project_id`를 신규 프로젝트 ID로 교체
- [ ] Edge Function 19개의 비즈니스 로직을 순수 TS 모듈로 분리 (이식성 확보)
