import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { instructions, examTitle, grade, durationMinutes } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `당신은 AI 역량 검정 시험의 유의사항을 전문적으로 정리하는 어시스턴트입니다.
관리자가 대략적으로 작성한 시험 유의사항을 받아서 다음 규칙에 따라 정리해주세요:

1. 명확하고 간결한 한국어로 작성
2. 번호 매기기 (1., 2., 3., ...) 형식으로 정리
3. 시험 관련 중요 사항을 우선 배치
4. 부정행위 관련 경고를 포함
5. 기술적 안내사항(화면 공유, 웹캠 등)을 포함
6. 결과 통보 관련 안내 포함
7. 원래 내용을 존중하되 누락된 중요 항목은 추가
8. 마크다운 형식 없이 순수 텍스트로 작성

시험 정보:
- 시험명: ${examTitle || '미정'}
- 등급: ${grade || '미정'}
- 시험 시간: ${durationMinutes || 90}분`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: instructions
                ? `다음 유의사항을 정리해주세요:\n\n${instructions}`
                : "기본 시험 유의사항을 생성해주세요.",
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "크레딧이 부족합니다." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const polished = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ polished }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("polish-instructions error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
