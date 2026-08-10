-- tenancy_guard.sql — 테넌트 경계 CI 가드 (설계문서 §6.4)
--
-- 공유 스키마 + org_id + RLS 방식의 전제는 딱 하나입니다:
--   "org_id 없는 테이블이 단 하나도 없을 것"
-- 그 전제가 깨지는 순간 그 테이블이 유출 경로가 됩니다. 사람이 기억할 수 있는
-- 종류의 규칙이 아니므로 CI 가 대신 기억합니다.
--
-- 위반이 하나라도 있으면 예외를 던져 프로세스를 실패시킵니다.
-- 실행: scripts/db-guard.sh  (또는 psql -v ON_ERROR_STOP=1 -f 이 파일)

do $guard$
declare
  _v         text[] := '{}';
  _r         record;
  _n         int;

  -- org_id 를 갖지 않아도 되는 테이블. 여기에 이름을 추가한다는 것은
  -- "이 테이블은 테넌트 경계 밖"이라고 보안 리뷰에서 선언하는 것과 같습니다.
  -- 사유 없이 추가하지 마세요.
  _exempt_org_id text[] := array[
    'organizations',    -- 테넌시 루트 그 자체 (id 가 org_id)
    'org_branding',     -- org_id 가 PK (형식상 통과하지만 명시)
    'platform_admins',  -- 조직 밖 전역 운영자
    'plans',            -- 플랫폼 공용 요금제 카탈로그
    'profiles',         -- 전역 사용자 프로필. 조직별 정보는 org_members
    'sms_otp_codes'     -- 인증 전 단계라 org 를 알 수 없음. TTL 정리 잡으로 관리
  ];

  -- RLS 를 켜지 않아도 되는 테이블. 원칙적으로 비어 있어야 합니다.
  _exempt_rls text[] := array[]::text[];

  -- 미인증(anon)에게 실행을 열어도 되는 SECURITY DEFINER 함수.
  -- 현재 없음 — 로그인 화면이 필요로 하는 건 org_branding 읽기뿐이고
  -- 그건 함수가 아니라 RLS 정책으로 처리합니다.
  _exempt_anon_exec text[] := array[]::text[];
begin
  ----------------------------------------------------------------------------
  -- 1. org_id 없는 public 테이블
  ----------------------------------------------------------------------------
  for _r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname <> all (_exempt_org_id)
      and not exists (
        select 1 from pg_depend d
        where d.objid = c.oid and d.deptype = 'e'      -- 확장 소유 테이블 제외
      )
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid
          and a.attname = 'org_id'
          and not a.attisdropped
      )
    order by 1
  loop
    _v := _v || format('[org_id 누락] public.%I — org_id 컬럼을 추가하거나 가드 예외 목록에 사유와 함께 등록하세요', _r.relname);
  end loop;

  ----------------------------------------------------------------------------
  -- 2. RLS 미적용 public 테이블
  ----------------------------------------------------------------------------
  for _r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
      and c.relname <> all (_exempt_rls)
      and not exists (
        select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'
      )
    order by 1
  loop
    _v := _v || format('[RLS 미적용] public.%I — alter table ... enable row level security', _r.relname);
  end loop;

  ----------------------------------------------------------------------------
  -- 3. org_id 컬럼의 타입/외래키 검증
  --    org_id 가 uuid 가 아니거나 organizations(id) 를 참조하지 않으면
  --    "있긴 한데 아무 값이나 들어가는" 무의미한 컬럼이 됩니다.
  ----------------------------------------------------------------------------
  for _r in
    select c.relname, format_type(a.atttypid, a.atttypmod) as coltype
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and a.atttypid <> 'uuid'::regtype
    order by 1
  loop
    _v := _v || format('[org_id 타입] public.%I.org_id 이 %s — uuid 여야 합니다', _r.relname, _r.coltype);
  end loop;

  for _r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_constraint fk
        where fk.conrelid = c.oid
          and fk.contype = 'f'
          and fk.confrelid = 'public.organizations'::regclass
          and a.attnum = any (fk.conkey)
      )
    order by 1
  loop
    _v := _v || format('[org_id FK 누락] public.%I.org_id → organizations(id) 외래키가 없습니다', _r.relname);
  end loop;

  ----------------------------------------------------------------------------
  -- 4. search_path 를 고정하지 않은 함수
  --    RLS 우회 권한을 가진 함수가 search_path 를 열어두면 호출자가 심어둔
  --    동명 객체로 함수 본문을 갈아끼울 수 있습니다. SECURITY DEFINER 가
  --    아니어도(트리거 함수 등) 같은 습관을 강제합니다 — Supabase 린터
  --    0011_function_search_path_mutable 과 같은 기준.
  ----------------------------------------------------------------------------
  for _r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
        where cfg like 'search_path=%'
      )
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
    order by 1
  loop
    _v := _v || format('[search_path 미고정] public.%I(%s)%s — set search_path 필수',
                       _r.proname, _r.args,
                       case when _r.prosecdef then ' [SECURITY DEFINER]' else '' end);
  end loop;

  ----------------------------------------------------------------------------
  -- 4b. anon 이 실행할 수 있는 SECURITY DEFINER 함수
  --     Supabase 는 public 스키마 함수의 EXECUTE 를 anon 에도 기본 부여합니다.
  --     `revoke ... from public` 만 하면 anon 권한이 남아, 로그인 없이
  --     /rest/v1/rpc/<함수> 로 호출됩니다. 미인증자에게 열어야 할 이유가
  --     있는 함수는 아래 예외 목록에 사유와 함께 등록하세요.
  ----------------------------------------------------------------------------
  for _r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname <> all (_exempt_anon_exec)
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
    order by 1
  loop
    _v := _v || format('[anon 실행 가능] public.%I(%s) — revoke all on function ... from anon', _r.proname, _r.args);
  end loop;

  ----------------------------------------------------------------------------
  -- 5. RLS 는 켰지만 정책이 하나도 없는 테이블 (전면 거부 = 사고 신호)
  --    실패시키지는 않고 알림만. 0002→0003 같은 중간 상태가 정상일 수 있음.
  ----------------------------------------------------------------------------
  for _r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
    order by 1
  loop
    raise notice '[알림] public.% 은 RLS 가 켜져 있으나 정책이 없습니다 (service_role 외 전면 거부)', _r.relname;
  end loop;

  ----------------------------------------------------------------------------
  -- 판정
  ----------------------------------------------------------------------------
  _n := coalesce(array_length(_v, 1), 0);

  if _n > 0 then
    raise exception E'테넌시 가드 실패 — 위반 %건\n%', _n, array_to_string(_v, E'\n');
  end if;

  raise notice '테넌시 가드 통과 — org_id / RLS / SECURITY DEFINER 위반 없음';
end
$guard$;
