-- 0026_invitation_code_issued_at_send.sql
-- 초대코드는 "발송 시점에 발급"된다 — code_hash 를 nullable 로.
--
-- exam_invitations.code_hash 는 NOT NULL 이었는데, 초대 생성 화면은
-- exam_id/email/name 만 넣는다. 그래서 초대 추가 자체가 실패하고 있었다.
--
-- 평문 코드를 저장하지 않는 설계(code_hash 만 보관)를 지키면서 이 흐름을 살리려면,
-- 코드 발급 시점이 "생성"이 아니라 "발송"이어야 한다:
--   생성 시 : code_hash NULL  = 아직 코드가 발급되지 않은 초대
--   발송 시 : send-exam-invitation 이 코드를 만들어 해시만 저장하고,
--             평문은 그 메일 본문에만 실려 나간다(재발송하면 새 코드로 교체).
alter table public.exam_invitations
  alter column code_hash drop not null;

comment on column public.exam_invitations.code_hash is
  '응시코드의 sha256 hex. NULL 이면 아직 발송(=발급)되지 않은 초대. 평문은 저장하지 않는다.';

-- 발급된 코드끼리는 충돌하면 안 된다(조회가 코드 하나로 이루어지므로 전역 유니크).
create unique index if not exists exam_invitations_code_hash_uidx
  on public.exam_invitations (code_hash)
  where code_hash is not null;
