-- 0044_seat_credits.sql
--
-- 응시권(1명 = 1회 응시) 선불 구매와 차감.
--
-- 정기결제(Pro 월 구독, 0019·0028)는 카드사 빌링 심사가 끝나야 쓸 수 있다. 그 전에도
-- 팔 수 있도록 일반 결제(1회)로 "응시 N명분"을 사 두고, 응시할 때마다 1명분씩 쓴다.
-- 단가는 랜딩·환불정책에 이미 적힌 "1인당 25,000원(부가세 별도)"을 그대로 쓴다
-- (_shared/tossBilling.ts SEAT_PRODUCT — 카드사 심사는 페이지 금액과 결제 금액을 대조).
--
-- 잔액은 장부(seat_ledger)의 합으로만 계산한다. 잔액 컬럼을 따로 두면 장부와 어긋나는
-- 순간 "왜 이 숫자인지"를 설명할 수 없다. 기록은 추가만 하고 고치지 않는다.
--
-- 기존 조직은 막지 않는다. organizations.seat_enforced 가 true 인 조직만 잔액이 0 이면
-- 응시 신청이 막힌다. 새로 승인되는 조직(0043 approve_inquiry)부터 켜고 무료 체험분을
-- 준다. 진행 중인 회차가 있는 기존 조직(파일럿·심사용)을 갑자기 멈추지 않기 위해서다.
-- 활성 구독(Pro)이 있는 조직은 차감하지 않는다. 테스트 모드 회차도 차감하지 않는다.

alter table public.organizations
  add column if not exists seat_enforced boolean not null default false;

-- ── seat_orders : 응시권 결제 주문 ──
-- 금액은 서버가 정한다. 결제 확인(confirm) 때 주문 금액과 결제 금액이 같아야 통과한다
-- — 브라우저가 금액을 바꿔 보내는 위변조를 막는 자리다.
create table if not exists public.seat_orders (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  order_id    text not null unique,
  seats       integer not null check (seats between 1 and 1000),
  amount      integer not null check (amount > 0),
  status      text not null default 'READY' check (status in ('READY', 'DONE', 'FAILED')),
  payment_key text,
  failure_message text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);
alter table public.seat_orders enable row level security;
create index if not exists seat_orders_org_idx on public.seat_orders (org_id, created_at desc);
drop policy if exists "seat orders read" on public.seat_orders;
create policy "seat orders read" on public.seat_orders
  for select to authenticated
  using (public.is_org_admin(org_id) or public.is_platform_admin());

-- ── seat_ledger : 응시권 장부(추가 전용) ──
create table if not exists public.seat_ledger (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  delta      integer not null check (delta <> 0),
  reason     text not null check (reason in ('purchase', 'consume', 'grant', 'refund', 'adjust')),
  order_id   text,
  session_id uuid references public.exam_sessions(id) on delete set null,
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.seat_ledger enable row level security;
create index if not exists seat_ledger_org_idx on public.seat_ledger (org_id, created_at desc);
-- 한 세션은 한 번만 차감된다(재진입·재시도로 두 번 빠지지 않게).
create unique index if not exists seat_ledger_one_consume_per_session
  on public.seat_ledger (session_id) where reason = 'consume';
drop policy if exists "seat ledger read" on public.seat_ledger;
create policy "seat ledger read" on public.seat_ledger
  for select to authenticated
  using (public.is_org_admin(org_id) or public.is_platform_admin());

-- 쓰기는 정책을 두지 않는 것만으로는 막히지 않는다(기본 권한 때문에 UPDATE/DELETE 가
-- 0건으로 조용히 통과한다 — 0030 참고). 권한 자체를 회수한다.
revoke insert, update, delete, truncate on public.seat_orders, public.seat_ledger from anon, authenticated;
revoke select on public.seat_orders, public.seat_ledger from anon;

-- 잔액. 조직 관리자·운영자만.
create or replace function public.org_seat_balance(_org_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_org_admin(_org_id) or public.is_platform_admin()) then
    raise exception '권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((select sum(delta)::int from public.seat_ledger where org_id = _org_id), 0);
end $$;
revoke all on function public.org_seat_balance(uuid) from public, anon;
grant execute on function public.org_seat_balance(uuid) to authenticated;

-- 응시 세션 하나에 대해 1명분을 차감한다. 응시 신청 함수(redeem·apply)만 부른다 —
-- 클라이언트에게는 실행 권한을 주지 않는다.
create or replace function public.consume_seat_for_session(_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _sess public.exam_sessions;
  _exam public.exams;
  _org  public.organizations;
  _bal  integer;
begin
  select * into _sess from public.exam_sessions where id = _session_id;
  select * into _exam from public.exams where id = _sess.exam_id;
  if coalesce(_exam.is_test_mode, false) then return; end if;

  -- 같은 조직의 동시 신청이 마지막 1명분을 둘이 함께 쓰지 않도록 조직 행을 잠근다.
  select * into _org from public.organizations where id = _exam.org_id for update;
  if not coalesce(_org.seat_enforced, false) then return; end if;

  if exists (
    select 1 from public.subscriptions s
     where s.org_id = _org.id and s.status = 'active'
       and (s.current_period_end is null or s.current_period_end > now())
  ) then
    return;
  end if;

  if exists (select 1 from public.seat_ledger where session_id = _session_id and reason = 'consume') then
    return;
  end if;

  _bal := coalesce((select sum(delta)::int from public.seat_ledger where org_id = _org.id), 0);
  if _bal <= 0 then
    raise exception '이 조직의 응시권이 모두 소진되었습니다. 시험 담당자에게 문의해 주세요.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.seat_ledger (org_id, delta, reason, session_id, created_by)
  values (_org.id, -1, 'consume', _session_id, auth.uid());
end $$;
revoke all on function public.consume_seat_for_session(uuid) from public, anon, authenticated;

-- 운영자가 무료로 지급(체험분·보상)하거나 회수한다.
create or replace function public.grant_seats(_org_id uuid, _seats integer, _note text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception '플랫폼 운영자만 응시권을 지급할 수 있습니다' using errcode = 'insufficient_privilege';
  end if;
  if _seats is null or _seats = 0 then
    raise exception '지급 수량이 필요합니다' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.seat_ledger (org_id, delta, reason, note, created_by)
  values (_org_id, _seats, case when _seats > 0 then 'grant' else 'adjust' end, _note, auth.uid());
  return coalesce((select sum(delta)::int from public.seat_ledger where org_id = _org_id), 0);
end $$;
revoke all on function public.grant_seats(uuid, integer, text) from public, anon;
grant execute on function public.grant_seats(uuid, integer, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 응시 신청 두 경로(초대코드·공개 신청)에 차감을 건다. 함수 본문은 0041·0042 와
-- 같고 새 세션을 만든 직후 consume_seat_for_session 한 줄만 더했다.
-- 가입 승인(0043)은 새 조직에 과금을 켜고 체험분 5명을 준다.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.redeem_exam_invitation(_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid       uuid := auth.uid();
  _email     text;
  _inv       public.exam_invitations;
  _exam      public.exams;
  _session   public.exam_sessions;
  _test_mode boolean;
begin
  if _uid is null then
    raise exception '인증이 필요합니다' using errcode = 'insufficient_privilege';
  end if;

  select lower(btrim(u.email)) into _email from auth.users u where u.id = _uid;

  -- 코드 정규화는 get_invitation_by_code 와 반드시 같아야 한다
  select * into _inv
  from public.exam_invitations
  where invite_code = upper(btrim(_code))
  limit 1;

  if _inv.id is null then
    raise exception '유효하지 않은 응시코드입니다' using errcode = 'no_data_found';
  end if;

  -- 실질 방어선. 코드가 유출돼도 초대받은 계정이 아니면 들어오지 못한다.
  if _email is null or lower(btrim(_inv.email)) <> _email then
    raise exception '이 응시코드는 다른 분에게 발급된 코드입니다'
      using errcode = 'insufficient_privilege';
  end if;

  select * into _exam from public.exams where id = _inv.exam_id;
  if _exam.id is null then
    raise exception '회차를 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;
  if _exam.status <> 'open' then
    raise exception '이 회차는 현재 응시할 수 없습니다' using errcode = 'invalid_parameter_value';
  end if;

  _test_mode := coalesce(_exam.is_test_mode, false);

  -- 이미 진행 중인 세션이 있으면 그걸 돌려준다. 재사용이 먼저다 —
  -- 창을 닫았다 다시 들어온 응시자가 새 세션을 받으면 답안을 잃는다.
  select * into _session
  from public.exam_sessions
  where exam_id = _inv.exam_id
    and applicant_id = _uid
    and status in ('waiting', 'in_progress')
  order by created_at desc
  limit 1;

  if _session.id is null then
    -- 진행 중인 게 없을 때만 is_used 를 막는다. 테스트 모드는 예외.
    if coalesce(_inv.is_used, false) and not _test_mode then
      raise exception '이미 사용된 응시코드입니다' using errcode = 'invalid_parameter_value';
    end if;

    insert into public.exam_sessions (exam_id, applicant_id)
    values (_inv.exam_id, _uid)
    returning * into _session;   -- org_id 는 exam_sessions_inherit_org 가 채운다

    -- 새 응시 1건 = 응시권 1명분(0044). 부족하면 예외로 세션 생성까지 되돌린다.
    perform public.consume_seat_for_session(_session.id);
  end if;

  -- 초대받은 응시자를 그 조직의 applicant 로 등록한다.
  --
  -- RLS 가 전부 조직 멤버십 위에 서 있다(설계문서 §6). 멤버십이 없으면 자기
  -- 세션은 읽히지만 회차(exams)를 못 읽어 대기실이 빈 화면이 된다 — E2E 로
  -- 확인했다. 문항·답안도 같은 벽에 걸린다.
  --
  -- 조직 관리자가 초대코드를 발급한 행위가 곧 "이 사람을 내 조직 응시자로
  -- 받는다"는 승인이므로 운영자 승인을 따로 끼우지 않는다. 고객사 직원
  -- 수백 명을 플랫폼 운영자가 일일이 승인하는 구조는 쓸 수 없다.
  -- 권한은 applicant 하나뿐이고, 그 역할로는 자기 세션만 보인다.
  insert into public.org_members (org_id, user_id, role, status, display_name)
  values (_exam.org_id, _uid, 'applicant', 'active', nullif(btrim(coalesce(_inv.name, '')), ''))
  on conflict (org_id, user_id, role) do update
    set status = 'active'
  where public.org_members.status <> 'active';

  if not _test_mode then
    update public.exam_invitations
       set is_used = true, session_id = _session.id, accepted_at = coalesce(accepted_at, now())
     where id = _inv.id;
  end if;

  return _session.id;
end $$;

comment on function public.redeem_exam_invitation(text) is
  '응시자가 초대코드로 응시 세션을 확보한다. 로그인 계정의 이메일이 초대 이메일과 '
  '일치할 때만 통과한다. 진행 중인 세션이 있으면 재사용한다.';

-- 로그인한 응시자만 쓴다. 비로그인 경로는 get_invitation_by_code + 게스트 OTP 다.
revoke all on function public.redeem_exam_invitation(text) from public, anon;
grant execute on function public.redeem_exam_invitation(text) to authenticated;

create or replace function public.apply_open_exam(_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid     uuid := auth.uid();
  _exam    public.exams;
  _session public.exam_sessions;
begin
  if _uid is null then
    raise exception '인증이 필요합니다' using errcode = 'insufficient_privilege';
  end if;

  select * into _exam from public.exams where id = _exam_id;
  if _exam.id is null then
    raise exception '회차를 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.org_members m
     where m.org_id = _exam.org_id and m.user_id = _uid and m.status = 'active'
  ) then
    raise exception '이 조직의 구성원만 신청할 수 있습니다. 받은 응시코드가 있다면 응시코드로 들어와 주세요.'
      using errcode = 'insufficient_privilege';
  end if;

  if _exam.status <> 'open' then
    raise exception '이 회차는 현재 응시할 수 없습니다' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(_exam.registration_mode, 'open') not in ('open', 'hybrid') then
    raise exception '이 시험은 응시코드가 필요합니다' using errcode = 'invalid_parameter_value';
  end if;

  select * into _session
  from public.exam_sessions
  where exam_id = _exam_id and applicant_id = _uid and status in ('waiting', 'in_progress')
  order by created_at desc
  limit 1;
  if _session.id is not null then
    return _session.id;
  end if;

  if exists (select 1 from public.exam_sessions where exam_id = _exam_id and applicant_id = _uid) then
    raise exception '이미 응시한 시험입니다. 재응시는 담당자에게 요청해 주세요.'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.exam_sessions (exam_id, applicant_id)
  values (_exam_id, _uid)
  returning * into _session;   -- org_id 는 exam_sessions_inherit_org 가 채운다

  -- 새 응시 1건 = 응시권 1명분(0044). 부족하면 예외로 세션 생성까지 되돌린다.
  perform public.consume_seat_for_session(_session.id);

  return _session.id;
end $$;

comment on function public.apply_open_exam(uuid) is
  '공개·혼합 회차에 조직 구성원이 스스로 응시 신청한다. 진행 중 세션이 있으면 재사용한다.';

revoke all on function public.apply_open_exam(uuid) from public, anon;
grant execute on function public.apply_open_exam(uuid) to authenticated;

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

  -- 새 조직은 응시권으로 과금한다(0044). 무료 체험분을 지급한다.
  update public.organizations set seat_enforced = true where id = _org.id;
  insert into public.seat_ledger (org_id, delta, reason, note, created_by)
  values (_org.id, 5, 'grant', '가입 승인 무료 체험분', auth.uid());

  return _org;
end $$;

comment on function public.approve_inquiry(uuid, text) is
  '가입 승인: 요청자의 회사명으로 조직을 만들고 요청자를 소유자로 넣는다. 운영자 전용.';

revoke all on function public.approve_inquiry(uuid, text) from public, anon;
grant execute on function public.approve_inquiry(uuid, text) to authenticated;
