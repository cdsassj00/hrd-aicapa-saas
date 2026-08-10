// 신분증 이미지 업로드 — service role 경유로 id-cards 버킷에 저장
// 클라이언트에서 storage.upload를 직접 호출하면 storage-api가 간헐적으로
// JWT를 403 RLS로 거부하는 이슈를 우회하기 위해 엣지 펑션 경유로 처리한다.
// 신분증은 민감정보이므로 anon INSERT는 절대 열지 않는다.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_SIZE = 5 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "인증 필요" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) JWT 검증 → userId
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "인증 실패" }, 401);
    const userId = userData.user.id;

    // 2) 입력 파싱
    let sessionId = "";
    let bytes: Uint8Array | null = null;
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await req.json();
      sessionId = body?.sessionId || "";
      const b64 = body?.imageBase64 || "";
      if (!b64) return json({ error: "이미지 누락" }, 400);
      try { bytes = b64ToBytes(b64); } catch { return json({ error: "이미지 디코딩 실패" }, 400); }
    } else if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      sessionId = String(form.get("sessionId") || "");
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "파일 누락" }, 400);
      if (file.type !== "image/jpeg") return json({ error: "JPEG 형식만 허용" }, 400);
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      return json({ error: "지원하지 않는 content-type" }, 400);
    }

    if (!sessionId) return json({ error: "sessionId 누락" }, 400);
    if (!bytes || bytes.byteLength === 0) return json({ error: "빈 이미지" }, 400);
    if (bytes.byteLength > MAX_SIZE) return json({ error: "이미지 5MB 초과" }, 413);

    // 간단한 JPEG 매직넘버 검증 (FF D8 FF)
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
      return json({ error: "JPEG 형식만 허용" }, 400);
    }

    // 3) 세션 소유권 검증
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: sess, error: sessErr } = await admin
      .from("exam_sessions")
      .select("id, applicant_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessErr) return json({ error: sessErr.message }, 500);
    if (!sess) return json({ error: "세션을 찾을 수 없습니다" }, 404);
    if (sess.applicant_id !== userId) return json({ error: "세션 소유자가 아닙니다" }, 403);

    // 4) 업로드 (service role → RLS 우회)
    const path = `${userId}/${sessionId}_${Date.now()}.jpg`;
    const { error: upErr } = await admin.storage
      .from("id-cards")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) return json({ error: `업로드 실패: ${upErr.message}` }, 500);

    // 5) exam_sessions.id_card_url 업데이트
    const { error: updErr } = await admin
      .from("exam_sessions")
      .update({ id_card_url: path })
      .eq("id", sessionId);
    if (updErr) return json({ error: `세션 업데이트 실패: ${updErr.message}` }, 500);

    return json({ path });
  } catch (e: any) {
    console.error("upload-id-card error:", e);
    return json({ error: e?.message || "서버 오류" }, 500);
  }
});
