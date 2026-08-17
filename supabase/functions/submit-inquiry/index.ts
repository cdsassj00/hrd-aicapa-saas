// 도입 문의 접수 — 랜딩 커스텀 폼이 POST 한다.
// 순서: (1) Supabase inquiries 저장(소스 오브 트루스)
//       (2) Notion DB 미러링(베스트에포트)
//       (3) Resend 메일 알림(베스트에포트) — INQUIRY_NOTIFY_TO 로 발송
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { createInquiryNotionPage } from "../_shared/notion.ts";
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

function notifyHtml(i: Record<string, string | null>): string {
  const row = (k: string, v?: string | null) =>
    v ? `<tr><td style="padding:6px 12px;color:#667;white-space:nowrap">${k}</td><td style="padding:6px 12px"><b>${esc(v)}</b></td></tr>` : "";
  return `<div style="font-family:-apple-system,'Malgun Gothic',sans-serif;font-size:14px;color:#111;max-width:560px">
    <h2 style="margin:0 0 14px;font-size:18px">새 도입 문의 · ${esc(i.company)}</h2>
    <table style="border-collapse:collapse;background:#f6f8fb;border-radius:10px;width:100%">
      ${row("회사/기관", i.company)}${row("담당자", i.contact_name)}${row("이메일", i.email)}${row("연락처", i.phone)}
      ${row("유형", i.inquiry_type)}${row("예상 인원", i.headcount)}${row("희망 시기", i.timeframe)}${row("유입경로", i.source)}
      ${i.message ? `<tr><td style="padding:6px 12px;color:#667;vertical-align:top">문의 내용</td><td style="padding:6px 12px;white-space:pre-wrap">${esc(i.message)}</td></tr>` : ""}
    </table>
    <p style="color:#8a94a3;font-size:12px;margin-top:16px">ai-hrd.com 도입 문의 폼 접수 · Notion DB 에도 기록되었습니다.</p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const b = await req.json().catch(() => ({}));

    // 스팸 허니팟: 사람 눈에 안 보이는 website 필드가 채워지면 봇 → 조용히 성공 처리
    if (typeof b.website === "string" && b.website.trim() !== "") return json({ ok: true });

    const company = String(b.company ?? "").trim();
    const email = String(b.email ?? "").trim();
    const phone = String(b.phone ?? "").trim();
    if (!company) return json({ error: "회사명을 입력해주세요." }, 400);
    if (!email && !phone) return json({ error: "이메일 또는 연락처 중 하나는 입력해주세요." }, 400);

    const input = {
      company,
      contact_name: String(b.contact_name ?? "").trim() || null,
      email: email || null,
      phone: phone || null,
      headcount: String(b.headcount ?? "").trim() || null,
      timeframe: String(b.timeframe ?? "").trim() || null,
      inquiry_type: String(b.inquiry_type ?? "").trim() || null,
      source: String(b.source ?? "").trim() || null,
      message: String(b.message ?? "").trim() || null,
    };

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: row, error } = await service
      .from("inquiries")
      .insert(input)
      .select("id")
      .single();
    if (error || !row) {
      console.error("[submit-inquiry] insert failed", error);
      return json({ error: "접수 저장에 실패했습니다. 잠시 후 다시 시도해주세요." }, 500);
    }

    // (2) Notion 미러링(베스트에포트)
    let notionId: string | null = null;
    try {
      notionId = await createInquiryNotionPage(input);
    } catch (e) {
      console.error("[submit-inquiry] notion mirror error", e);
    }
    if (notionId) {
      await service.from("inquiries").update({ notion_page_id: notionId }).eq("id", row.id);
    }

    // (3) 메일 알림(베스트에포트) — 담당자 Outlook 등으로. replyTo 를 문의자 이메일로 두어 바로 회신 가능.
    try {
      const to = Deno.env.get("INQUIRY_NOTIFY_TO") || "sjshin@cdsa.kr";
      await sendEmail({
        to,
        subject: `[AI-HRD 도입문의] ${input.company}${input.inquiry_type ? " · " + input.inquiry_type : ""}`,
        html: notifyHtml(input),
        replyTo: input.email || undefined,
      });
    } catch (e) {
      console.error("[submit-inquiry] email notify error", e);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[submit-inquiry] error", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});
