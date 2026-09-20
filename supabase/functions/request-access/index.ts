// 가입 후 접근 승인 요청/독촉 — 로그인한 사용자가 호출한다.
// 순서: (1) 호출자 신원을 JWT 로 확인(본문 신뢰 금지)
//       (2) inquiries 에 '가입 승인요청'으로 기록(소스 오브 트루스)
//       (3) Resend 메일 알림 → INQUIRY_NOTIFY_TO(sjshin@cdsa.kr)
// 설계문서 §8: 비즈니스 로직 최소, HTTP 껍데기.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

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
      const rowHtml = (k: string, v?: string | null) =>
        v ? `<tr><td style="padding:6px 12px;color:#667;white-space:nowrap">${k}</td><td style="padding:6px 12px"><b>${esc(v)}</b></td></tr>` : "";
      await sendEmail({
        to,
        subject: `[AI-HRD 가입 승인요청] ${esc(user.email ?? name)}`,
        html: `<div style="font-family:-apple-system,'Malgun Gothic',sans-serif;font-size:14px;color:#111;max-width:560px">
          <h2 style="margin:0 0 14px;font-size:18px">가입자 접근 승인 요청</h2>
          <table style="border-collapse:collapse;background:#f6f8fb;border-radius:10px;width:100%">
            ${rowHtml("이름", name)}${rowHtml("이메일", user.email)}${rowHtml("소속", org)}
            ${rowHtml("예상 인원", headcount)}${rowHtml("연락처", phone)}${rowHtml("user_id", user.id)}
            ${message ? `<tr><td style="padding:6px 12px;color:#667;vertical-align:top">메모</td><td style="padding:6px 12px;white-space:pre-wrap">${esc(message)}</td></tr>` : ""}
          </table>
          <p style="color:#8a94a3;font-size:12px;margin-top:16px">app.ai-hrd.com 승인 대기 화면에서 요청 · 조직 개설 후 org_owner 로 초대하면 접근이 열립니다.</p>
        </div>`,
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
