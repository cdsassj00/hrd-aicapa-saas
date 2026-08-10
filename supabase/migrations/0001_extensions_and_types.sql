-- 0001_extensions_and_types.sql
-- 확장 + enum 타입 정의 (설계문서 §7)
--
-- 이 레포는 원본 72개 마이그레이션을 버리고 squash 재설계한 것이므로,
-- 하위 호환을 위한 ALTER TYPE ... ADD VALUE 없이 처음부터 최종 형태로 정의합니다.
--
-- 의도적으로 만들지 않는 enum (설계문서 §5):
--   question_category — 한글 3종 고정. 고객사마다 역량 체계가 다르므로
--                       0004_competency_model.sql 의 competencies 테이블로 대체
--   exam_grade        — NIA 고유(green/blue/black). org_grade_scales 테이블로 대체

-- ---------------------------------------------------------------------------
-- 확장
-- ---------------------------------------------------------------------------
create schema if not exists extensions;

-- gen_random_uuid() 는 PG13+ 코어 제공이라 pgcrypto 없이도 동작하지만,
-- 암호화 헬퍼(digest/hmac)를 초대 토큰 등에서 쓰게 되므로 미리 켜 둡니다.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 테넌시 / RBAC 타입
-- ---------------------------------------------------------------------------

-- app_role
--   원본: ('admin','examiner','applicant','viewer') — 조직 개념 없음.
--   'admin' 은 계승하지 않습니다. 'org_admin' 과 의미가 100% 겹쳐서
--   "정책은 org_admin 을 보는데 부여는 admin 으로 된" 권한 사각지대를 만듭니다.
--   전역 권한은 enum 값이 아니라 platform_admins 테이블로 분리됩니다(§3).
create type public.app_role as enum (
  'org_owner',   -- 결제·계약 주체. 조직당 최소 1명 유지(0003 트리거로 강제)
  'org_admin',   -- 조직 관리자. 원본 admin 의 조직 스코프판
  'examiner',    -- 출제·채점·감독
  'applicant',   -- 응시자
  'viewer'       -- 읽기 전용(인사팀 참관 등)
);

create type public.org_status as enum (
  'trial',
  'active',
  'suspended',   -- 미납/보안사고. 로그인은 되지만 쓰기 차단 대상
  'cancelled'
);

create type public.member_status as enum (
  'invited',     -- 초대 발송됨. user_org_ids() 에 포함되지 않음 = 권한 없음
  'active',
  'suspended'
);

-- ---------------------------------------------------------------------------
-- 과금 타입 (0009 에서 사용)
-- ---------------------------------------------------------------------------
create type public.sub_status as enum (
  'trialing',
  'active',
  'past_due',
  'cancelled'
);

create type public.usage_kind as enum (
  'exam_session',
  'ai_grading',
  'recording_gb'
);

-- ---------------------------------------------------------------------------
-- 문제은행 타입 (0005 에서 사용, 설계문서 §5)
-- ---------------------------------------------------------------------------
create type public.question_visibility as enum (
  'platform',    -- 플랫폼 공용. 구독 조직 전체 읽기 가능
  'licensed',    -- 특정 플랜/애드온 구매 조직만
  'org'          -- 소유 조직 전용
);

-- ---------------------------------------------------------------------------
-- 시험 도메인 타입 (0006~0008 에서 사용). 원본에서 그대로 계승
-- ---------------------------------------------------------------------------
create type public.exam_status as enum ('draft', 'open', 'closed');

create type public.session_status as enum (
  'waiting', 'in_progress', 'submitted', 'passed', 'failed'
);

create type public.question_difficulty as enum ('easy', 'medium', 'hard');

create type public.registration_mode as enum ('open', 'invite_only', 'hybrid');

create type public.monitoring_event_type as enum (
  'face_missing', 'multiple_faces', 'tab_switch', 'screen_share_off'
);

create type public.recording_diag_status as enum ('info', 'success', 'warn', 'error');

create type public.cert_status as enum ('valid', 'revoked');
