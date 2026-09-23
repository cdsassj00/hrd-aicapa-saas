-- 0024_demo_chat_usage.sql
-- 공개 데모 챗(/demo)의 남용 방지용 사용량 기록.
--
-- /demo 는 로그인 없이 방문자가 AI와 3턴까지 실제로 대화해 볼 수 있다.
-- 인증이 없으므로 호출자를 특정할 수 없고, LLM 비용이 그대로 노출된다.
-- 그래서 IP 해시별 일일 턴 수를 서버에서 세어 상한을 건다.
-- (클라이언트의 3턴 제한은 UX 일 뿐 보안 경계가 아니다.)

create table if not exists public.demo_chat_usage (
  ip_hash    text        not null,
  day        date        not null default current_date,
  turns      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ip_hash, day)
);

-- 테넌트 밖 데이터다. 정책을 하나도 두지 않아 service_role(엣지 함수)만 접근한다.
alter table public.demo_chat_usage enable row level security;

comment on table public.demo_chat_usage is
  '공개 데모 챗(/demo) 남용 방지용 IP 해시별 일일 사용량. 테넌트 경계 밖 — 정책 없음(service_role 전용).';
