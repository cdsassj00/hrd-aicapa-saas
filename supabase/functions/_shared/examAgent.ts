// 시험 에이전트 — 순수 로직.
//
// 응시자는 시험 중 이 에이전트와 자유롭게 대화하고, 에이전트는 샌드박스에서
// 명령을 돌리고 파일을 만든다. 이 제품이 파는 것은 결과물 채점이 아니라
// "과정까지 평가"이므로, 모든 턴·도구 호출·결과를 순서대로 기록한다.
//
// 이 모듈은 HTTP·DB·샌드박스 구현을 모르고, 주입받은 포트(Recorder·ExamSandbox)만
// 쓴다 — 엣지 함수는 HTTP 껍데기로 남고(CLAUDE.md), 로직은 그대로 이식 가능하다.

import {
  chatWithTools,
  type ToolChatMessage,
  type ToolSpec,
} from "./ai.ts";
import { callTool, type McpServerConfig, type McpTool } from "./mcp.ts";
import {
  MAX_FILE_BYTES,
  SandboxPathError,
  WORK_DIR,
  type ExamSandbox,
} from "./sandbox.ts";

/** 한 번의 사용자 요청에 에이전트가 돌 수 있는 도구 사이클 상한 */
export const MAX_TOOL_ROUNDS = 8;
/** 도구 결과를 모델에 돌려줄 때의 글자 상한. 컨텍스트 폭주를 막는다 */
export const MAX_TOOL_OUTPUT_CHARS = 6000;
/** 사용자 입력 한 건의 상한 */
export const MAX_USER_CHARS = 4000;

export type EventRole = "user" | "assistant" | "tool" | "system";
export type EventKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "file_write"
  | "error"
  | "notice";

/** 과정 로그 기록 포트. 구현은 엣지 함수가 service_role 로 넣는다 */
export interface Recorder {
  record(role: EventRole, kind: EventKind, content: Record<string, unknown>): Promise<void>;
}

export interface AgentContext {
  /** 응시자에게 보이는 문항 본문. 정답·루브릭은 절대 넣지 않는다 */
  questionContent: string;
  /** 문항 유형(수행형·산출물 제출 등). 안내 문구가 달라진다 */
  questionType: string;
  /** 남은 시험 시간(분). 모르면 undefined */
  minutesLeft?: number;
  /**
   * 스킬 — 이 회차에서 에이전트가 따를 추가 지시문.
   * 조직의 문서 서식 규칙, 용어 사전, 보고 양식 같은 것을 넣는다.
   * 채점 기준은 절대 넣지 않는다(응시자에게 답을 넘기는 셈이다).
   */
  skills?: Array<{ name: string; body: string }>;
  /** 작업 폴더에 미리 놓인 파일 목록. 에이전트가 처음부터 알고 시작한다 */
  files?: string[];
  /** 이 회차에 연결된 MCP 서버 이름. 응시자에게도 보이는 정보다 */
  mcpServers?: string[];
}

const SANDBOX_TOOLS: ToolSpec[] = [
  {
    name: "run_command",
    description:
      `작업 폴더(${WORK_DIR})에서 셸 명령을 실행합니다. python3·pip·node·ls·cat 등을 쓸 수 있습니다. ` +
      "파일을 만들거나 데이터를 분석할 때 사용합니다.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "실행할 셸 명령" },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: `작업 폴더에 파일을 만들거나 덮어씁니다. 경로는 ${WORK_DIR} 아래만 허용됩니다.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "작업 폴더 기준 상대 경로 (예: analysis.py)" },
        content: { type: "string", description: "파일 내용" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "작업 폴더의 파일 내용을 읽습니다.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "작업 폴더의 파일 목록을 봅니다.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "생략하면 작업 폴더 전체" } },
      additionalProperties: false,
    },
  },
];

/**
 * 웹 검색 도구.
 *
 * 샌드박스에서 직접 인터넷에 나가게 하지 않고 서버를 거친다. 이유 두 가지.
 *   · 질의와 결과가 과정 로그에 남는다 — 응시자가 무엇을 찾아봤는지가
 *     채점 자료가 된다. 샌드박스에서 curl 로 나가면 아무 기록도 남지 않는다.
 *   · 형평성 통제를 한 곳에 모은다. 다른 AI 서비스로 질문을 넘기는 것과
 *     자료를 찾는 것은 여기서 갈라진다.
 */
const WEB_SEARCH_TOOL: ToolSpec = {
  name: "web_search",
  description:
    "웹에서 자료를 검색합니다. 근거가 필요한 수치·법령·기관 자료를 찾을 때 씁니다. " +
    "결과의 출처 주소를 응시자에게 함께 알려 주십시오.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "검색어" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

/** 검색 공급자가 구성돼 있는지. 없으면 도구를 아예 노출하지 않는다 */
export function searchEnabled(): boolean {
  return !!Deno.env.get("SEARCH_API_URL") && !!Deno.env.get("SEARCH_API_KEY");
}

/**
 * 이 회차에서 에이전트가 쓸 수 있는 도구 목록.
 *
 * MCP 도구는 회차가 전원에게 동일하게 제공한다. 응시자가 각자 들고 오는 구조면
 * 측정되는 것이 능력이 아니라 준비물이 된다(0034 참고).
 */
export function buildTools(mcpTools: McpTool[] = []): ToolSpec[] {
  const tools: ToolSpec[] = [...SANDBOX_TOOLS];
  if (searchEnabled()) tools.push(WEB_SEARCH_TOOL);
  for (const t of mcpTools) {
    tools.push({
      name: t.exposedName,
      description: `[${t.server}] ${t.description}`,
      parameters: t.inputSchema,
    });
  }
  return tools;
}

/**
 * 검색 실행. Brave Search 호환 형태(GET ?q=, X-Subscription-Token)를 기본으로
 * 두되 공급자를 환경변수로 갈아 끼울 수 있게 한다 — ai.ts 와 같은 이식성 방어선.
 */
export async function runWebSearch(query: string): Promise<string> {
  const url = Deno.env.get("SEARCH_API_URL");
  const key = Deno.env.get("SEARCH_API_KEY");
  if (!url || !key) return "검색이 구성되지 않았습니다.";

  const q = query.trim().slice(0, 300);
  if (!q) return "검색어가 비었습니다.";

  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!res.ok) return `검색 실패 (${res.status})`;

  const data = await res.json().catch(() => null);
  const items = data?.web?.results ?? data?.results ?? [];
  if (!Array.isArray(items) || items.length === 0) return "검색 결과가 없습니다.";

  return items
    .slice(0, 5)
    .map((r: Record<string, unknown>, i: number) =>
      `${i + 1}. ${String(r.title ?? "")}\n   ${String(r.url ?? "")}\n   ${String(
        r.description ?? r.snippet ?? "",
      ).replace(/<[^>]*>/g, "").slice(0, 300)}`,
    )
    .join("\n");
}

export function systemPrompt(ctx: AgentContext): string {
  return [
    "당신은 AI 활용 역량평가 시험 중인 응시자를 돕는 작업 도우미입니다.",
    "응시자는 제한 시간 안에 주어진 과제를 완결해야 합니다. 당신은 샌드박스에서 명령을 실행하고 파일을 만들 수 있습니다.",
    "",
    "지켜야 할 것",
    "- 응시자가 요청한 작업을 실제로 수행하십시오. 설명만 하고 끝내지 마십시오.",
    "- 파일을 만들 때는 작업 폴더에 저장하고 어떤 파일을 만들었는지 알려 주십시오.",
    "- 데이터 처리 결과는 추측하지 말고 실행해서 확인한 값만 말하십시오.",
    "- 응시자가 무엇을 하려는지 불명확하면 먼저 한 가지만 되물으십시오.",
    "- 과제의 정답이나 채점 기준은 당신도 모릅니다. 모르는 것을 아는 척하지 마십시오.",
    "- 답변은 한국어로, 짧고 실무적으로 씁니다.",
    searchEnabled()
      ? "- 근거가 필요하면 web_search 로 찾고 출처 주소를 함께 알려 주십시오."
      : "",
    "",
    `작업 폴더: ${WORK_DIR}`,
    ctx.minutesLeft !== undefined ? `남은 시간: 약 ${ctx.minutesLeft}분` : "",
    ctx.files?.length
      ? `작업 폴더에 이미 있는 파일: ${ctx.files.join(", ")}`
      : "",
    ctx.mcpServers?.length
      ? `연결된 외부 도구: ${ctx.mcpServers.join(", ")} (mcp_ 로 시작하는 도구들)`
      : "",
    "",
    "응시자에게 주어진 과제",
    ctx.questionContent,
    ...(ctx.skills?.length
      ? [
          "",
          "이 기관에서 따라야 하는 규칙",
          ...ctx.skills.map((sk) => `## ${sk.name}\n${sk.body}`),
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
}

function clip(s: string): string {
  return s.length > MAX_TOOL_OUTPUT_CHARS
    ? `${s.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…(출력이 길어 잘렸습니다)`
    : s;
}

export interface ToolExecution {
  name: string;
  args: Record<string, unknown>;
  /** 모델에 돌려줄 문자열 */
  output: string;
  ok: boolean;
  /** 파일을 만든 경우의 경로. 산출물 목록 갱신에 쓴다 */
  writtenPath?: string;
}

/** 도구 하나를 실제로 실행한다. 실패도 모델에 알려 줘야 하므로 던지지 않는다 */
export async function runTool(
  sandbox: ExamSandbox,
  name: string,
  args: Record<string, unknown>,
  mcp: { tools: McpTool[]; servers: Map<string, McpServerConfig> } = {
    tools: [],
    servers: new Map(),
  },
): Promise<ToolExecution> {
  const base = { name, args };
  try {
    // MCP 도구는 이름으로 먼저 가른다 — 샌드박스 도구와 이름이 겹칠 일이 없도록
    // exposedToolName 이 mcp_ 접두사를 붙여 둔다.
    const mt = mcp.tools.find((t) => t.exposedName === name);
    if (mt) {
      const cfg = mcp.servers.get(mt.server);
      if (!cfg) return { ...base, output: `MCP 서버를 찾지 못했습니다: ${mt.server}`, ok: false };
      const r = await callTool(cfg, mt.remoteName, args);
      return { ...base, output: clip(r.text), ok: r.ok };
    }

    switch (name) {
      case "run_command": {
        const cmd = String(args.command ?? "").trim();
        if (!cmd) return { ...base, output: "command 가 비었습니다", ok: false };
        const r = await sandbox.runCommand(cmd);
        const parts = [`exit=${r.exitCode}`];
        if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
        if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
        return { ...base, output: clip(parts.join("\n")), ok: r.exitCode === 0 };
      }
      case "write_file": {
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        if (content.length > MAX_FILE_BYTES) {
          return { ...base, output: "파일이 너무 큽니다", ok: false };
        }
        await sandbox.writeFile(path, content);
        return {
          ...base,
          output: `${path} 에 ${content.length} 바이트를 썼습니다`,
          ok: true,
          writtenPath: path,
        };
      }
      case "read_file": {
        const text = await sandbox.readFile(String(args.path ?? ""));
        return { ...base, output: clip(text), ok: true };
      }
      case "list_files": {
        const files = await sandbox.listFiles(
          typeof args.path === "string" ? args.path : undefined,
        );
        const listing = files.length
          ? files.map((f) => `${f.isDir ? "d" : "-"} ${f.path} (${f.bytes}B)`).join("\n")
          : "(빈 폴더)";
        return { ...base, output: clip(listing), ok: true };
      }
      case "web_search": {
        const out = await runWebSearch(String(args.query ?? ""));
        return { ...base, output: clip(out), ok: true };
      }
      default:
        return { ...base, output: `알 수 없는 도구: ${name}`, ok: false };
    }
  } catch (e) {
    const msg = e instanceof SandboxPathError
      ? e.message
      : `도구 실행 실패: ${e instanceof Error ? e.message : String(e)}`;
    return { ...base, output: msg, ok: false };
  }
}

export interface TurnResult {
  reply: string;
  /** 이번 턴에 만들어진 파일 경로 */
  createdPaths: string[];
  usage: { prompt: number; completion: number };
  /** 도구 사이클 상한에 걸려 중단됐는지 */
  truncated: boolean;
}

/**
 * 사용자 발언 한 건을 처리한다. 모델이 도구를 부르면 실행해 결과를 돌려주고,
 * 모델이 더 부를 것이 없을 때까지(또는 상한까지) 반복한다.
 *
 * history 는 이전 턴의 대화다. 도구 호출·결과까지 포함해야 에이전트가
 * 자기가 만든 파일을 기억한다.
 */
export async function runTurn(args: {
  ctx: AgentContext;
  history: ToolChatMessage[];
  userText: string;
  sandbox: ExamSandbox;
  recorder: Recorder;
  model?: string;
  mcp?: { tools: McpTool[]; servers: Map<string, McpServerConfig> };
}): Promise<TurnResult> {
  const { ctx, sandbox, recorder } = args;
  const mcp = args.mcp ?? { tools: [], servers: new Map<string, McpServerConfig>() };
  const userText = args.userText.slice(0, MAX_USER_CHARS);

  await recorder.record("user", "message", { text: userText });

  const messages: ToolChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    ...args.history,
    { role: "user", content: userText },
  ];

  const createdPaths: string[] = [];
  const usage = { prompt: 0, completion: 0 };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const turn = await chatWithTools({
      messages,
      tools: buildTools(mcp.tools),
      model: args.model,
      maxTokens: 1500,
    });
    usage.prompt += turn.usage.prompt;
    usage.completion += turn.usage.completion;

    if (!turn.toolCalls.length) {
      const reply = turn.content?.trim() || "처리할 내용을 찾지 못했습니다.";
      await recorder.record("assistant", "message", { text: reply });
      return { reply, createdPaths, usage, truncated: false };
    }

    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });
    if (turn.content?.trim()) {
      await recorder.record("assistant", "message", { text: turn.content.trim() });
    }

    for (const call of turn.toolCalls) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.rawArguments || "{}");
      } catch {
        parsed = {};
      }

      await recorder.record("assistant", "tool_call", { tool: call.name, args: parsed });

      const exec = await runTool(sandbox, call.name, parsed, mcp);

      await recorder.record("tool", exec.ok ? "tool_result" : "error", {
        tool: call.name,
        ok: exec.ok,
        output: exec.output,
      });
      if (exec.writtenPath) {
        createdPaths.push(exec.writtenPath);
        await recorder.record("tool", "file_write", { path: exec.writtenPath });
      }

      messages.push({ role: "tool", toolCallId: call.id, content: exec.output });
    }
  }

  // 상한에 걸렸다. 중단 사실을 로그와 응답에 모두 남긴다 — 채점자가 왜 멈췄는지
  // 알아야 하고, 응시자도 다시 지시할 수 있어야 한다.
  const notice =
    `도구 실행을 ${MAX_TOOL_ROUNDS}회 반복해 여기서 멈췄습니다. ` +
    "작업을 더 작은 단계로 나눠 다시 지시해 주십시오.";
  await recorder.record("system", "notice", { reason: "max_tool_rounds", rounds: MAX_TOOL_ROUNDS });
  await recorder.record("assistant", "message", { text: notice });
  return { reply: notice, createdPaths, usage, truncated: true };
}

/** 저장된 과정 로그를 모델 대화 이력으로 되돌린다 */
export function historyFromEvents(
  events: Array<{ role: string; kind: string; content: Record<string, unknown> }>,
): ToolChatMessage[] {
  // 도구 호출 id 는 로그에 남기지 않는다(공급자 내부 식별자). 이력 재구성에는
  // 도구 호출을 assistant 텍스트로 눌러 담는다 — 모델이 과거에 무엇을 했는지
  // 알면 충분하고, tool_call_id 짝을 맞출 필요가 없어 형식 오류가 생기지 않는다.
  const out: ToolChatMessage[] = [];
  for (const e of events) {
    if (e.role === "user" && e.kind === "message") {
      out.push({ role: "user", content: String(e.content.text ?? "") });
    } else if (e.role === "assistant" && e.kind === "message") {
      out.push({ role: "assistant", content: String(e.content.text ?? "") });
    } else if (e.kind === "tool_call") {
      out.push({
        role: "assistant",
        content: `[도구 ${String(e.content.tool ?? "")} 실행] ${JSON.stringify(e.content.args ?? {})}`,
      });
    } else if (e.kind === "tool_result" || e.kind === "error") {
      const text = String(e.content.output ?? "");
      out.push({
        role: "user",
        content: `[도구 결과] ${text.slice(0, 1500)}`,
      });
    }
  }
  return out;
}
