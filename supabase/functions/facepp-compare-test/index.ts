// Face++ Compare API 테스트 전용 엣지 함수 (기존 verify-identity 영향 없음)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { selfie_base64, id_photo_base64 } = await req.json();
    if (!selfie_base64 || !id_photo_base64) {
      return new Response(JSON.stringify({ error: "selfie_base64 and id_photo_base64 are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const API_KEY = Deno.env.get("FACEPP_API_KEY");
    const API_SECRET = Deno.env.get("FACEPP_API_SECRET");
    if (!API_KEY || !API_SECRET) throw new Error("Face++ API keys not configured");

    const form = new FormData();
    form.append("api_key", API_KEY);
    form.append("api_secret", API_SECRET);
    form.append("image_base64_1", selfie_base64);
    form.append("image_base64_2", id_photo_base64);

    // 글로벌 엔드포인트 (US). 중국 본토는 api-cn.faceplusplus.com
    const resp = await fetch("https://api-us.faceplusplus.com/facepp/v3/compare", {
      method: "POST",
      body: form,
    });

    const data = await resp.json();
    console.log("Face++ response:", JSON.stringify(data));

    if (!resp.ok || data.error_message) {
      return new Response(JSON.stringify({ error: data.error_message || `HTTP ${resp.status}`, raw: data }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // confidence: 0~100, thresholds: { '1e-3': ~62, '1e-4': ~69, '1e-5': ~75 }
    const confidence: number = data.confidence ?? 0;
    const thresholds = data.thresholds || {};
    const passLevel =
      confidence >= (thresholds["1e-5"] ?? 75) ? "high" :
      confidence >= (thresholds["1e-4"] ?? 69) ? "medium" :
      confidence >= (thresholds["1e-3"] ?? 62) ? "low" : "fail";

    return new Response(JSON.stringify({
      confidence,
      thresholds,
      passLevel,
      match: passLevel !== "fail",
      faces1: data.faces1?.length ?? 0,
      faces2: data.faces2?.length ?? 0,
      raw: data,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("facepp-compare-test error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
