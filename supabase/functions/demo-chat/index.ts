// 공개 데모 챗(/demo) — 로그인 없이 방문자가 AI와 3턴까지 실제로 대화해 본다.
//
// 인증이 없으므로 호출자를 특정할 수 없고 LLM 비용이 그대로 노출된다. 그래서:
//   (1) 요청당 사용자 턴 3개 상한 (클라이언트 제한은 UX 일 뿐, 여기서 강제)
//   (2) IP 해시별 일일 턴 상한 (demo_chat_usage, 0024)
//   (3) 입력 길이·응답 토큰 상한
// 설계문서 §8: 비즈니스 로직 최소, HTTP 껍데기.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { AiPaymentRequiredError, AiRateLimitError, chatCompletion } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_USER_TURNS = 3;        // 한 체험에서 허용하는 사용자 발화 수
const MAX_CHARS_PER_MSG = 1500;
const MAX_TOTAL_CHARS = 8000;
const DAILY_TURNS_PER_IP = 30;   // 같은 IP 의 하루 총 턴 상한

const SYSTEM = `당신은 "AI 활용 역량평가" 체험 화면에 붙어 있는 업무 보조 AI입니다.
방문자는 아래 체험 과제를 AI로 풀어 보는 중입니다.

[체험 과제] 이커머스 2분기 주문 데이터(orders_2026Q2.csv · 320행, 통화기호·결측 혼재)에서
 1) '완료' 주문만 대상으로 카테고리별 매출 합계와 평균 배송일
 2) 매출 1위 카테고리와 가장 빠른 배송 카테고리
 3) 재구매(2회 이상) 고객 비율 — 산출 기준 명시
를 구해 집계표(.csv)와 요약 리포트(.md)를 만드는 것이 목표입니다.

규칙:
- 한국어로, 실무자에게 말하듯 간결하게. 5문장 이내 또는 짧은 불릿으로.
- 실제 파일이 없으므로 수치가 필요하면 "예시 기준"임을 밝히고 그럴듯한 값으로 설명하세요.
- 방문자가 무엇을 어떻게 지시하면 좋은지(프롬프트 설계)를 자연스럽게 보여 주세요.
- 체험판이라 실제 코드 실행·파일 생성은 되지 않는다는 점을 필요할 때만 짧게 덧붙이세요.
- 과제와 무관한 요청에는 짧게 사양하고 과제로 되돌리세요.`;

async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const salt = Deno.env.get("DEMO_CHAT_SALT") || "ai-hrd-demo";
  const buf = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.messages) ? body.messages : [];

    // (1) 형식·분량 검증
    const messages = raw
      .filter((m: unknown) => m && typeof m === "object")
      .map((m: { role?: unknown; content?: unknown }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, MAX_CHARS_PER_MSG),
      }))
      .filter((m: { content: string }) => m.content.trim() !== "");

    if (messages.length === 0) return json({ error: "메시지가 비어 있습니다." }, 400);

    const userTurns = messages.filter((m: { role: string }) => m.role === "user").length;
    if (userTurns > MAX_USER_TURNS) {
      return json({ error: `체험은 ${MAX_USER_TURNS}턴까지입니다.`, limitReached: true }, 429);
    }
    const total = messages.reduce((n: number, m: { content: string }) => n + m.content.length, 0);
    if (total > MAX_TOTAL_CHARS) return json({ error: "입력이 너무 깁니다." }, 400);

    // (2) IP 별 일일 상한
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const hash = await ipHash(req);
    const { data: usage } = await service
      .from("demo_chat_usage")
      .select("turns")
      .eq("ip_hash", hash)
      .eq("day", new Date().toISOString().slice(0, 10))
      .maybeSingle();

    const used = usage?.turns ?? 0;
    if (used >= DAILY_TURNS_PER_IP) {
      return json({ error: "오늘의 체험 한도를 모두 사용했습니다. 도입 문의로 전체 기능을 확인해 주세요.", limitReached: true }, 429);
    }

    // (3) 호출
    let reply: string;
    try {
      reply = await chatCompletion({
        // temperature 는 보내지 않는다 — 일부 최신 모델이 이 파라미터를 거부한다.
        messages: [{ role: "system", content: SYSTEM }, ...messages],
        maxTokens: 500,
      });
    } catch (e) {
      if (e instanceof AiRateLimitError) return json({ error: "잠시 후 다시 시도해 주세요." }, 429);
      if (e instanceof AiPaymentRequiredError) return json({ error: "체험이 일시적으로 중단되었습니다." }, 503);
      throw e;
    }

    // 사용량 증가(실패해도 응답은 준다)
    await service.from("demo_chat_usage").upsert(
      { ip_hash: hash, day: new Date().toISOString().slice(0, 10), turns: used + 1, updated_at: new Date().toISOString() },
      { onConflict: "ip_hash,day" },
    );

    return json({ reply, turnsLeft: Math.max(0, MAX_USER_TURNS - userTurns) });
  } catch (e) {
    console.error("[demo-chat] error", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});
