-- 0004_profiles_and_invitations.sql
-- 아이덴티티 계층 마무리: profiles + org_invitations
--
-- 설계문서 §7 의 원래 0004 는 competency_model 이었으나, 온보딩(착수 순서 3번)에
-- 이 둘이 먼저 필요해서 앞으로 당깁니다. 이후 번호는 하나씩 밀립니다(문서 갱신됨).
--
-- 왜 0002/0003 에 없었나:
--   profiles        — 원본에도 있던 테이블이라 도메인 이식(0006~)으로 미뤘는데,
--                     로그인 직후 앱이 바로 조회하므로 아이덴티티 계층에 속합니다.
--   org_invitations — org_members.status='invited' 로는 미가입자를 표현할 수 없습니다.
--                     auth.users 행이 아직 없기 때문입니다.

-- ===========================================================================
-- 1. profiles — 조직과 무관한 전역 사용자 프로필 (설계문서 §4)
-- ===========================================================================
-- 조직별 정보(부서·직급)는 여기가 아니라 org_members 로 갑니다.
-- 한 사람이 여러 조직에 속하면 부서·직급도 조직마다 다르기 때문입니다.
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  phone      text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_phone_format
    check (phone is null or phone ~ '^[0-9+\-]{9,20}$')
);

comment on table public.profiles is
  '전역 사용자 프로필. org_id 없음 — 조직별 정보는 org_members 에 둡니다(가드 예외 등록됨)';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 조직 스코프 부가 정보를 멤버십 쪽에 붙입니다
alter table public.org_members
  add column display_name text,   -- 조직 내 표기명(사번 체계가 다른 경우)
  add column department   text,
  add column position     text,
  add column employee_no  text;

comment on column public.org_members.department is
  '조직별 부서. profiles 가 아니라 여기 있는 이유는 한 사람이 여러 조직에 속할 수 있어서';

-- 가입 시 프로필 자동 생성.
-- 앱이 직접 insert 하게 두면 "프로필 없는 사용자"가 반드시 생깁니다
-- (가입 직후 이탈, 네트워크 실패 등). DB 에서 보장합니다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- 2. org_invitations — 미가입자 이메일 초대
-- ===========================================================================
-- 토큰 원문은 저장하지 않습니다. DB 가 유출돼도 초대 링크를 재구성할 수 없어야
-- 합니다. 원문은 생성 시 1회만 반환되고 메일로만 전달됩니다.
create table public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  role        public.app_role not null,
  token_hash  text not null unique,
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint org_invitations_email_format
    check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),

  -- org_owner 는 초대로 부여하지 않습니다. 결제·계약 주체라
  -- 기존 소유자가 명시적으로 넘겨야 합니다.
  constraint org_invitations_role_not_owner
    check (role <> 'org_owner')
);

comment on table public.org_invitations is
  '미가입자 초대. org_members.status=invited 로는 auth.users 행이 없어 표현 불가';
comment on column public.org_invitations.token_hash is
  'sha256(원문). 원문은 저장하지 않으며 생성 시 1회만 반환됩니다';

-- 같은 조직·같은 이메일로 살아있는 초대는 하나만
create unique index org_invitations_pending_uniq
  on public.org_invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

create index org_invitations_org_idx on public.org_invitations (org_id, created_at desc);

alter table public.profiles         enable row level security;
alter table public.org_invitations  enable row level security;

grant select, insert, update on public.profiles          to authenticated;
grant select on public.org_invitations                   to authenticated;
grant all    on public.profiles, public.org_invitations  to service_role;

-- ===========================================================================
-- 3. RLS 정책
-- ===========================================================================

-- --- profiles ---------------------------------------------------------------
-- 같은 조직 사람의 프로필은 보여야 합니다(멤버 목록·감독 대시보드).
-- 조직이 겹치지 않는 사용자끼리는 서로 보이지 않습니다.
create policy "profile read self or same org" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1 from public.org_members m
      where m.user_id = profiles.id
        and m.status = 'active'
        and m.org_id = any (public.user_org_ids())
    )
  );

-- 본인만. 트리거가 이미 만들어 주지만 자기 치유용으로 남겨 둡니다.
create policy "profile insert self" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy "profile update self" on public.profiles
  for update to authenticated
  using      (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

-- --- org_invitations ---------------------------------------------------------
-- 조직 관리자만 봅니다. 초대받은 사람은 이 테이블을 읽지 않고
-- accept_org_invitation(token) 으로만 접근합니다.
create policy "invitation read by admin" on public.org_invitations
  for select to authenticated
  using (public.is_org_admin(org_id) or public.is_platform_admin());

-- INSERT/UPDATE 정책 없음 — 아래 함수 두 개만 통로.
-- 토큰 해시를 앱이 직접 쓰게 두면 원문 관리 규칙이 무너집니다.

-- ===========================================================================
-- 4. 초대 함수
-- ===========================================================================

-- 초대 생성. 원문 토큰을 반환하며, 이 값은 이 호출에서만 얻을 수 있습니다.
create or replace function public.create_org_invitation(
  _org_id uuid,
  _email  text,
  _role   public.app_role
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp, extensions
as $$
declare
  _token text;
  _email_norm text := lower(btrim(_email));
begin
  if not (public.is_org_admin(_org_id) or public.is_platform_admin()) then
    raise exception '조직 관리자만 초대할 수 있습니다' using errcode = 'insufficient_privilege';
  end if;

  if _role = 'org_owner' then
    raise exception 'org_owner 는 초대로 부여할 수 없습니다. 소유권 이전을 사용하세요'
      using errcode = 'insufficient_privilege';
  end if;

  -- 살아있는 초대가 있으면 새로 발급하지 않고 회수 후 재발급
  update public.org_invitations
     set revoked_at = now()
   where org_id = _org_id and email = _email_norm
     and accepted_at is null and revoked_at is null;

  _token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.org_invitations (org_id, email, role, token_hash, invited_by)
  values (
    _org_id, _email_norm, _role,
    encode(extensions.digest(_token, 'sha256'), 'hex'),
    auth.uid()
  );

  return _token;
end $$;

comment on function public.create_org_invitation(uuid, text, public.app_role) is
  '초대 생성 후 원문 토큰 1회 반환. 저장되는 것은 sha256 해시뿐';

-- 초대 수락. 로그인한 사용자가 자기 토큰으로 호출합니다.
create or replace function public.accept_org_invitation(_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp, extensions
as $$
declare
  _uid  uuid := auth.uid();
  _mail text;
  _inv  public.org_invitations;
begin
  if _uid is null then
    raise exception '인증이 필요합니다' using errcode = 'insufficient_privilege';
  end if;

  select lower(email) into _mail from auth.users where id = _uid;

  select * into _inv
  from public.org_invitations
  where token_hash = encode(extensions.digest(_token, 'sha256'), 'hex')
  for update;

  if _inv.id is null then
    raise exception '유효하지 않은 초대입니다' using errcode = 'invalid_parameter_value';
  end if;
  if _inv.accepted_at is not null then
    raise exception '이미 사용된 초대입니다' using errcode = 'invalid_parameter_value';
  end if;
  if _inv.revoked_at is not null then
    raise exception '취소된 초대입니다' using errcode = 'invalid_parameter_value';
  end if;
  if _inv.expires_at < now() then
    raise exception '만료된 초대입니다' using errcode = 'invalid_parameter_value';
  end if;

  -- 초대장은 특정 이메일 앞으로 발행됩니다. 토큰이 새어도
  -- 다른 계정으로는 쓸 수 없어야 합니다.
  if _inv.email <> _mail then
    raise exception '이 초대는 % 앞으로 발행되었습니다', _inv.email
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.org_members (org_id, user_id, role, status, invited_by)
  values (_inv.org_id, _uid, _inv.role, 'active', _inv.invited_by)
  on conflict (org_id, user_id, role)
    do update set status = 'active';

  update public.org_invitations
     set accepted_at = now(), accepted_by = _uid
   where id = _inv.id;

  return _inv.org_id;
end $$;

comment on function public.accept_org_invitation(text) is
  '초대 수락 → org_members 등록. 토큰 소유 + 이메일 일치 둘 다 요구';

-- 초대 취소
create or replace function public.revoke_org_invitation(_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _org uuid;
begin
  select org_id into _org from public.org_invitations where id = _invitation_id;
  if _org is null then
    raise exception '초대를 찾을 수 없습니다' using errcode = 'invalid_parameter_value';
  end if;
  if not (public.is_org_admin(_org) or public.is_platform_admin()) then
    raise exception '조직 관리자만 취소할 수 있습니다' using errcode = 'insufficient_privilege';
  end if;

  update public.org_invitations
     set revoked_at = now()
   where id = _invitation_id and accepted_at is null and revoked_at is null;
end $$;

revoke all on function public.create_org_invitation(uuid, text, public.app_role) from public, anon;
revoke all on function public.accept_org_invitation(text)                        from public, anon;
revoke all on function public.revoke_org_invitation(uuid)                        from public, anon;

grant execute on function public.create_org_invitation(uuid, text, public.app_role) to authenticated, service_role;
grant execute on function public.accept_org_invitation(text)                        to authenticated, service_role;
grant execute on function public.revoke_org_invitation(uuid)                        to authenticated, service_role;
