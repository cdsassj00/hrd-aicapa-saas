// 도입 문의 접수 — 랜딩 커스텀 폼이 POST 한다.
// 순서: (1) Supabase inquiries 테이블에 저장(소스 오브 트루스)
//       (2) Notion DB 로 미러링(베스트에포트 — 실패해도 리드는 유지)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { createInquiryNotionPage } from "../_shared/notion.ts";

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

    // Notion 미러링(베스트에포트)
    let notionId: string | null = null;
    try {
      notionId = await createInquiryNotionPage(input);
    } catch (e) {
      console.error("[submit-inquiry] notion mirror error", e);
    }
    if (notionId) {
      await service.from("inquiries").update({ notion_page_id: notionId }).eq("id", row.id);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[submit-inquiry] error", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});
