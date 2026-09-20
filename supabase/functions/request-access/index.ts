// 가입 후 접근 승인 요청/독촉 — 로그인한 사용자가 호출한다.
// 순서: (1) 호출자 신원을 JWT 로 확인(본문 신뢰 금지)
//       (2) inquiries 에 '가입 승인요청'으로 기록(소스 오브 트루스)
//       (3) Resend 메일 알림 → INQUIRY_NOTIFY_TO(sjshin@cdsa.kr)
// 설계문서 §8: 비즈니스 로직 최소, HTTP 껍데기.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { sendEmail, renderNotifyEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "인증이 필요합니다." }, 401);

    // (1) 호출자 신원 확인 — 이메일/이름은 토큰에서 가져온다.
    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await authed.auth.getUser();
    const user = userRes?.user;
    if (userErr || !user) return json({ error: "세션이 유효하지 않습니다." }, 401);

    const b = await req.json().catch(() => ({}));
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await service
      .from("profiles").select("name, phone").eq("id", user.id).maybeSingle();

    const name = String(b.name ?? profile?.name ?? "").trim() || (user.email?.split("@")[0] ?? "");
    const org = String(b.org ?? "").trim();
    const headcount = String(b.headcount ?? "").trim();
    const phone = String(b.phone ?? profile?.phone ?? "").trim();
    const message = String(b.message ?? "").trim();

    const input = {
      company: org || "(개인 가입자)",
      contact_name: name || null,
      email: user.email ?? null,
      phone: phone || null,
      headcount: headcount || null,
      timeframe: null,
      inquiry_type: "가입 승인요청",
      source: "app 승인요청",
      message: message || null,
    };

    // (2) 기록(베스트에포트로 두지 않고 실패 시 알린다 — 접수 자체가 목적)
    const { data: row, error } = await service
      .from("inquiries").insert(input).select("id").single();
    if (error || !row) {
      console.error("[request-access] insert failed", error);
      return json({ error: "요청 저장에 실패했습니다. 잠시 후 다시 시도해주세요." }, 500);
    }

    // (3) 메일 알림
    try {
      const to = Deno.env.get("INQUIRY_NOTIFY_TO") || "sjshin@cdsa.kr";
      await sendEmail({
        to,
        subject: `[AI-HRD 가입 승인요청] ${user.email ?? name}`,
        html: renderNotifyEmail({
          kicker: "가입 승인요청",
          title: "가입자 접근 승인 요청",
          rows: [
            { label: "이름", value: name },
            { label: "이메일", value: user.email },
            { label: "소속", value: org },
            { label: "예상 인원", value: headcount },
            { label: "연락처", value: phone },
          ],
          message,
          footnote: `승인 대기 화면에서 접수된 요청입니다. 조직을 개설하고 org_owner 로 초대하면 이 사용자의 접근이 열립니다. (user_id: ${user.id})`,
        }),
        replyTo: user.email ?? undefined,
      });
    } catch (e) {
      console.error("[request-access] email notify error", e);
      // 기록은 됐으니 성공으로 응답하되 메일 실패를 알린다.
      return json({ ok: true, emailed: false });
    }

    return json({ ok: true, emailed: true });
  } catch (e) {
    console.error("[request-access] error", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});
