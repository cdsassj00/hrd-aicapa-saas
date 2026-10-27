// MCP 클라이언트 — 시험 에이전트가 외부 도구를 쓰기 위한 최소 구현.
//
// 왜 SDK 를 안 쓰고 직접 짰나
//   엣지 함수는 요청마다 새로 뜬다. 무거운 의존성은 콜드스타트에 그대로 얹힌다.
//   우리가 쓰는 것은 Streamable HTTP 전송의 tools/list 와 tools/call 둘뿐이고,
//   그건 JSON-RPC POST 몇 번이다. stdio 전송은 지원하지 않는다(샌드박스 밖에서
//   프로세스를 띄울 일이 없다).
//
// 보안·비용 방어선
//   · 토큰을 DB 에 두지 않는다. org_mcp_servers 에는 시크릿 "이름"만 두고 값은
//     Deno.env 에서 읽는다. DB 가 새도 토큰은 안 샌다.
//   · 응답 크기와 시간에 상한을 건다. 외부 서버가 느리거나 거대한 응답을 주면
//     시험이 거기서 멈춘다.
//   · 도구 이름을 공급자 규격(^[a-zA-Z0-9_-]{1,64}$)으로 정규화한다. 안 그러면
//     모델 호출이 통째로 400 으로 떨어진다.

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_CHARS = 200_000;
/** 서버 하나가 노출할 수 있는 도구 수. 한 서버가 도구 목록을 다 먹지 못하게 */
const MAX_TOOLS_PER_SERVER = 20;

export interface McpServerConfig {
  /** 화면·로그에 쓰는 짧은 이름. 도구 이름 접두사로도 쓰인다 */
  name: string;
  url: string;
  /** Authorization 헤더에 넣을 값이 담긴 환경변수 이름. 없으면 익명 접속 */
  secretEnv?: string | null;
}

export interface McpTool {
  /** 모델에 노출되는 이름: mcp_<서버>_<도구> */
  exposedName: string;
  /** 서버가 쓰는 원래 이름 */
  remoteName: string;
  server: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpError extends Error {}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
}

/** 모델 공급자가 받는 도구 이름 규격으로 맞춘다 */
export function exposedToolName(server: string, tool: string): string {
  return `mcp_${slug(server)}_${slug(tool)}`.slice(0, 64);
}

/**
 * Streamable HTTP 한 번 왕복. 응답이 SSE 로 와도 JSON-RPC 본문을 꺼낸다.
 * (서버는 Accept 헤더를 보고 application/json 또는 text/event-stream 으로 답한다.)
 */
async function rpc(
  cfg: McpServerConfig,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ result?: unknown; error?: { message?: string }; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  if (cfg.secretEnv) {
    const token = Deno.env.get(cfg.secretEnv);
    if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }

  const res = await fetch(cfg.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const newSession = res.headers.get("Mcp-Session-Id") ?? sessionId;

  // 알림(notification)은 id 가 없고 서버가 202 로 답한다 — 본문이 없다.
  if (res.status === 202) return { sessionId: newSession ?? undefined };

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    throw new McpError(`MCP ${cfg.name} ${res.status}: ${detail || res.statusText}`);
  }

  const text = (await res.text()).slice(0, MAX_RESPONSE_CHARS);
  const ct = res.headers.get("content-type") ?? "";

  let payload: Record<string, unknown> | null = null;
  if (ct.includes("text/event-stream")) {
    // SSE: data: 줄만 모아 마지막 JSON-RPC 응답을 쓴다.
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try {
        const obj = JSON.parse(t.slice(5).trim());
        if (obj && typeof obj === "object" && "id" in obj) payload = obj;
      } catch { /* 부분 프레임은 건너뛴다 */ }
    }
  } else {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new McpError(`MCP ${cfg.name}: JSON 응답을 해석하지 못했습니다`);
    }
  }
  if (!payload) throw new McpError(`MCP ${cfg.name}: 응답이 비었습니다`);
  return { ...payload, sessionId: newSession ?? undefined } as never;
}

/** initialize → initialized. 세션 id 를 돌려준다 */
async function handshake(cfg: McpServerConfig): Promise<string | undefined> {
  const init = await rpc(cfg, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "hrd-exam-agent", version: "1.0.0" },
    },
  });
  if (init.error) throw new McpError(`MCP ${cfg.name} initialize: ${init.error.message ?? ""}`);
  const sid = init.sessionId;
  await rpc(cfg, { jsonrpc: "2.0", method: "notifications/initialized" }, sid).catch(() => {});
  return sid;
}

/** 서버가 노출하는 도구 목록. 실패하면 던진다 — 호출부가 회차를 막지 않고 건너뛴다 */
export async function listTools(
  cfg: McpServerConfig,
): Promise<{ tools: McpTool[]; sessionId?: string }> {
  const sid = await handshake(cfg);
  const out = await rpc(cfg, { jsonrpc: "2.0", id: 2, method: "tools/list" }, sid);
  if (out.error) throw new McpError(`MCP ${cfg.name} tools/list: ${out.error.message ?? ""}`);

  const raw = (out.result as { tools?: unknown[] } | undefined)?.tools ?? [];
  const tools: McpTool[] = [];
  for (const t of raw.slice(0, MAX_TOOLS_PER_SERVER)) {
    const o = t as Record<string, unknown>;
    const remoteName = String(o.name ?? "");
    if (!remoteName) continue;
    tools.push({
      exposedName: exposedToolName(cfg.name, remoteName),
      remoteName,
      server: cfg.name,
      description: String(o.description ?? remoteName).slice(0, 500),
      inputSchema:
        (o.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    });
  }
  return { tools, sessionId: sid };
}

/** 도구 하나 실행. 결과를 사람이 읽을 수 있는 텍스트로 눌러 담는다 */
export async function callTool(
  cfg: McpServerConfig,
  remoteName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const sid = await handshake(cfg);
  const out = await rpc(
    cfg,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: remoteName, arguments: args } },
    sid,
  );
  if (out.error) return { ok: false, text: `MCP 오류: ${out.error.message ?? "알 수 없음"}` };

  const r = out.result as { content?: unknown[]; isError?: boolean } | undefined;
  const parts: string[] = [];
  for (const c of r?.content ?? []) {
    const o = c as Record<string, unknown>;
    if (o.type === "text") parts.push(String(o.text ?? ""));
    else if (o.type === "resource") parts.push(JSON.stringify(o.resource ?? {}));
    else parts.push(`[${String(o.type ?? "unknown")}]`);
  }
  const text = parts.join("\n").trim() || JSON.stringify(r ?? {}).slice(0, 2000);
  return { ok: !r?.isError, text };
}
