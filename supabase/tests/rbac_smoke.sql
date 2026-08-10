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

reset role;
select '✅ RBAC 스모크 테스트 통과' as result;

rollback;
