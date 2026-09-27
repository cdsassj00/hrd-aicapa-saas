-- 0027_org_branding_site_fields.sql
-- 사라진 site_settings(단일 행 전역 설정)를 org_branding(테넌트별)으로 대체.
--
-- 원본의 site_settings 는 squash 재설계에서 org_branding 으로 대체됐는데(0002 주석),
-- 화면(useSiteSettings)과 send-exam-invitation 은 여전히 site_settings 를 읽고 있었다.
-- 결과: 로그인 화면 진입마다 404, 관리자 설정 저장 실패.
--
-- org_branding 에는 로고·색상만 있어 제목/발신자 정보를 담을 자리가 없었다. 추가한다.
-- (전역 단일 설정으로 되돌리지 않는다 — 고객사마다 달라야 하는 값이다.)
alter table public.org_branding
  add column if not exists site_title           text,
  add column if not exists site_subtitle        text,
  add column if not exists footer_org           text,
  add column if not exists email_subject_prefix text,
  add column if not exists email_from_name      text,
  add column if not exists email_from_address   text;

comment on column public.org_branding.site_title is '로그인·상단바에 노출할 서비스명. NULL 이면 제품 기본값.';
comment on column public.org_branding.site_subtitle is '로그인 화면 부제. NULL 이면 제품 기본값.';
comment on column public.org_branding.footer_org is '증서·메일 하단에 표기할 기관명.';
comment on column public.org_branding.email_subject_prefix is '발송 메일 제목 접두사.';
comment on column public.org_branding.email_from_name is '발송자 표시 이름. 실제 발신 도메인은 MAIL_FROM 이 정한다.';
comment on column public.org_branding.email_from_address is '발송자 주소. Resend 에 인증된 도메인이어야 하며, 미설정 시 MAIL_FROM 을 쓴다.';
