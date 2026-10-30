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
  /** 응답 토큰 상한 — 공개 데모처럼 비용이 노출되는 호출에서 반드시 건다 */
  maxTokens?: number;
}

export class AiRateLimitError extends Error {}
export class AiPaymentRequiredError extends Error {}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const apiKey = Deno.env.get("AI_API_KEY");
  if (!apiKey) throw new Error("AI_API_KEY is not configured");

  const baseUrl = (Deno.env.get("AI_BASE_URL") ?? "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const model = opts.model ?? Deno.env.get("AI_MODEL") ?? "gpt-4o-mini";

  // 모델마다 토큰 상한 파라미터 이름이 다르다(max_tokens / max_completion_tokens).
  // 400 을 받으면 반대쪽 이름으로 한 번 재시도한다.
  // jsonMode 는 response_format=json_object 로 요청한다. 공급자에 따라 이 형식을
  // 받지 않는다(예: "response_format.type: Input should be 'json_schema'" 400 —
  // AI 문항 생성이 이 때문에 전부 실패했다). 그때는 빼고 다시 부르고, 본문에서
  // JSON 만 골라낸다(프롬프트가 이미 JSON 만 내라고 지시한다).
  let useResponseFormat = Boolean(opts.jsonMode);
  const call = async (tokenParam: "max_tokens" | "max_completion_tokens") => {
    return await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { [tokenParam]: opts.maxTokens } : {}),
        ...(useResponseFormat ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  };

  let res = await call("max_tokens");
  if (res.status === 400 && useResponseFormat) {
    const detail = await res.clone().text().catch(() => "");
    if (detail.includes("response_format")) {
      useResponseFormat = false;
      res = await call("max_tokens");
    }
  }
  if (res.status === 400 && opts.maxTokens !== undefined) {
    const detail = await res.clone().text().catch(() => "");
    if (detail.includes("max_completion_tokens") || detail.includes("max_tokens")) {
      res = await call("max_completion_tokens");
    }
  }

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
  return opts.jsonMode ? extractJson(text) : text;
}

/** 응답 본문에서 JSON 부분만 남긴다(```json 펜스나 앞뒤 설명문 제거). 못 찾으면 원문. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const starts = [body.indexOf("{"), body.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) return body;
  const start = Math.min(...starts);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return end > start ? body.slice(start, end + 1) : body;
}

// ---------------------------------------------------------------------------
// 도구 호출(tool calling) — 시험 에이전트가 쓴다.
//
// chatCompletion 은 본문 문자열만 돌려주므로 도구 호출을 표현할 수 없다.
// 형식은 OpenAI 호환 그대로 두어 공급자 교체 지점을 한 곳으로 유지한다.
// ---------------------------------------------------------------------------

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema. 공급자에 그대로 전달된다 */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** 모델이 만든 인자. JSON 파싱 실패 가능성을 호출부가 다룬다 */
  rawArguments: string;
}

/** 대화 이력의 한 항목. tool 역할은 tool_call_id 가 반드시 있어야 한다 */
export type ToolChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolTurn {
  content: string | null;
  toolCalls: ToolCall[];
  usage: { prompt: number; completion: number };
  /** 모델이 왜 멈췄는지. "length" 면 토큰 상한에 잘린 것이다 */
  finishReason: string | null;
}

function toWire(m: ToolChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content,
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: c.rawArguments },
            })),
          }
        : {}),
    };
  }
  return { role: m.role, content: m.content };
}

export async function chatWithTools(opts: {
  messages: ToolChatMessage[];
  tools: ToolSpec[];
  model?: string;
  maxTokens?: number;
}): Promise<ToolTurn> {
  const apiKey = Deno.env.get("AI_API_KEY");
  if (!apiKey) throw new Error("AI_API_KEY is not configured");

  const baseUrl = (Deno.env.get("AI_BASE_URL") ?? "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const model = opts.model ?? Deno.env.get("AI_MODEL") ?? "gpt-4o-mini";

  const body = (tokenParam: "max_tokens" | "max_completion_tokens") => ({
    model,
    messages: opts.messages.map(toWire),
    tools: opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    tool_choice: "auto",
    ...(opts.maxTokens !== undefined ? { [tokenParam]: opts.maxTokens } : {}),
  });

  const call = (tokenParam: "max_tokens" | "max_completion_tokens") =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body(tokenParam)),
    });

  let res = await call("max_tokens");
  if (res.status === 400 && opts.maxTokens !== undefined) {
    const detail = await res.clone().text().catch(() => "");
    if (detail.includes("max_completion_tokens") || detail.includes("max_tokens")) {
      res = await call("max_completion_tokens");
    }
  }

  if (res.status === 429) throw new AiRateLimitError("AI 요청이 한도를 초과했습니다");
  if (res.status === 402) throw new AiPaymentRequiredError("AI 크레딧이 부족합니다");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  const choice = data?.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  const calls: ToolCall[] = Array.isArray(msg.tool_calls)
    ? msg.tool_calls
        .filter((c: Record<string, unknown>) => c?.function)
        .map((c: Record<string, never>) => ({
          id: String(c.id ?? crypto.randomUUID()),
          name: String((c.function as Record<string, unknown>).name ?? ""),
          rawArguments: String((c.function as Record<string, unknown>).arguments ?? "{}"),
        }))
    : [];

  return {
    content: typeof msg.content === "string" ? msg.content : null,
    toolCalls: calls,
    usage: {
      prompt: Number(data?.usage?.prompt_tokens ?? 0),
      completion: Number(data?.usage?.completion_tokens ?? 0),
    },
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  };
}
