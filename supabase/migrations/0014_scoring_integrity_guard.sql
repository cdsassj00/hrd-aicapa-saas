-- 0014_scoring_integrity_guard.sql
-- P0: 응시자 자가 채점 차단 (평가 무결성).
--
-- exam_sessions 의 'session update self'(0007:444) 와 answers 의 'answer write self'(0007:458)
-- 정책은 응시자가 자기 행을 UPDATE 하도록 허용한다. RLS 는 컬럼 단위 제한을 못 하므로,
-- 응시자가 PostgREST 로 score/max_score/grade_level_id(및 answers 의 채점 결과 컬럼)를
-- 직접 써넣을 수 있었다. 0007 주석은 "점수·등급은 못 건드린다"고 했으나 실제 보호 장치가
-- 없었다 — 제품의 핵심 가치(평가 무결성)를 무너뜨리는 구멍.
--
-- BEFORE UPDATE 트리거로 "채점 결과" 컬럼의 변경을 채점 주체
-- (service_role · 조직 감독관 is_org_examiner · 플랫폼 운영자)로 제한한다.
-- 트리거 함수는 SECURITY INVOKER 여야 current_user 로 실제 호출 롤을 판별할 수 있다
-- (SECURITY DEFINER 면 소유자로 바뀌어 판별이 무의미해진다). is_org_examiner 는
-- 그 자체가 SECURITY DEFINER 라 여기서 호출해도 org_members RLS 재귀가 없다.

-- ── exam_sessions: score / max_score / grade_level_id 는 채점 결과 ──
create or replace function public.guard_exam_session_scoring()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.score          is distinct from old.score
     or new.max_score      is distinct from old.max_score
     or new.grade_level_id is distinct from old.grade_level_id
  then
    if current_user not in ('service_role', 'supabase_admin', 'postgres')
       and not (public.is_org_examiner(old.org_id) or public.is_platform_admin())
    then
      raise exception '점수·등급은 채점자만 수정할 수 있습니다.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_exam_session_scoring() from public, anon;

create trigger exam_sessions_scoring_guard
  before update on public.exam_sessions
  for each row execute function public.guard_exam_session_scoring();

-- ── answers: score / slot_scores / feedback / graded_at / graded_by 는 채점 결과 ──
create or replace function public.guard_answer_scoring()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.score       is distinct from old.score
     or new.slot_scores is distinct from old.slot_scores
     or new.feedback    is distinct from old.feedback
     or new.graded_at   is distinct from old.graded_at
     or new.graded_by   is distinct from old.graded_by
  then
    if current_user not in ('service_role', 'supabase_admin', 'postgres')
       and not (public.is_org_examiner(old.org_id) or public.is_platform_admin())
    then
      raise exception '채점 결과(점수·피드백)는 채점자만 수정할 수 있습니다.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_answer_scoring() from public, anon;

create trigger answers_scoring_guard
  before update on public.answers
  for each row execute function public.guard_answer_scoring();
