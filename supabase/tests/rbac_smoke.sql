-- rbac_smoke.sql — 조직 스코프 RLS 동작 검증
--
-- "정책을 썼다"와 "정책이 막는다"는 다릅니다. 0003 의 핵심 주장 몇 개를
-- 실제 두 테넌트를 만들어 확인합니다. 전부 롤백되므로 DB 상태는 변하지 않습니다.
--
-- 실행: scripts/db-test.sh   (또는 psql -v ON_ERROR_STOP=1 -f 이 파일)

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 픽스처: 조직 2개 + 사용자 4명
-- ---------------------------------------------------------------------------
create or replace function pg_temp.assert(_cond boolean, _msg text)
returns void language plpgsql as $$
begin
  if not _cond then
    raise exception 'RBAC 검증 실패: %', _msg;
  end if;
end $$;

insert into auth.users (id, email, instance_id, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@acme.test',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'admin-a@acme.test',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'owner-b@beta.test',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'ops@platform.test',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

insert into public.organizations (id, slug, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'acme', '에이스엠 주식회사'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'beta', '베타 주식회사');

insert into public.org_branding (org_id, primary_color) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '#112233');

insert into public.org_members (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'org_owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'org_admin'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'org_owner');

insert into public.platform_admins (user_id) values
  ('44444444-4444-4444-4444-444444444444');

-- ---------------------------------------------------------------------------
-- 1. 테넌트 격리 — A조직 소유자는 B조직을 볼 수 없다
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select pg_temp.assert(
  (select count(*) from public.organizations) = 1,
  'A조직 소유자에게 조직이 1개만 보여야 함');

select pg_temp.assert(
  (select array_length(public.user_org_ids(), 1)) = 1,
  'user_org_ids() 가 1개를 반환해야 함');

select pg_temp.assert(
  public.is_org_admin('aaaaaaaa-0000-0000-0000-000000000001'),
  'org_owner 는 is_org_admin 을 만족해야 함');

select pg_temp.assert(
  not public.is_org_admin('bbbbbbbb-0000-0000-0000-000000000002'),
  '남의 조직에서는 관리자가 아니어야 함');

select pg_temp.assert(
  not public.is_platform_admin(),
  '일반 사용자는 플랫폼 운영자가 아니어야 함');

-- 남의 조직에 멤버를 밀어 넣을 수 없다
do $$
begin
  insert into public.org_members (org_id, user_id, role)
  values ('bbbbbbbb-0000-0000-0000-000000000002',
          '11111111-1111-1111-1111-111111111111', 'org_admin');
  raise exception 'RBAC 검증 실패: 타 조직에 멤버 추가가 허용됨';
exception
  when insufficient_privilege then null;   -- RLS 위반 = 기대 동작
end $$;

-- 남의 조직 이름을 바꿀 수 없다 (RLS 는 UPDATE 를 0행으로 만든다)
with u as (
  update public.organizations set name = '탈취됨'
  where id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1
)
select pg_temp.assert((select count(*) from u) = 0, '타 조직 UPDATE 가 통과됨');

-- ---------------------------------------------------------------------------
-- 2. 권한 상승 차단 — org_admin 은 스스로를 org_owner 로 올릴 수 없다
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select pg_temp.assert(
  public.is_org_admin('aaaaaaaa-0000-0000-0000-000000000001'),
  'org_admin 은 관리자여야 함');

do $$
begin
  insert into public.org_members (org_id, user_id, role)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222', 'org_owner');
  raise exception 'RBAC 검증 실패: org_admin 이 자신을 org_owner 로 승격함';
exception
  when insufficient_privilege then null;
end $$;

-- 같은 조직의 일반 역할 부여는 가능해야 한다
insert into public.org_members (org_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'examiner');

-- ---------------------------------------------------------------------------
-- 3. 마지막 org_owner 보호
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  delete from public.org_members
  where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and user_id = '11111111-1111-1111-1111-111111111111'
    and role = 'org_owner';
  raise exception 'RBAC 검증 실패: 마지막 org_owner 가 제거됨';
exception
  when restrict_violation then null;   -- 트리거가 막음 = 기대 동작
end $$;

-- ---------------------------------------------------------------------------
-- 4. 브랜딩은 익명 읽기 허용 (로그인 화면), 쓰기는 관리자만
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '';

select pg_temp.assert(
  (select count(*) from public.org_branding) = 1,
  '익명 사용자가 브랜딩을 읽을 수 있어야 함');

-- 조직 목록은 익명에게 GRANT 자체가 없다(1차 차단). 정책까지 갔더라도 0행.
do $$
declare _n int;
begin
  select count(*) into _n from public.organizations;
  if _n > 0 then
    raise exception 'RBAC 검증 실패: 익명 사용자에게 조직이 보임 (%건)', _n;
  end if;
exception
  when insufficient_privilege then null;   -- GRANT 단계에서 차단 = 기대 동작
end $$;

do $$
begin
  update public.org_branding set primary_color = '#000000';
  if found then
    raise exception 'RBAC 검증 실패: 익명 사용자가 브랜딩을 수정함';
  end if;
exception
  when insufficient_privilege then null;   -- GRANT 단계에서 차단 = 기대 동작
end $$;

-- SECURITY DEFINER 헬퍼는 미인증자에게 열려 있으면 안 된다
do $$
begin
  perform public.user_org_ids();
  raise exception 'RBAC 검증 실패: 익명 사용자가 user_org_ids() 를 호출함';
exception
  when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. 플랫폼 운영자는 전 조직을 본다
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select pg_temp.assert(public.is_platform_admin(), '플랫폼 운영자 판정 실패');

select pg_temp.assert(
  (select count(*) from public.organizations) = 2,
  '플랫폼 운영자에게 전 조직이 보여야 함');

-- ---------------------------------------------------------------------------
-- 6. create_organization() — 조직 + 소유자 + 브랜딩 원자적 생성
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select public.create_organization('gamma', '감마 주식회사');

select pg_temp.assert(
  (select count(*) from public.organizations) = 2,
  'create_organization 후 소속 조직이 2개여야 함');

select pg_temp.assert(
  public.has_org_role(
    (select id from public.organizations where slug = 'gamma'), 'org_owner'),
  '생성자가 org_owner 여야 함');

-- ---------------------------------------------------------------------------
-- 7. 초대 플로우 (0004)
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, instance_id, aud, role)
values ('55555555-5555-5555-5555-555555555555', 'newbie@acme.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- 가입 트리거가 프로필을 만들었는지
select pg_temp.assert(
  exists (select 1 from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
  'handle_new_user 트리거가 프로필을 생성해야 함');

-- 남의 조직에 초대할 수 없다
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
do $$
begin
  perform public.create_org_invitation(
    'aaaaaaaa-0000-0000-0000-000000000001', 'newbie@acme.test', 'examiner');
  raise exception 'RBAC 검증 실패: 타 조직에 초대가 허용됨';
exception
  when insufficient_privilege then null;
end $$;

-- org_owner 는 초대로 부여할 수 없다
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
begin
  perform public.create_org_invitation(
    'aaaaaaaa-0000-0000-0000-000000000001', 'newbie@acme.test', 'org_owner');
  raise exception 'RBAC 검증 실패: 초대로 org_owner 부여됨';
exception
  when insufficient_privilege then null;
end $$;

-- 정상 초대 발급
create temp table _tok as
select public.create_org_invitation(
  'aaaaaaaa-0000-0000-0000-000000000001', 'newbie@acme.test', 'examiner') as token;

select pg_temp.assert(
  (select length(token) from _tok) = 64,
  '토큰은 32바이트 hex(64자)여야 함');

-- 원문 토큰이 DB 에 저장되면 안 된다
select pg_temp.assert(
  not exists (select 1 from public.org_invitations i, _tok t where i.token_hash = t.token),
  '원문 토큰이 그대로 저장됨 — 해시만 저장해야 함');

-- 엉뚱한 계정으로는 수락 불가 (토큰이 새어도 이메일이 다르면 막힌다)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$
declare _t text;
begin
  select token into _t from _tok;
  perform public.accept_org_invitation(_t);
  raise exception 'RBAC 검증 실패: 수신자가 아닌 계정이 초대를 수락함';
exception
  when insufficient_privilege then null;
end $$;

-- 수신자 본인은 수락 가능
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
do $$
declare _t text; _org uuid;
begin
  select token into _t from _tok;
  _org := public.accept_org_invitation(_t);
  if _org <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'RBAC 검증 실패: 수락 결과 org_id 불일치';
  end if;
end $$;

select pg_temp.assert(
  public.has_org_role('aaaaaaaa-0000-0000-0000-000000000001', 'examiner'),
  '수락 후 examiner 역할이 있어야 함');

-- 같은 토큰 재사용 불가
do $$
declare _t text;
begin
  select token into _t from _tok;
  perform public.accept_org_invitation(_t);
  raise exception 'RBAC 검증 실패: 토큰이 재사용됨';
exception
  when invalid_parameter_value then null;
end $$;

-- 초대 목록은 조직 관리자만 (수락한 일반 멤버에게는 안 보인다)
select pg_temp.assert(
  (select count(*) from public.org_invitations) = 0,
  '일반 멤버에게 초대 목록이 보이면 안 됨');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.assert(
  (select count(*) from public.org_invitations) >= 1,
  '조직 관리자에게는 초대 목록이 보여야 함');

-- 같은 조직 멤버의 프로필은 보이고, 남의 조직 사람은 안 보인다
select pg_temp.assert(
  exists (select 1 from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
  '같은 조직 멤버 프로필이 보여야 함');
select pg_temp.assert(
  not exists (select 1 from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  '다른 조직 사용자 프로필이 보이면 안 됨');

-- ---------------------------------------------------------------------------
-- 8. 역량 체계 (0005)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 플랫폼 기본 체계는 모든 조직에 보여야 한다.
-- org_id = any(user_org_ids()) 는 NULL 에 false 라서, IS NULL 을 빠뜨리면
-- 기본 체계가 아무에게도 안 보인다.
select pg_temp.assert(
  exists (select 1 from public.competency_frameworks where org_id is null and code = 'ai-utilization'),
  '플랫폼 기본 역량 체계가 보여야 함');
select pg_temp.assert(
  (select count(*) from public.competencies where org_id is null) = 9,
  '기본 역량 9개가 보여야 함');
select pg_temp.assert(
  (select count(*) from public.grade_levels where org_id is null) = 4,
  '기본 등급 4단계가 보여야 함');

-- 조직 관리자는 플랫폼 기본을 고칠 수 없다(전 고객사에 영향 가는 경로)
with u as (
  update public.competency_frameworks set name = '탈취됨' where org_id is null returning 1
)
select pg_temp.assert((select count(*) from u) = 0, '플랫폼 기본 체계가 조직 관리자에게 수정됨');

-- 복제: 플랫폼 기본 → 조직 전용. 계층이 보존돼야 한다.
create temp table _fw as
select public.clone_framework_to_org(
  (select id from public.competency_frameworks where org_id is null and code = 'ai-utilization'),
  'aaaaaaaa-0000-0000-0000-000000000001', 'acme-model', '에이스엠 직무역량') as id;

select pg_temp.assert(
  (select count(*) from public.competencies c, _fw where c.framework_id = _fw.id) = 9,
  '복제본 역량 9개');
select pg_temp.assert(
  (select count(*) from public.competencies c, _fw
    where c.framework_id = _fw.id and c.parent_id is not null) = 6,
  '복제본에서 계층(부모 연결) 6개가 보존돼야 함');
select pg_temp.assert(
  (select bool_and(c.org_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     from public.competencies c, _fw where c.framework_id = _fw.id),
  '복제본 역량의 org_id 가 트리거로 상속돼야 함');

-- 다른 조직에는 복제본이 보이지 않는다
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select pg_temp.assert(
  not exists (select 1 from public.competency_frameworks where code = 'acme-model'),
  '타 조직의 역량 체계가 보이면 안 됨');
select pg_temp.assert(
  exists (select 1 from public.competency_frameworks where org_id is null),
  '플랫폼 기본은 타 조직에도 보여야 함');

-- 남의 조직으로는 복제할 수 없다
do $$
begin
  perform public.clone_framework_to_org(
    (select id from public.competency_frameworks where org_id is null limit 1),
    'aaaaaaaa-0000-0000-0000-000000000001', 'steal', '탈취');
  raise exception 'RBAC 검증 실패: 남의 조직으로 복제가 허용됨';
exception
  when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- 9. 문제은행 소유권·라이선스 (0006)
-- ---------------------------------------------------------------------------
reset role;
-- 플랫폼 문항 3종: 공용 / 라이선스 / (조직 문항은 아래에서 A조직이 만든다)
insert into public.questions (id, org_id, visibility, type, content, answer_key) values
  ('cc000000-0000-0000-0000-000000000001', null, 'platform', 'multiple_choice',
   '공용 문항', '{"options":[{"id":"a","text":"보기1","is_correct":true},{"id":"b","text":"보기2","is_correct":false}]}'),
  ('cc000000-0000-0000-0000-000000000002', null, 'licensed', 'essay', '프리미엄 문항', '{}');

insert into public.question_sets (id, org_id, visibility, code, name)
values ('dd000000-0000-0000-0000-000000000001', null, 'licensed', 'premium-1', '프리미엄 세트');
insert into public.question_set_items (set_id, question_id)
values ('dd000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 공용은 보이고, 라이선스 없는 프리미엄은 안 보인다
select pg_temp.assert(
  exists (select 1 from public.questions where visibility = 'platform'),
  '플랫폼 공용 문항이 보여야 함');
select pg_temp.assert(
  not exists (select 1 from public.questions where visibility = 'licensed'),
  '라이선스 없이 프리미엄 문항이 보이면 안 됨');

-- 조직이 스스로 라이선스를 부여할 수 없어야 한다(유료 콘텐츠가 공짜가 되는 경로)
do $$
begin
  insert into public.question_licenses (org_id, set_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001');
  raise exception 'RBAC 검증 실패: 조직이 스스로 라이선스를 부여함';
exception
  when insufficient_privilege then null;
end $$;

-- 플랫폼 문항을 조직 관리자가 고칠 수 없다(전 고객사 진단이 바뀌는 경로)
with u as (
  update public.questions set content = '변조됨' where visibility = 'platform' returning 1
)
select pg_temp.assert((select count(*) from u) = 0, '플랫폼 문항이 조직 관리자에게 수정됨');

-- 소유와 공개 범위가 어긋난 문항은 만들 수 없다
do $$
begin
  insert into public.questions (org_id, visibility, type, content)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'platform', 'essay', '유출 시도');
  raise exception 'RBAC 검증 실패: 조직 소유인데 platform 공개인 문항이 생성됨';
exception
  when check_violation then null;
end $$;

-- 조직 문항 생성
insert into public.questions (id, org_id, visibility, type, content, answer_key)
values ('cc000000-0000-0000-0000-000000000003',
        'aaaaaaaa-0000-0000-0000-000000000001', 'org', 'multiple_choice', 'A사 문항',
        '{"options":[{"id":"a","text":"정답","is_correct":true}]}');

-- 응시자용 뷰에는 정답이 없어야 한다. 이게 새면 시험 자체가 무의미해진다.
select pg_temp.assert(
  (select prompt_data::text not like '%is_correct%'
     from public.questions_public where id = 'cc000000-0000-0000-0000-000000000003'),
  'questions_public 에 is_correct 가 노출됨');
select pg_temp.assert(
  (select prompt_data->'options'->0->>'text' = '정답'
     from public.questions_public where id = 'cc000000-0000-0000-0000-000000000003'),
  '보기 텍스트는 응시자에게 내려가야 함');

-- 라이선스를 부여하면(플랫폼 운영자만 가능) 프리미엄이 보인다
reset role;
insert into public.question_licenses (org_id, set_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.assert(
  exists (select 1 from public.questions where visibility = 'licensed'),
  '라이선스 부여 후 프리미엄 문항이 보여야 함');

-- 만료된 라이선스는 즉시 차단된다
reset role;
update public.question_licenses set expires_at = now() - interval '1 day'
 where org_id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.assert(
  not exists (select 1 from public.questions where visibility = 'licensed'),
  '만료된 라이선스로 프리미엄 문항이 보임');

-- 다른 조직에는 A사 문항이 보이지 않는다
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select pg_temp.assert(
  not exists (select 1 from public.questions where content = 'A사 문항'),
  '타 조직 문항이 보이면 안 됨');
select pg_temp.assert(
  exists (select 1 from public.questions where visibility = 'platform'),
  '플랫폼 공용은 타 조직에도 보여야 함');

-- ---------------------------------------------------------------------------
-- 10. 시험 도메인 (0007)
-- ---------------------------------------------------------------------------
reset role;
-- A조직 응시자 한 명 추가
insert into auth.users (id, email, instance_id, aud, role) values
  ('66666666-6666-6666-6666-666666666666','taker@acme.test',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.org_members (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','66666666-6666-6666-6666-666666666666','applicant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- INSERT 는 서브쿼리에 못 들어간다. 데이터 수정 CTE 로.
create temp table _ex as
with ins as (
  insert into public.exams (org_id, title, status, duration_minutes)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '2026 상반기 AI 역량진단', 'open', 60)
  returning id
)
select id from ins;

-- 남의 조직 역량 체계는 못 쓴다
do $$
declare _fw uuid;
begin
  -- B조직 전용 체계를 만들려면 B조직 관리자여야 하므로, 여기서는 A가
  -- 자기 회차에 '플랫폼 기본'을 붙이는 것은 되는지만 본다(허용돼야 함).
  select id into _fw from public.competency_frameworks where org_id is null limit 1;
  update public.exams set framework_id = _fw where id = (select id from _ex);
end $$;

-- 출제: 플랫폼 공용 문항은 넣을 수 있다
insert into public.exam_questions (exam_id, question_id)
select (select id from _ex), 'cc000000-0000-0000-0000-000000000001';

-- 라이선스 없는 프리미엄 문항은 출제 불가 (RLS 가 아니라 트리거가 막는다 —
-- INSERT 로 남의 문항 id 를 직접 박는 경로)
do $$
begin
  insert into public.exam_questions (exam_id, question_id)
  select (select id from _ex), 'cc000000-0000-0000-0000-000000000002';
  raise exception 'RBAC 검증 실패: 라이선스 없는 문항이 출제됨';
exception
  when insufficient_privilege then null;
end $$;

-- org_id 는 트리거가 덮어쓴다. 앱이 남의 org_id 를 박아도 무시돼야 한다.
insert into public.exam_sessions (id, exam_id, org_id, user_id, status)
values ('ee000000-0000-0000-0000-000000000001', (select id from _ex),
        'bbbbbbbb-0000-0000-0000-000000000002',  -- 일부러 B조직으로 박음
        '66666666-6666-6666-6666-666666666666', 'in_progress');

select pg_temp.assert(
  (select org_id from public.exam_sessions where id = 'ee000000-0000-0000-0000-000000000001')
    = 'aaaaaaaa-0000-0000-0000-000000000001',
  'org_id 비정규화가 트리거로 강제돼야 함 (앱이 박은 값 무시)');

-- 응시자 시점
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

-- 회차는 보이지만 출제 내용(exam_questions)은 보이면 안 된다.
-- 보이면 시험 전에 문제를 다 볼 수 있다.
select pg_temp.assert(
  exists (select 1 from public.exams where status = 'open'),
  '응시자에게 공개된 회차가 보여야 함');
select pg_temp.assert(
  (select count(*) from public.exam_questions) = 0,
  '응시자에게 출제 목록이 보이면 안 됨');

-- 본인 세션은 보이고 답안을 쓸 수 있다
select pg_temp.assert(
  (select count(*) from public.exam_sessions) = 1, '본인 세션이 보여야 함');

insert into public.answers (session_id, question_id, content)
values ('ee000000-0000-0000-0000-000000000001',
        'cc000000-0000-0000-0000-000000000001', '{"choice":"a"}');

select pg_temp.assert(
  (select org_id from public.answers where session_id = 'ee000000-0000-0000-0000-000000000001')
    = 'aaaaaaaa-0000-0000-0000-000000000001',
  '답안 org_id 가 세션에서 상속돼야 함');

-- 응시자는 자기 세션의 점수·등급을 조작할 수 없다 (0014 트리거가 막는다)
do $$
begin
  update public.exam_sessions set score = 100
   where id = 'ee000000-0000-0000-0000-000000000001';
  raise exception 'RBAC 검증 실패: 응시자가 자기 점수를 조작함';
exception
  when check_violation then null;   -- 트리거가 막음 = 기대 동작
end $$;

-- 응시자는 자기 답안의 채점 결과(점수)를 조작할 수 없다
do $$
begin
  update public.answers set score = 100
   where session_id = 'ee000000-0000-0000-0000-000000000001';
  raise exception 'RBAC 검증 실패: 응시자가 자기 답안 점수를 조작함';
exception
  when check_violation then null;
end $$;

-- 그러나 상태 전이(제출)와 답안 내용 수정은 여전히 가능해야 한다
update public.exam_sessions set status = 'submitted', submitted_at = now()
 where id = 'ee000000-0000-0000-0000-000000000001';
select pg_temp.assert(
  (select status from public.exam_sessions where id = 'ee000000-0000-0000-0000-000000000001')
    = 'submitted',
  '응시자가 세션을 제출 상태로 바꿀 수 있어야 함');

-- 응시자는 채점 잡을 만들 수 없다
do $$
begin
  insert into public.grading_jobs (exam_id, org_id)
  select (select id from _ex), 'aaaaaaaa-0000-0000-0000-000000000001';
  raise exception 'RBAC 검증 실패: 응시자가 채점 잡을 생성함';
exception
  when insufficient_privilege then null;
end $$;

-- 감독관(스태프)은 채점 결과를 매길 수 있다 (0014 트리거가 채점 주체는 통과시킨다)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.exam_sessions set score = 88, max_score = 100
 where id = 'ee000000-0000-0000-0000-000000000001';
select pg_temp.assert(
  (select score from public.exam_sessions where id = 'ee000000-0000-0000-0000-000000000001') = 88,
  '감독관은 점수를 매길 수 있어야 함');

-- 다른 조직 사람에게는 회차도 답안도 보이지 않는다
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.exams) = 0, '타 조직 회차가 보임');
select pg_temp.assert((select count(*) from public.answers) = 0, '타 조직 답안이 보임');
select pg_temp.assert((select count(*) from public.exam_sessions) = 0, '타 조직 세션이 보임');

-- draft 회차는 응시자에게 안 보인다
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.exams (org_id, title, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '작성 중 회차', 'draft');

set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
select pg_temp.assert(
  not exists (select 1 from public.exams where status = 'draft'),
  '작성 중(draft) 회차가 응시자에게 보이면 안 됨');

reset role;
select '✅ RBAC 스모크 테스트 통과' as result;

rollback;
