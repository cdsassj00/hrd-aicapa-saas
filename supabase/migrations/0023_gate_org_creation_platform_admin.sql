-- 0023_gate_org_creation_platform_admin.sql
-- 조직 생성을 플랫폼 운영자로 제한한다.
--
-- 배경: 지금까지는 인증된 사용자면 누구나 create_organization() 으로 조직을
-- 만들고 스스로 org_owner(관리자)가 됐다. 요금제(빌링)는 아직 신청 중이라
-- 구독은 열지 않고, 실제 접근은 "크레딧 구매 또는 도입 문의 → 운영자 승인"
-- 모델로 간다. 따라서 자가 조직 생성을 막고, 운영자만 조직을 프로비저닝한다.
-- (승인된 고객은 운영자가 조직을 만들어 org_owner 로 초대한다.)

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

  -- 자가 조직 생성 차단: 운영자만 프로비저닝한다(도입 문의 → 승인 모델).
  if not public.is_platform_admin() then
    raise exception '조직 생성 권한이 없습니다. 도입 문의로 신청해 주세요.'
      using errcode = 'insufficient_privilege';
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
  '조직 + 소유자 멤버십 + 브랜딩 행을 원자적으로 생성. 플랫폼 운영자 전용(자가 가입 차단).';
