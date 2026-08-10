# HRD AI 역량진단 SaaS

## 이 프로젝트가 무엇인가

기업 HRD 시장을 대상으로 하는 **AI 활용 역량진단 · 인증평가 SaaS**입니다.

`cdsassj00/champion-monito`(AI CAPA / aicapa.kr — NIA 공공 CBT 인증시험 플랫폼)의 코드 스냅샷에서 출발했지만, **별개의 제품**입니다. 원본은 러버블(Lovable)과 실시간 동기화되는 운영 중 시스템이며 **절대 수정 대상이 아닙니다.** 이 레포는 히스토리를 끊고(`--depth 1` 후 `.git` 제거) 새로 시작한 독립 레포입니다.

## 이미 내려진 결정 (재논의하지 말 것)

| 항목 | 결정 | 근거 |
|---|---|---|
| 영업 타깃 | **민간 기업 HRD 위주** | 공공 조달은 CSAP 필수라 스택 전체가 달라짐. 2단계로 미룸 |
| 백엔드 | **Supabase 유지** | 무거운 워크로드(녹화·WebRTC·안면인식)는 이미 Supabase 밖. AWS 직행은 고객가치 0인 인프라에 3~6개월 소모 |
| 호스팅 | **Lovable Cloud 탈출**, 자체 Supabase 조직 (ap-northeast-2 서울, Pro) | 기업 보안심사 대응. PITR·staging 분리·DB 직접 접속·DPA 직접 계약이 필요 |
| 멀티테넌시 | **공유 스키마 + `org_id` + RLS** | schema-per-tenant는 Supabase RLS/PostgREST와 궁합이 나쁨 |
| 마이그레이션 | 원본 72개를 버리고 **squash 재설계** | 이관할 프로덕션 데이터가 없어 하위호환 지킬 이유가 없음 |
| CSAP / 공공 | **지금은 안 함**. 단 이식성 방어선은 코드로 유지 | 설계문서 §8 |

## 반드시 먼저 읽을 것

**`docs/MULTITENANT_DESIGN.md`** — 원본 스키마 분석(테이블 21개·enum 10개), 테넌시 코어 설계, RLS 재설계, 마이그레이션 구성, 이식성 전략이 전부 들어 있습니다. 스키마나 권한을 건드리기 전에 반드시 읽으세요.

## 이 프로젝트의 가장 중요한 사실 하나

원본은 전 테이블 RLS가 이 함수 위에 세워져 있습니다:

```sql
has_role(_user_id uuid, _role app_role)  -- 조직 개념 없음. admin이면 전 세계 admin
```

SaaS 전환의 실제 작업량은 테이블 추가가 아니라 **이 함수와 그 위의 모든 RLS 정책을 조직 스코프로 재작성하는 것**입니다. 후계는 `user_org_ids()` / `has_org_role(org_id, role)` / `is_platform_admin()` 세 개이며, 셋 다 `SECURITY DEFINER`여야 합니다(아니면 `org_members` RLS를 다시 타면서 무한 재귀).

## 절대 하지 말 것

- 원본 레포(`champion-monito`)를 수정하거나 거기에 커밋 — 러버블 운영 시스템입니다
- JWT 클레임의 `org_id`로 RLS 걸기 — 한 사용자가 여러 조직에 속할 수 있고 토큰이 낡습니다. 멤버십 테이블을 조회하세요
- `org_id` 없는 신규 테이블 추가 — CI 가드(설계문서 §6.4)가 막습니다
- RLS 정책을 테이블별 파일로 흩기 — `0011_rls_policies.sql` 한 곳에 모아야 보안 리뷰가 가능합니다
- Edge Function에 비즈니스 로직 인라인 — 순수 TS 모듈로 분리하고 함수는 HTTP 껍데기만 (이식성)

## 스택

Vite + React 18 + TypeScript / Tailwind + shadcn-ui(Radix) / TanStack Query
Supabase(Postgres 15, Auth, Storage, Realtime, Edge Functions)
Cloudflare R2(녹화) · Daily.co(화상감독) · AWS Rekognition + Face++(신분증 대조) · Resend(메일)

## 착수 순서

1. 신규 Supabase 프로젝트 (서울, Pro)
2. `0001`~`0003` 테넌시 코어 + RBAC + **CI 가드 먼저**
3. 조직 가입/초대/역할 전환 온보딩
4. `0004`~`0006` 시험 도메인 이식
5. `0007` 감독·녹화
6. `0009` 과금 — 첫 유료 고객 직전

2번을 건너뛰고 4번부터 가고 싶은 유혹이 크지만, 테넌트 경계를 나중에 끼워 넣는 건 처음부터 세우는 것보다 몇 배 비쌉니다.
