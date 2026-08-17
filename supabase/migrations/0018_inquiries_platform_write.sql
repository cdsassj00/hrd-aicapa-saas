-- 0018_inquiries_platform_write.sql
-- 플랫폼 운영자가 도입 문의의 처리 상태를 관리(업데이트)할 수 있게 한다.
-- 0013 은 읽기 정책만 뒀다(INSERT 는 Edge Function service_role). /platform 대시보드에서
-- 상태(신규→상담중→완료 등)를 바꾸려면 UPDATE 정책이 필요하다.
create policy "inquiries_platform_write" on public.inquiries
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
