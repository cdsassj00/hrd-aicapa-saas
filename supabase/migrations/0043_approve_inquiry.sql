-- 0043_approve_inquiry.sql
--
-- 플랫폼 운영자가 가입 승인요청을 "승인"하는 동작을 만든다.
--
-- 지금까지 /platform 의 승인은 문의 상태 라벨(신규/진행/완료)을 바꾸는 것뿐이었다.
-- 조직이 생기지 않고 요청자도 관리자가 되지 않아, 승인해도 요청자는 계속
-- "조직 없음 → 승인 요청" 화면에 머물렀다(E2E 로 확인). 실제 승인은 DB 를 손으로
-- 고쳐야 했다. create_organization 은 호출자(운영자)를 소유자로 넣으므로 승인에
-- 쓸 수 없다.
--
-- 승인 = 요청자의 회사명으로 조직을 만들고, 요청자를 그 조직의 소유자로 넣고,
-- 문의를 완료로 표시해 조직과 연결한다. 운영자만 호출할 수 있다.
-- 요청자 계정은 이메일로 찾는다(승인요청은 로그인한 상태에서 보낸다).

create or replace function public.approve_inquiry(_inquiry_id uuid, _org_name text default null)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _inq  public.inquiries;
  _uid  uuid;
  _name text;
  _org  public.organizations;
begin
  if not public.is_platform_admin() then
    raise exception '플랫폼 운영자만 승인할 수 있습니다' using errcode = 'insufficient_privilege';
  end if;

  select * into _inq from public.inquiries where id = _inquiry_id;
  if _inq.id is null then
    raise exception '문의를 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;
  if _inq.org_id is not null then
    raise exception '이미 조직이 개설된 요청입니다' using errcode = 'invalid_parameter_value';
  end if;

  select u.id into _uid from auth.users u where lower(u.email) = lower(btrim(_inq.email)) limit 1;
  if _uid is null then
    raise exception '이 이메일(%)로 가입된 계정이 없습니다. 먼저 회원가입하도록 안내해 주세요.', _inq.email
      using errcode = 'no_data_found';
  end if;

  _name := nullif(btrim(coalesce(_org_name, _inq.company, '')), '');
  if _name is null or _name = '(개인 가입자)' then
    raise exception '조직명(회사·기관명)이 필요합니다' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.organizations (slug, name)
  values ('org-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10), _name)
  returning * into _org;

  insert into public.org_members (org_id, user_id, role, status, display_name)
  values (_org.id, _uid, 'org_owner', 'active', nullif(btrim(coalesce(_inq.contact_name, '')), ''));

  insert into public.org_branding (org_id) values (_org.id) on conflict do nothing;

  update public.inquiries set status = '완료', org_id = _org.id where id = _inq.id;

  return _org;
end $$;

comment on function public.approve_inquiry(uuid, text) is
  '가입 승인: 요청자의 회사명으로 조직을 만들고 요청자를 소유자로 넣는다. 운영자 전용.';

revoke all on function public.approve_inquiry(uuid, text) from public, anon;
grant execute on function public.approve_inquiry(uuid, text) to authenticated;
