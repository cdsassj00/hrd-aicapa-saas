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
Supabase(Postgres 17 / Auth / Storage / Realtime / Edge Functions)
Cloudflare R2(녹화) · Daily.co(화상감독) · AWS Rekognition + Face++(신분증 대조) · Resend(메일) · 네이버 클라우드 SENS(SMS)
호스팅: Cloudflare Workers (정적 자산)

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

원격 프로젝트: `hrd-aicapa-saas` (`eoeiqpgzoyltrawfflhj`, ap-northeast-2 서울, Pro, Postgres 17)

```bash
npm run db:start    # 로컬 Postgres 기동 + 마이그레이션 전체 적용 (Docker 필요)
npm run db:reset    # 0001부터 깨끗하게 재적용
npm run db:check    # 테넌시 가드 + RBAC 스모크 테스트

npx supabase link --project-ref eoeiqpgzoyltrawfflhj   # 원격 연결 (DB 비밀번호 필요)
npx supabase db push                                   # 원격에 마이그레이션 적용
```

`db:check`는 CI(`.github/workflows/db-guard.yml`)에서도 그대로 돌아갑니다.

| 검사 | 파일 | 내용 |
|---|---|---|
| 테넌시 가드 | `supabase/tests/tenancy_guard.sql` | `org_id` 누락 · RLS 미적용 · `org_id` 타입/FK · `search_path` 안 잠근 함수 · `anon`이 실행 가능한 SECURITY DEFINER 함수 |
| RBAC 스모크 | `supabase/tests/rbac_smoke.sql` | 테넌트 격리, 권한 상승 차단, 마지막 `org_owner` 보호, 익명 브랜딩 읽기, 초대 토큰, 역량 체계 격리·복제 |

가드에 걸린 테이블을 예외 목록에 넣는 것은 "이 테이블은 테넌트 경계 밖"이라는 보안 선언입니다. 사유 없이 추가하지 마세요.

## 현재 상태

`docs/MULTITENANT_DESIGN.md` §7의 구성 중 **`0001`~`0006`(테넌시 코어 · RBAC · CI 가드 · 프로필/초대 · 역량 체계 · 문제은행)** 가 원격 프로젝트에 적용되어 있습니다.

동작하는 것: 회원가입 → 조직 생성(`/onboarding`) → 초대 발급·수락(`/admin/members`, `/invite/accept`) → 조직 전환.
동작하지 않는 것: 시험·감독·인증서 화면 — 해당 테이블이 `0007~` 에 있어 아직 없습니다.

### 남은 정리 작업

- [x] ~~조직 가입·초대·역할 전환 온보딩~~ — `0004` + `/onboarding` · `/invite/accept` · `/admin/members`
- [x] ~~프런트엔드 `user_roles` 참조 제거~~ — `AuthContext`가 `org_members` 기반으로 교체됨
- [x] ~~`0005` 역량 체계~~ — `competency_frameworks`/`competencies`/`grade_scales`/`grade_levels` + 플랫폼 기본 시드
- [x] ~~`0006` 문제은행~~ — 소유권 3분할(platform/licensed/org) + 라이선스 + 정답 비노출 뷰
- [ ] `0007`~`0012` (시험 도메인 → 감독 → 인증서 → 과금 → 감사 → RLS 정책)
- [ ] 시험 도메인 화면 이식 — `exams`·`questions`·`exam_sessions` 등을 쓰는 화면은 테이블이 아직 없어 동작하지 않습니다
- [ ] `src/integrations/supabase/types.ts` 재생성 — 지금은 이행기 파일(실제 테넌시 테이블 + 미이식 도메인 테이블이 섞여 있음)
- [ ] 초대 메일 발송(Resend) — 현재는 관리자가 초대 링크를 직접 전달합니다
- [x] ~~탈-러버블~~ — SDK·MCP 플러그인·OAuth 동의 라우트·의존성 3개 제거, Edge Function 5개의 러버블 게이트웨이를 직접 호출로 교체
- [x] ~~`supabase/config.toml`의 `project_id`를 신규 프로젝트 ID로 교체~~
- [ ] 나머지 Edge Function 의 비즈니스 로직을 순수 TS 모듈로 분리 (이식성 확보) — 메일·AI·SMS 는 `_shared/` 로 분리 완료
