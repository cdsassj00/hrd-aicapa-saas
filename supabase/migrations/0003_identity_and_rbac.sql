-- 0003_identity_and_rbac.sql
-- 조직 스코프 RBAC 기반 함수 + 테넌시 코어 4개 테이블의 RLS 정책
-- (설계문서 §6.1, §6.2)
--
-- 원본 has_role(_user_id, _role) 의 후계입니다. 원본은 조직 개념이 없어
-- admin 이면 전 세계 admin 이었습니다. 여기서 그 전제를 끊습니다.
--
-- 세 함수 모두 SECURITY DEFINER 여야 합니다(§6.3). 아니면 정책 평가 중에
-- org_members 의 RLS 를 다시 타면서 무한 재귀합니다.
--
-- 정책 배치 원칙: 도메인 테이블(exams, answers, ...) 정책은 전부
-- 0011_rls_policies.sql 한 파일에 모읍니다. 여기 있는 것은 함수 자신이
-- 의존하는 아이덴티티 계층 4개 테이블뿐이며, 이건 0011 로 옮기면
-- "함수는 있는데 멤버십을 못 읽어서 부팅이 안 되는" 순환이 생깁니다.

-- ===========================================================================
-- 1. 기반 함수
-- ===========================================================================

-- 사용자가 속한 조직 목록. 정책에서 `org_id = any(public.user_org_ids())` 형태로 사용
create or replace function public.user_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct org_id), '{}'::uuid[])
  from public.org_members
  where user_id = auth.uid()
    and status = 'active'
$$;

comment on function public.user_org_ids() is
  '현재 사용자의 활성 소속 조직. SECURITY DEFINER 필수 — org_members RLS 재귀 방지(§6.3)';

-- 조직 스코프 역할 검사 — 원본 has_role 의 직계 후계
create or replace function public.has_org_role(_org_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and org_id  = _org_id
      and role    = _role
      and status  = 'active'
  )
$$;

comment on function public.has_org_role(uuid, public.app_role) is
  '지정 조직에서 지정 역할을 활성 보유하는지. 원본 has_role(_user_id,_role) 대체';

-- 플랫폼 운영자(당사). 조직 경계 밖의 전역 권한
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  )
$$;

comment on function public.is_platform_admin() is
  '전역 운영자 여부. 조직 스코프를 우회하는 유일한 통로';

-- ---------------------------------------------------------------------------
-- 파생 헬퍼 — 정책에서 반복되는 OR 조합을 한 번만 정의
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid() and org_id = _org_id and status = 'active'
  )
$$;

-- org_owner 는 org_admin 의 모든 권한을 포함합니다.
-- 정책에서 has_org_role(org_id,'org_admin') 만 쓰면 소유자가 잠기므로
-- 관리자 판정은 반드시 이 함수를 쓰세요.
create or replace function public.is_org_admin(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and org_id  = _org_id
      and role    in ('org_owner', 'org_admin')
      and status  = 'active'
  )
$$;

comment on function public.is_org_admin(uuid) is
  '조직 관리 권한(org_owner ⊇ org_admin). 관리자 판정은 항상 이 함수로';

-- ---------------------------------------------------------------------------
-- 실행 권한: PUBLIC 회수 후 필요한 롤에만 부여
-- ---------------------------------------------------------------------------
revoke all on function public.user_org_ids()                       from public;
revoke all on function public.has_org_role(uuid, public.app_role)  from public;
revoke all on function public.is_platform_admin()                  from public;
revoke all on function public.is_org_member(uuid)                  from public;
revoke all on function public.is_org_admin(uuid)                   from public;

grant execute on function public.user_org_ids()                      to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.is_platform_admin()                 to authenticated, service_role;
grant execute on function public.is_org_member(uuid)                 to authenticated, service_role;
grant execute on function public.is_org_admin(uuid)                  to authenticated, service_role;

-- ===========================================================================
-- 2. 멤버십 불변식
-- ===========================================================================

-- 조직에는 활성 org_owner 가 최소 1명 있어야 합니다.
-- 마지막 소유자가 사라지면 결제·계약 주체가 없는 좀비 조직이 됩니다.
create or replace function public.enforce_last_org_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _remaining int;
begin
  -- 조직 자체가 삭제되는 중이면(cascade) 검사하지 않음
  if not exists (select 1 from public.organizations where id = old.org_id) then
    return coalesce(new, old);
  end if;

  if old.role <> 'org_owner' or old.status <> 'active' then
    return coalesce(new, old);
  end if;

  -- UPDATE 로 여전히 활성 소유자로 남아 있으면 통과
  if tg_op = 'UPDATE'
     and new.role = 'org_owner' and new.status = 'active' and new.org_id = old.org_id then
    return new;
  end if;

  select count(*) into _remaining
  from public.org_members
  where org_id = old.org_id
    and role   = 'org_owner'
    and status = 'active'
    and user_id <> old.user_id;

  if _remaining = 0 then
    raise exception '조직 % 의 마지막 org_owner 는 제거할 수 없습니다. 먼저 다른 소유자를 지정하세요',
      old.org_id
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end $$;

create trigger org_members_last_owner_guard
  before update or delete on public.org_members
  for each row execute function public.enforce_last_org_owner();

-- ===========================================================================
-- 3. 조직 생성 부트스트랩
-- ===========================================================================
-- organizations 에는 INSERT 정책이 없습니다(아래 §4). 정책으로 열면
-- "조직은 만들었는데 멤버십은 안 만든" 고아 조직이 생길 수 있어서,
-- 조직 생성 + 소유자 등록을 한 트랜잭션으로 묶는 이 함수만 통로로 둡니다.
create or replace function public.create_organization(_slug text, _name text)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
  _org public.organizations;
begin
  if _uid is null then
    raise exception '인증이 필요합니다' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (slug, name)
  values (lower(btrim(_slug)), btrim(_name))
  returning * into _org;

  insert into public.org_members (org_id, user_id, role, status)
  values (_org.id, _uid, 'org_owner', 'active');

  insert into public.org_branding (org_id) values (_org.id);

  return _org;
end $$;

comment on function public.create_organization(text, text) is
  '조직 + 소유자 멤버십 + 브랜딩 행을 원자적으로 생성. 조직 생성의 유일한 통로';

revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated, service_role;

-- ===========================================================================
-- 4. 아이덴티티 계층 RLS 정책
-- ===========================================================================
-- 표준 템플릿(§6.2):
--   읽기  : org_id = any(public.user_org_ids()) or public.is_platform_admin()
--   쓰기  : public.is_org_admin(org_id)         or public.is_platform_admin()

-- --- organizations ---------------------------------------------------------
create policy "org read own" on public.organizations
  for select to authenticated
  using (id = any (public.user_org_ids()) or public.is_platform_admin());

create policy "org update by admin" on public.organizations
  for update to authenticated
  using      (public.is_org_admin(id) or public.is_platform_admin())
  with check (public.is_org_admin(id) or public.is_platform_admin());

create policy "org delete by platform admin" on public.organizations
  for delete to authenticated
  using (public.is_platform_admin());

-- INSERT 정책 없음 — public.create_organization() 경유만 허용

-- --- org_branding ----------------------------------------------------------
-- 로그인/응시 화면은 인증 전에 렌더링됩니다. 로고·색상·커스텀 도메인은
-- 그 화면에 그대로 노출되는 값이므로 익명 읽기를 허용합니다.
-- 비공개 설정을 여기 추가하지 마세요 — 추가할 값이 생기면 별도 테이블로 분리할 것.
create policy "branding read public" on public.org_branding
  for select to anon, authenticated
  using (true);

create policy "branding write by admin" on public.org_branding
  for insert to authenticated
  with check (public.is_org_admin(org_id) or public.is_platform_admin());

create policy "branding update by admin" on public.org_branding
  for update to authenticated
  using      (public.is_org_admin(org_id) or public.is_platform_admin())
  with check (public.is_org_admin(org_id) or public.is_platform_admin());

create policy "branding delete by admin" on public.org_branding
  for delete to authenticated
  using (public.is_org_admin(org_id) or public.is_platform_admin());

-- --- org_members -----------------------------------------------------------
-- 본인 멤버십은 항상 읽을 수 있어야 합니다(조직 전환 UI). 상태가 invited/suspended
-- 라 user_org_ids() 에 안 잡히는 경우가 있으므로 user_id 조건이 따로 필요합니다.
create policy "member read self or same org" on public.org_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or org_id = any (public.user_org_ids())
    or public.is_platform_admin()
  );

-- 역할 부여. org_owner 부여는 소유자(또는 플랫폼 운영자)만 —
-- org_admin 이 스스로를 소유자로 승격하는 경로를 막습니다.
create policy "member insert by admin" on public.org_members
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      public.is_org_admin(org_id)
      and (role <> 'org_owner' or public.has_org_role(org_id, 'org_owner'))
    )
  );

create policy "member update by admin" on public.org_members
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      public.is_org_admin(org_id)
      and (role <> 'org_owner' or public.has_org_role(org_id, 'org_owner'))
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.is_org_admin(org_id)
      and (role <> 'org_owner' or public.has_org_role(org_id, 'org_owner'))
    )
  );

-- 관리자에 의한 제명, 또는 본인 탈퇴. 마지막 소유자는 트리거가 막습니다.
create policy "member delete by admin or self" on public.org_members
  for delete to authenticated
  using (
    public.is_platform_admin()
    or user_id = auth.uid()
    or (
      public.is_org_admin(org_id)
      and (role <> 'org_owner' or public.has_org_role(org_id, 'org_owner'))
    )
  );

-- --- platform_admins -------------------------------------------------------
-- 읽기는 운영자끼리만. 쓰기 정책은 일부러 없습니다 — service_role/DB 콘솔 전용.
create policy "platform admin read" on public.platform_admins
  for select to authenticated
  using (public.is_platform_admin());
