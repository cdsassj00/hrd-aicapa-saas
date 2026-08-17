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
