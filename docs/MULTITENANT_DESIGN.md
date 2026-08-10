# HRD AI 역량진단 SaaS — 멀티테넌트 설계안

> 대상: `champion-monito`(AI CAPA / aicapa.kr) 코드베이스를 기반으로 한 **별도** 민간 B2B SaaS
> 원본 레포는 러버블과 연결되어 있어 **일절 수정하지 않음**. 본 문서는 읽기 전용 분석의 산출물.
> 작성 기준일: 2026-08-10

---

## 0. 요약

| 항목 | 결론 |
|---|---|
| 백엔드 | **Supabase 유지**. 단 Lovable Cloud → 자체 Supabase 조직(서울 리전, Pro)으로 이전 |
| 멀티테넌시 | **공유 스키마 + `org_id` + RLS** (schema-per-tenant 아님) |
| 마이그레이션 | 기존 72개 위에 얹지 말고 **squash 후 재설계** |
| 최대 작업량 | 스키마가 아니라 **RLS 정책 전면 재작성**과 문제은행 소유권 모델 |
| 원본 레포 | 무변경. NIA 납품 라인으로 계속 운영 |

---

## 1. 현재 상태 진단 (읽기 전용 분석)

### 1.1 규모

- 소스 152개(.ts/.tsx), `src/` 1.7MB
- 마이그레이션 **72개**, 테이블 **21개**, enum **10개**
- Edge Function **19개**

### 1.2 테이블 21개

```
profiles              user_roles            user_actions
exams                 exam_questions        exam_sessions
exam_invitations      exam_chat_messages    exam_announcements
questions             question_sets         question_logs
answers               grading_jobs          certifications
monitoring_events     recording_chunks      recording_diagnostics
active_sessions       sms_otp_codes         site_settings
```

### 1.3 enum 10개

```sql
app_role              ('admin','examiner','applicant','viewer')
exam_grade            ('green','blue','black')
exam_status           ('draft','open','closed')
session_status        ('waiting','in_progress','submitted','passed','failed')
question_category     ('생성형AI활용','데이터분석','서비스구현')
question_difficulty   ('easy','medium','hard')
monitoring_event_type ('face_missing','multiple_faces','tab_switch','screen_share_off')
cert_status           ('valid','revoked')
registration_mode     ('open','invite_only','hybrid')
recording_diag_status ('info','success','warn','error')
```

### 1.4 단일 테넌트의 뿌리 — 여기가 핵심

```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
```

**조직 개념이 없습니다.** `admin`이면 전 세계 admin입니다. 전 테이블 RLS가 이 함수 위에 세워져 있으므로, 여기를 바꾸면 **모든 정책이 연쇄적으로 바뀝니다**. 이 SaaS 전환의 실제 작업량은 스키마 추가가 아니라 이 재작성입니다.

추가로 단일 테넌트 전제가 박혀 있는 지점:

| 지점 | 문제 |
|---|---|
| `question_category` enum에 한글 값 고정 | 고객사마다 역량 체계가 다름 → enum이 아니라 테넌트별 테이블이어야 함 |
| `exam_grade` (green/blue/black) | NIA 고유 등급 체계. 고객사는 자기 등급명을 씀 |
| `certifications.cert_number` | 전역 유니크 전제. 테넌트별 채번이어야 함 |
| `site_settings` | 단일 행 전제. 화이트라벨 = 테넌트별 설정 |
| `questions` | 소유자 개념 없음. SaaS에서는 **플랫폼 공용 문제은행 vs 고객사 전용**이 갈림 |

---

## 2. 멀티테넌시 방식 선택

| 방식 | 격리 | 운영비 | 마이그레이션 | 판정 |
|---|---|---|---|---|
| DB-per-tenant | 최상 | 고객사 수만큼 선형 증가 | 고객사 수만큼 반복 | ✗ 초기 SaaS에 과함 |
| Schema-per-tenant | 상 | 중 | 스키마 수만큼 반복, Supabase RLS/PostgREST와 궁합 나쁨 | ✗ |
| **공유 스키마 + org_id + RLS** | 중상 (RLS가 방어선) | 낮음 | 단일 | **✓ 채택** |

RLS는 Postgres 커널 레벨에서 걸리므로 애플리케이션 버그로 우회되지 않습니다. 이미 전 테이블 RLS를 쓰고 계시니 팀 숙련도도 맞습니다.

**단, 전제 조건이 하나 있습니다**: `org_id` 없는 테이블이 단 하나라도 남으면 그게 유출 경로가 됩니다. 아래 §6의 검증 쿼리를 CI에 넣어야 합니다.

---

## 3. 신규 테넌시 코어 테이블

```sql
-- 조직(고객사)
CREATE TABLE public.organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,          -- acme.aicapa.io 서브도메인
  name          text NOT NULL,
  biz_reg_no    text,                          -- 사업자등록번호
  status        org_status NOT NULL DEFAULT 'trial',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 화이트라벨 (기존 site_settings의 테넌트판)
CREATE TABLE public.org_branding (
  org_id        uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  logo_url      text,
  primary_color text,
  cert_template jsonb,                         -- 인증서 서식
  custom_domain text UNIQUE
);

-- 멤버십 = 사용자 × 조직 × 역할  (기존 user_roles 대체)
CREATE TABLE public.org_members (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       app_role NOT NULL,
  status     member_status NOT NULL DEFAULT 'active',
  invited_by uuid REFERENCES auth.users(id),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, role)
);
CREATE INDEX ON public.org_members (user_id);

-- 플랫폼 운영자(귀사). 조직 밖에 존재 — org_members에 섞으면 안 됨
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
```

### app_role 재정의

기존 4개(`admin`/`examiner`/`applicant`/`viewer`)에 SaaS 역할을 추가합니다.

```sql
ALTER TYPE app_role ADD VALUE 'org_owner';   -- 결제·계약 주체
ALTER TYPE app_role ADD VALUE 'org_admin';   -- 기존 admin의 조직 스코프판
-- admin은 유지하되 의미를 '조직 관리자'로 좁힘. 전역 권한은 platform_admins로 분리.
```

### 과금·사용량

```sql
CREATE TABLE public.plans (
  code            text PRIMARY KEY,            -- 'starter' | 'growth' | 'enterprise'
  name            text NOT NULL,
  seat_limit      int,                         -- NULL = 무제한
  exam_limit_mo   int,
  features        jsonb NOT NULL DEFAULT '{}'  -- 감독/AI채점/화이트라벨 on-off
);

CREATE TABLE public.subscriptions (
  org_id             uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code          text NOT NULL REFERENCES plans(code),
  seats_purchased    int  NOT NULL DEFAULT 0,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  status             sub_status NOT NULL DEFAULT 'active'
);

-- 미터링: 응시 1건, AI채점 1건, 녹화 1GB 등
CREATE TABLE public.usage_events (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind        usage_kind NOT NULL,             -- 'exam_session'|'ai_grading'|'recording_gb'
  quantity    numeric NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ref_id      uuid                             -- 세션/채점 잡 참조
);
CREATE INDEX ON public.usage_events (org_id, occurred_at);
```

### 감사 로그 (기업 보안심사 필수 항목)

```sql
CREATE TABLE public.audit_logs (
  id         bigserial PRIMARY KEY,
  org_id     uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id   uuid,
  action     text NOT NULL,        -- 'exam.publish', 'cert.revoke', 'member.role_change'
  target     text,
  diff       jsonb,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

기존 `user_actions` 테이블이 있으니 그쪽을 승격시켜도 됩니다 — 실제 컬럼을 보고 판단 필요.

---

## 4. 기존 21개 테이블의 org_id 부착 맵

| 테이블 | 처리 |
|---|---|
| `exams` | `org_id` 직접 부착 ← **테넌시 루트** |
| `exam_questions`, `exam_sessions`, `exam_invitations`, `exam_chat_messages`, `exam_announcements` | `exam_id` 경유 상속. 단 RLS 성능 위해 `org_id` **비정규화 부착 권장** |
| `answers`, `grading_jobs`, `monitoring_events`, `recording_chunks`, `recording_diagnostics`, `active_sessions` | `session_id` 경유. 동일하게 `org_id` 비정규화 |
| `certifications` | `org_id` 직접 + `cert_number`를 `UNIQUE(org_id, cert_number)`로 변경 |
| `questions`, `question_sets` | **특수 — §5 참조** |
| `question_logs` | `question_id` 경유 |
| `profiles` | org 무관(전역 사용자 프로필). 조직별 정보는 `org_members`로 |
| `user_roles` | **삭제** → `org_members`로 대체 |
| `user_actions` | `audit_logs`로 승격 |
| `sms_otp_codes` | org 무관. 단 TTL 정리 잡 필요 |
| `site_settings` | **삭제** → `org_branding`으로 대체 |

> **비정규화 판단**: `answers`에서 org를 알려면 `answers → exam_sessions → exams` 2홉을 타야 합니다. RLS는 **모든 행마다** 평가되므로 2홉 서브쿼리는 대량 조회에서 그대로 비용이 됩니다. `org_id`를 중복 저장하고 트리거로 정합성을 강제하는 편이 압도적으로 낫습니다.

```sql
CREATE FUNCTION public.inherit_org_from_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT org_id INTO NEW.org_id FROM exam_sessions WHERE id = NEW.session_id;
  IF NEW.org_id IS NULL THEN RAISE EXCEPTION 'org_id 상속 실패: session %', NEW.session_id; END IF;
  RETURN NEW;
END $$;
```

---

## 5. 문제은행 소유권 — SaaS의 수익 모델이 걸린 지점

HRD SaaS에서 **파는 것은 플랫폼이 아니라 진단 콘텐츠**입니다. 문제은행 모델이 곧 가격표입니다.

```sql
ALTER TABLE public.questions
  ADD COLUMN owner_org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN visibility   question_visibility NOT NULL DEFAULT 'org';
-- owner_org_id IS NULL  → 플랫폼 공용 문항 (귀사 자산, 구독에 포함)
-- owner_org_id 있음     → 고객사 자체 제작 문항 (고객사 자산)
```

| visibility | 의미 |
|---|---|
| `platform` | 플랫폼 공용. 모든 구독 조직이 읽기 가능 |
| `licensed` | 특정 플랜/애드온 구매 조직만 (프리미엄 문항 세트) |
| `org` | 소유 조직 전용 |

읽기 정책:

```sql
CREATE POLICY "question read" ON public.questions FOR SELECT USING (
     visibility = 'platform'
  OR (visibility = 'org'      AND owner_org_id = ANY (public.user_org_ids()))
  OR (visibility = 'licensed' AND public.org_has_license(auth.uid(), id))
);
```

쓰기는 `owner_org_id`가 자기 조직일 때만. 플랫폼 공용 문항은 `platform_admins`만.

동시에 `question_category` enum(한글 3종 고정)은 테이블로 풀어야 합니다:

```sql
CREATE TABLE public.competency_frameworks (   -- 고객사별 역량 체계
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = 플랫폼 기본
  name text NOT NULL
);
CREATE TABLE public.competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL REFERENCES competency_frameworks(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL, parent_id uuid REFERENCES competencies(id),
  UNIQUE (framework_id, code)
);
```

`exam_grade`(green/blue/black)도 같은 이유로 `org_grade_scales` 테이블로 이동해야 합니다. NIA 체계를 플랫폼 기본값으로 시드하면 됩니다.

---

## 6. RLS 재설계 — `has_role` → 조직 스코프

### 6.1 기반 함수

```sql
-- 사용자가 속한 조직 목록 (RLS 재귀 방지 위해 SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(org_id), '{}')
  FROM public.org_members
  WHERE user_id = auth.uid() AND status = 'active'
$$;

-- 조직 스코프 역할 검사 — 기존 has_role의 후계
CREATE OR REPLACE FUNCTION public.has_org_role(_org_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid() AND org_id = _org_id
      AND role = _role AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;
```

### 6.2 표준 정책 템플릿

```sql
-- 읽기: 소속 조직 데이터만
CREATE POLICY "org read" ON public.exams FOR SELECT
  USING (org_id = ANY (public.user_org_ids()) OR public.is_platform_admin());

-- 쓰기: 해당 조직의 관리자만
CREATE POLICY "org admin write" ON public.exams FOR ALL
  USING      (public.has_org_role(org_id, 'org_admin') OR public.is_platform_admin())
  WITH CHECK (public.has_org_role(org_id, 'org_admin') OR public.is_platform_admin());
```

### 6.3 반드시 피해야 할 함정

**JWT 클레임에 `org_id`를 넣어 RLS를 거는 방식은 쓰지 마세요.** 한 사용자가 여러 조직에 속할 수 있고(컨설턴트, 그룹사 겸직), 클레임은 토큰 갱신 전까지 낡습니다. 멤버십 테이블 조회가 정답입니다. "현재 보고 있는 조직"은 UI 필터일 뿐 보안 경계가 아닙니다.

**`user_org_ids()`는 반드시 SECURITY DEFINER여야 합니다.** 아니면 `org_members`의 RLS를 다시 타면서 무한 재귀합니다.

### 6.4 CI 가드 — 이거 없으면 언젠가 반드시 샙니다

```sql
-- org_id 없는 공개 테이블 탐지 (화이트리스트 제외)
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relname NOT IN ('organizations','plans','profiles','platform_admins','sms_otp_codes')
  AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped);

-- RLS 미적용 테이블 탐지
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
```

두 쿼리 모두 **0행이 아니면 CI 실패**로 걸어야 합니다.

---

## 7. 마이그레이션 전략 — squash

기존 72개 위에 얹으면 안 되는 이유:

1. `user_roles` 삭제 / `site_settings` 삭제 / enum→테이블 전환은 **파괴적 변경**입니다. 증분으로 쌓으면 되돌릴 수 없는 잔해가 남습니다.
2. 신규 프로젝트는 **이관할 프로덕션 데이터가 없습니다**. 하위 호환을 지킬 이유가 0입니다.
3. 72개를 순차 재생하는 로컬 셋업은 개발자 온보딩마다 비용입니다.

권장 구성:

```
supabase/migrations/
  0001_extensions_and_types.sql      -- enum, 확장                              [적용됨]
  0002_tenancy_core.sql              -- organizations, org_members, platform_admins, org_branding [적용됨]
  0003_identity_and_rbac.sql         -- user_org_ids(), has_org_role(), is_platform_admin()       [적용됨]
  0004_profiles_and_invitations.sql  -- profiles, org_invitations, 초대 함수      [적용됨]
  0005_competency_model.sql          -- frameworks, competencies, grade_scales + 플랫폼 기본 시드 [적용됨]
  0006_question_bank.sql             -- questions, question_sets, 소유권/라이선스
  0007_assessment_core.sql           -- exams, exam_sessions, answers, grading_jobs
  0008_proctoring.sql                -- monitoring_events, recording_chunks, diagnostics
  0009_certification.sql             -- certifications (org 스코프 채번)
  0010_billing_usage.sql             -- plans, subscriptions, usage_events
  0011_audit.sql                     -- audit_logs
  0012_rls_policies.sql              -- 도메인 테이블 정책 (한 곳에 모아야 리뷰 가능)
  (0013 시드는 0005 에 통합 — 데이터 없는 역량 모델은 검증이 안 된다)
```

**RLS 정책을 한 파일에 몰아두는 것**이 핵심입니다. 테이블별로 흩으면 보안 리뷰가 불가능해집니다.

> 예외: 아이덴티티 계층 4+2개 테이블(organizations·org_branding·org_members·platform_admins·profiles·org_invitations)의 정책은 `0003`/`0004` 안에 있습니다. 이 정책들은 `user_org_ids()` 같은 기반 함수가 의존하는 대상이라 `0012` 로 미루면 "함수는 있는데 멤버십을 못 읽어 부팅이 안 되는" 순환이 생깁니다. 도메인 테이블 정책은 예정대로 전부 `0012` 한 곳입니다.

---

## 8. 이식성 방어선 (나중에 CSAP/공공 갈 때)

민간으로 먼저 가되, 나중에 국내 클라우드로 옮길 여지를 코드로 남깁니다. 비용은 거의 안 듭니다.

| 레이어 | 지금 | 방어 방법 |
|---|---|---|
| DB | Supabase Postgres | 순수 SQL만 사용. Supabase 전용 문법 없음 → 그대로 이식 |
| Auth | Supabase Auth | `src/lib/auth/` 포트 인터페이스 뒤로. `supabase.auth.*` 직접 호출 금지 |
| Storage | Supabase Storage + R2 | 이미 R2 어댑터 존재 → 동일 인터페이스로 통일 |
| Realtime | Supabase Realtime | 이벤트 채널 추상화. 감독 대시보드만 의존 |
| Functions | Deno Edge | **비즈니스 로직을 순수 TS 모듈로 분리**, Edge 함수는 HTTP 껍데기만 |

마지막 항목이 제일 중요합니다. 현재 19개 Edge Function에 로직이 인라인으로 들어 있으면, 나중에 Lambda/NCP Functions로 옮길 때 전부 다시 씁니다. 껍데기만 얇게 유지하면 이식이 수 주 작업으로 끝납니다.

---

## 9. 신규 레포 분리 — 원본 무손상 절차

**원본 레포는 열지도, 체크아웃하지도 않습니다.** 아래는 사용자가 로컬에서 직접 실행할 절차입니다.

```bash
# 1. 원본과 히스토리를 완전히 끊고 스냅샷만 확보
git clone --depth 1 https://github.com/cdsassj00/champion-monito hrd-saas
cd hrd-saas

# 2. 원본 연결 흔적 제거
rm -rf .git .lovable .prewarm .env
rm -rf supabase/migrations          # squash 재설계 (§7)
rm -f  bun.lockb package-lock.json  # 락파일 하나만 유지

# 3. 새 레포로 출발
git init && git add -A
git commit -m "chore: bootstrap HRD SaaS from AI CAPA snapshot"
# GitHub에서 신규 private 레포 생성 후
git remote add origin https://github.com/cdsassj00/<새레포명>
git push -u origin main
```

- `--depth 1`은 원본 커밋 히스토리(러버블 자동 커밋 포함)가 신규 레포로 넘어오는 것을 막습니다.
- `.lovable/` 제거로 러버블 에이전트가 신규 레포를 인식하지 않습니다.
- `.env` 제거 필수 — 원본 Supabase/R2/Daily 자격증명이 신규 프로젝트로 새어나가면 안 됩니다.
- **신규 Supabase 프로젝트를 별도 생성**하세요. 원본 DB를 공유하면 안 됩니다.

---

## 10. 착수 순서 (권장)

1. 신규 Supabase 프로젝트 생성 (ap-northeast-2 서울, Pro)
2. `0001`~`0003` 작성 → 테넌시 코어 + RBAC만 먼저. **여기서 §6.4 CI 가드를 먼저 붙임**
3. 조직 가입 / 초대 / 역할 전환 플로우 (SaaS 온보딩)
4. `0004`~`0006`으로 기존 시험 도메인 이식
5. 감독·녹화(`0007`)는 마지막 — 가장 무겁고 플랜 상위 기능
6. 과금(`0009`)은 첫 유료 고객 직전에

2번을 건너뛰고 4번부터 하고 싶은 유혹이 크지만, 테넌트 경계를 나중에 끼워 넣는 건 처음부터 세우는 것보다 몇 배 비쌉니다.

---

## 11. 미확인 사항

읽기 전용 분석만 수행했으므로 아래는 실제 컬럼 확인이 필요합니다.

- `user_actions` 실제 스키마 — `audit_logs`로 승격 가능한지
- ~~미가입자 초대 표현~~ — `0004` 의 `org_invitations` 로 해결(토큰 해시 저장 + 이메일 일치 요구)
- `question_sets` ↔ `questions` 관계 (세트 문항이 AI채점 제외 대상이라는 언급이 인프라 문서에 있음)
- `active_sessions` 용도 (동시 로그인 차단인지 감독용인지)
- Edge Function 19개 중 비즈니스 로직이 인라인인 비율 → §8 이식성 작업량 산정에 필요
