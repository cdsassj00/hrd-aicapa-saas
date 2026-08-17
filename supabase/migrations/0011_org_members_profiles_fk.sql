-- 0011_org_members_profiles_fk.sql
-- org_members ↔ profiles 관계를 PostgREST 가 인식하도록 FK 를 추가한다.
--
-- 증상: 멤버 화면에서
--   "Could not find a relationship between 'org_members' and 'profiles'
--    in the schema cache"
--
-- 원인: OrgMembersPage 는 org_members 에서 profiles(name) 을 임베드한다
--   (.select('user_id, role, ..., profiles(name)')). PostgREST 는 임베드를
--   FK 로 해석하는데, org_members.user_id 는 auth.users(id) 만 참조하고
--   profiles(id) 로 가는 FK 가 없어 관계를 못 찾는다.
--
-- 해결: user_id 에서 profiles(id) 로 가는 FK 를 추가한다. profiles.id 자체가
--   auth.users(id) 를 참조하므로(1:1), 이 FK 는 기존 auth.users 참조와
--   모순되지 않고 "모든 멤버는 프로필을 가진다"를 보강한다. 프로필은
--   handle_new_user 트리거가 가입 시 항상 만든다 → orphan 없음(원격 확인 완료).

alter table public.org_members
  add constraint org_members_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

comment on constraint org_members_user_id_profiles_fkey on public.org_members is
  'PostgREST 임베드용(org_members → profiles). user_id 는 auth.users 도 참조하지만 PostgREST 는 profiles 로 가는 이 FK 를 통해 profiles(name) 임베드를 해석한다';

-- PostgREST 스키마 캐시를 즉시 갱신(새 관계 인식)
notify pgrst, 'reload schema';
