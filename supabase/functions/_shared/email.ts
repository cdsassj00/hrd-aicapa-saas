// 메일 발송 — Resend 직접 호출.
//
// 원본은 https://connector-gateway.lovable.dev/resend 를 경유했다. 그 경로는
// 러버블 계정과 LOVABLE_API_KEY 에 묶여 있어 이 프로젝트에서는 쓸 수 없고,
// 쓸 수 있더라도 메일 전송 경로에 남의 인프라를 하나 더 끼우는 셈이다.
//
// 요청 본문은 원본과 동일하다 — 게이트웨이가 Resend API 를 그대로
// 프록시하고 있었기 때문에, 껍데기만 벗기면 된다.
//
// 설계문서 §8: 비즈니스 로직은 순수 모듈로. Edge Function 은 HTTP 껍데기만.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  /** 미지정 시 MAIL_FROM 환경변수. 도메인은 Resend 에서 인증되어 있어야 한다. */
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  id: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const from = input.from ?? Deno.env.get("MAIL_FROM");
  if (!from) {
    throw new Error("MAIL_FROM is not configured (예: 'AI역량진단 <noreply@example.com>')");
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    // Resend 는 실패 사유를 body 에 담아 준다. 삼키지 말고 올린다 —
    // 도메인 미인증·발신 주소 불일치가 대부분이고, 메시지에 그게 적혀 있다.
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail || res.statusText}`);
  }

  return (await res.json()) as SendEmailResult;
}

// ---------------------------------------------------------------------------
// 브랜드 알림 이메일 템플릿 — 승인요청·도입문의 등 내부 알림 공통.
// 이메일 클라이언트 호환을 위해 table 기반 + 인라인 스타일.
// ---------------------------------------------------------------------------
const escHtml = (s?: string | null) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export interface NotifyRow {
  label: string;
  value?: string | null;
}

export function renderNotifyEmail(opts: {
  /** 상단 배지 문구 (예: "가입 승인요청", "도입 문의") */
  kicker: string;
  /** 본문 제목 */
  title: string;
  rows: NotifyRow[];
  /** 자유 서술(문의 내용 등) */
  message?: string | null;
  /** 하단 CTA 버튼 */
  cta?: { label: string; href: string } | null;
  /** 하단 회색 안내 문구 */
  footnote?: string;
}): string {
  const rowsHtml = opts.rows
    .filter((r) => r.value)
    .map(
      (r) => `<tr>
        <td style="padding:11px 20px;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;border-top:1px solid #eef1f6">${escHtml(r.label)}</td>
        <td style="padding:11px 20px;color:#0f172a;font-size:14px;font-weight:600;border-top:1px solid #eef1f6;word-break:break-word">${escHtml(r.value)}</td>
      </tr>`,
    )
    .join("");

  const messageHtml = opts.message
    ? `<div style="margin:18px 20px 0;padding:14px 16px;background:#f8fafc;border:1px solid #eef1f6;border-radius:10px;color:#334155;font-size:13.5px;line-height:1.6;white-space:pre-wrap">${escHtml(opts.message)}</div>`
    : "";

  const ctaHtml = opts.cta
    ? `<div style="padding:22px 20px 4px"><a href="${escHtml(opts.cta.href)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px">${escHtml(opts.cta.label)}</a></div>`
    : "";

  const footnote = opts.footnote
    ? `<p style="margin:18px 24px 0;color:#94a3b8;font-size:12px;line-height:1.6">${escHtml(opts.footnote)}</p>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6eaf0;font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕',sans-serif">
        <tr><td style="background:linear-gradient(100deg,#4f46e5,#7c3aed);padding:22px 24px">
          <div style="color:#ffffff;font-size:16px;font-weight:800;letter-spacing:-0.01em">AI 역량평가 <span style="opacity:.8;font-weight:600">for Business</span></div>
          <div style="margin-top:6px"><span style="display:inline-block;background:rgba(255,255,255,.18);color:#ffffff;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px">${escHtml(opts.kicker)}</span></div>
        </td></tr>
        <tr><td style="padding:22px 24px 0">
          <h1 style="margin:0;font-size:19px;color:#0f172a;letter-spacing:-0.01em">${escHtml(opts.title)}</h1>
        </td></tr>
        <tr><td style="padding:16px 4px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rowsHtml}</table>
        </td></tr>
        <tr><td>${messageHtml}${ctaHtml}${footnote}</td></tr>
        <tr><td style="padding:22px 24px 24px">
          <hr style="border:none;border-top:1px solid #eef1f6;margin:0 0 12px">
          <div style="color:#94a3b8;font-size:11.5px;line-height:1.7">
            (주)한국데이터사이언티스트협회 · AI 역량평가 for Business<br>
            <a href="https://ai-hrd.com" style="color:#6366f1;text-decoration:none">ai-hrd.com</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
