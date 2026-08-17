// AI 채팅 호출 — 공급자 중립.
//
// 원본은 https://ai.gateway.lovable.dev/v1/chat/completions 에 LOVABLE_API_KEY 로
// 붙었다. 러버블 계정에 묶인 경로라 이 프로젝트에서는 동작하지 않는다.
//
// 엔드포인트가 OpenAI 호환 형식이었으므로, 같은 형식을 쓰는 어떤 공급자로도
// 환경변수만 바꿔 붙일 수 있게 남긴다. 이게 설계문서 §8 의 이식성 방어선이다.
//
//   AI_BASE_URL  기본 https://api.openai.com/v1
//   AI_API_KEY   필수
//   AI_MODEL     기본 gpt-4o-mini (호출부에서 개별 지정 가능)
//
// Anthropic 을 쓰려면 OpenAI 호환 프록시를 두거나 이 모듈에 어댑터를 하나 더
// 추가하면 된다 — 호출부(채점·문구 정리)는 손대지 않는다.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  /** 응답을 JSON 객체로 강제 (채점 결과 파싱용) */
  jsonMode?: boolean;
}

export class AiRateLimitError extends Error {}
export class AiPaymentRequiredError extends Error {}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const apiKey = Deno.env.get("AI_API_KEY");
  if (!apiKey) throw new Error("AI_API_KEY is not configured");

  const baseUrl = (Deno.env.get("AI_BASE_URL") ?? "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const model = opts.model ?? Deno.env.get("AI_MODEL") ?? "gpt-4o-mini";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  // 호출부가 이미 429/402 를 구분해 처리하고 있어 타입을 나눠 던진다
  if (res.status === 429) throw new AiRateLimitError("AI 요청이 한도를 초과했습니다");
  if (res.status === 402) throw new AiPaymentRequiredError("AI 크레딧이 부족합니다");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("AI 응답에서 본문을 찾지 못했습니다");
  return text;
}
