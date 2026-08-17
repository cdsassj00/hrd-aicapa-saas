// Supabase Auth — Send SMS Hook
//
// Supabase 가 전화번호 OTP 를 보낼 때 이 함수를 대신 호출한다.
// 등록: Dashboard → Authentication → Hooks → Send SMS hook → 이 함수 선택.
//
// 이 함수는 사용자 JWT 없이 호출되므로 config.toml 에서 verify_jwt = false 다.
// 대신 Standard Webhooks 서명으로 "정말 Supabase 가 보낸 요청인지"를 검증한다.
// 이게 없으면 누구나 이 URL 로 POST 해서 문자를 보낼 수 있다 — 요금 폭탄이자
// 스팸 발송지가 된다.
//
// 필요한 시크릿
//   SEND_SMS_HOOK_SECRET   훅 등록 시 Supabase 가 발급 (v1,whsec_... 형식)
//   NCP_*                  _shared/sms.ts 참고 (네이버 클라우드 SENS)

import { Webhook } from "npm:standardwebhooks@1.0.0";
import { sendSms, SmsConfigError } from "../_shared/sms.ts";

interface SmsHookPayload {
  user: { id: string; phone: string };
  sms: { otp: string };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!hookSecret) {
    console.error("SEND_SMS_HOOK_SECRET 미설정 — 검증 없이 문자를 보내지 않는다");
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: "훅이 설정되지 않았습니다" } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const raw = await req.text();

  let payload: SmsHookPayload;
  try {
    // Supabase 가 주는 시크릿은 'v1,whsec_...' 형태. 라이브러리는 base64 부분만 받는다.
    const wh = new Webhook(hookSecret.replace("v1,whsec_", ""));
    payload = wh.verify(raw, Object.fromEntries(req.headers)) as SmsHookPayload;
  } catch (e) {
    console.error("훅 서명 검증 실패:", e instanceof Error ? e.message : e);
    return new Response(
      JSON.stringify({ error: { http_code: 401, message: "서명이 유효하지 않습니다" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const phone = payload?.user?.phone;
  const otp = payload?.sms?.otp;
  if (!phone || !otp) {
    return new Response(
      JSON.stringify({ error: { http_code: 400, message: "phone 또는 otp 가 없습니다" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    // EUC-KR 90바이트 안에 들어가야 SMS 단가로 나간다.
    await sendSms({ to: phone, content: `[AI CAPA] 인증번호 ${otp} (3분 내 입력)` });
  } catch (e) {
    const message = e instanceof Error ? e.message : "문자 발송에 실패했습니다";
    console.error("SMS 발송 실패:", message);
    // 설정 누락은 500(운영자 문제), 그 밖은 400(요청/번호 문제)으로 구분해
    // 대시보드 로그에서 원인이 바로 보이게 한다.
    const status = e instanceof SmsConfigError ? 500 : 400;
    return new Response(
      JSON.stringify({ error: { http_code: status, message } }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  // 빈 객체 = 성공. Supabase 는 error 키가 없으면 성공으로 본다.
  return new Response("{}", { headers: { "Content-Type": "application/json" } });
});
