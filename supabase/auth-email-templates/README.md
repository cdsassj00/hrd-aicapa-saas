# Supabase Auth 이메일 템플릿 (브랜드 적용)

Supabase가 보내는 **인증 계열 메일**(가입 이메일 인증, 비밀번호 재설정, 매직링크, 조직 초대)의 HTML 템플릿입니다.
이 메일들은 코드가 아니라 **Supabase 대시보드에서 관리**되므로, 아래 HTML을 복사해 붙여넣어야 적용됩니다.

## 적용 방법
1. Supabase 대시보드 → 프로젝트(`eoeiqpgzoyltrawfflhj`) → **Authentication → Emails**(또는 Email Templates).
2. 각 템플릿을 선택하고, 아래 파일 내용을 **Message body(HTML)** 에 붙여넣기. 상단 주석(`<!-- ... -->`)은 지워도 됩니다.
3. Subject(제목)도 함께 지정.

| 대시보드 템플릿 | 파일 | 추천 제목 |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `[AI 역량평가] 이메일 인증` |
| Reset Password | `reset-password.html` | `[AI 역량평가] 비밀번호 재설정` |
| Magic Link | `magic-link.html` | `[AI 역량평가] 로그인 링크` |
| Invite user | `invite.html` | `[AI 역량평가] 조직 초대` |

## 변수
- `{{ .ConfirmationURL }}` — Supabase가 자동으로 채우는 동작 링크. 그대로 두세요.
- (필요 시) `{{ .Token }}`, `{{ .SiteURL }}`, `{{ .Email }}` 등도 사용 가능.

## 발신 주소 / 도메인
- 이 메일들은 기본적으로 Supabase 내장 메일러로 나갑니다. 브랜드 발신 주소(`@ai-hrd.com` 등)와 도달률을 위해서는
  **Authentication → SMTP Settings** 에서 커스텀 SMTP(예: Resend SMTP)를 설정하는 것을 권장합니다.
- Resend SMTP를 쓸 경우 발신 도메인(ai-hrd.com 등)이 Resend에 인증되어 있어야 합니다.

> 참고: 도입문의·가입 승인요청 등 **우리 Edge Function이 보내는 알림 메일**은 `supabase/functions/_shared/email.ts`
> 의 `renderNotifyEmail()` 로 이미 동일한 브랜드 디자인이 적용되어 있습니다(코드로 관리).
