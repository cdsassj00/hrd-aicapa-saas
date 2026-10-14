// 시험용 샌드박스 — 공급자 중립 래퍼.
//
// 응시자가 시험 중 코드를 돌리고 파일을 만드는 공간이다. 지금은 E2B 를 쓰지만
// 설계문서 §8 의 이식성 방어선대로 호출부(examAgent.ts)는 이 인터페이스만 본다.
// 공급자를 바꿀 때 고치는 파일은 이 하나다.
//
// 비용·보안상 반드시 지키는 것들
//   · 수명(timeoutMs)을 항상 건다. 끊긴 브라우저가 샌드박스를 영구히 붙잡지 못한다.
//   · 작업 디렉터리를 WORK_DIR 하나로 고정하고 경로를 그 밖으로 못 나가게 막는다.
//   · 명령 실행에 개별 타임아웃을 건다.

import { Sandbox } from "npm:e2b@2.55.0";

/** 응시자 작업 디렉터리. 산출물 수집도 이 아래만 훑는다 */
export const WORK_DIR = "/home/user/work";

/** 샌드박스 수명. 시험 1문항 기준. 필요하면 touch() 로 연장한다 */
export const SANDBOX_TTL_MS = 30 * 60 * 1000;

/** 명령 하나의 상한. 무한 루프가 샌드박스를 점유하지 못하게 한다 */
export const COMMAND_TIMEOUT_MS = 60 * 1000;

/** 파일 읽기·전달 상한. 모델 컨텍스트와 응답 크기를 지킨다 */
export const MAX_FILE_BYTES = 256 * 1024;

export interface SandboxFile {
  path: string;
  name: string;
  bytes: number;
  isDir: boolean;
}

export interface CommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExamSandbox {
  readonly id: string;
  runCommand(cmd: string): Promise<CommandOutcome>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  listFiles(path?: string): Promise<SandboxFile[]>;
  downloadFile(path: string): Promise<Uint8Array>;
  touch(): Promise<void>;
  dispose(): Promise<void>;
}

export class SandboxPathError extends Error {}

/**
 * 응시자가 준 경로를 작업 디렉터리 안으로 가둔다.
 * `..` 로 올라가거나 절대 경로로 /etc 를 읽는 것을 막는다.
 */
export function resolveWorkPath(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) throw new SandboxPathError("경로가 비었습니다");

  const joined = raw.startsWith("/") ? raw : `${WORK_DIR}/${raw}`;
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const normalized = `/${parts.join("/")}`;
  if (normalized !== WORK_DIR && !normalized.startsWith(`${WORK_DIR}/`)) {
    throw new SandboxPathError(`작업 폴더(${WORK_DIR}) 밖의 경로는 쓸 수 없습니다`);
  }
  return normalized;
}

function apiKey(): string {
  const key = Deno.env.get("E2B_API_KEY");
  if (!key) throw new Error("E2B_API_KEY is not configured");
  return key;
}

function wrap(sbx: Sandbox): ExamSandbox {
  return {
    id: sbx.sandboxId,

    async runCommand(cmd: string) {
      // 셸을 통째로 주되 작업 디렉터리를 고정한다. 응시자가 자유롭게 쓰는 것이
      // 이 제품의 평가 대상이므로 명령 자체를 화이트리스트로 막지 않는다 —
      // 격리는 샌드박스가 담당한다.
      const r = await sbx.commands.run(cmd, {
        cwd: WORK_DIR,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return { exitCode: r.exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },

    async writeFile(path: string, content: string) {
      await sbx.files.write(resolveWorkPath(path), content);
    },

    async readFile(path: string) {
      const text = await sbx.files.read(resolveWorkPath(path));
      const s = typeof text === "string" ? text : String(text);
      return s.length > MAX_FILE_BYTES
        ? `${s.slice(0, MAX_FILE_BYTES)}\n…(이하 생략: 파일이 ${MAX_FILE_BYTES} 바이트를 넘습니다)`
        : s;
    },

    async listFiles(path?: string) {
      const target = resolveWorkPath(path ?? WORK_DIR);
      const entries = await sbx.files.list(target);
      return entries.map((e) => ({
        path: e.path,
        name: e.name,
        bytes: Number(e.size ?? 0),
        isDir: e.type === "dir",
      }));
    },

    async downloadFile(path: string) {
      const buf = await sbx.files.read(resolveWorkPath(path), { format: "bytes" });
      return buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer);
    },

    async touch() {
      await sbx.setTimeout(SANDBOX_TTL_MS);
    },

    async dispose() {
      await sbx.kill();
    },
  };
}

/** 새 샌드박스를 띄운다. metadata 는 E2B 대시보드에서 추적용 */
export async function createSandbox(metadata: Record<string, string>): Promise<ExamSandbox> {
  const sbx = await Sandbox.create({
    apiKey: apiKey(),
    timeoutMs: SANDBOX_TTL_MS,
    metadata,
  });
  await sbx.commands.run(`mkdir -p ${WORK_DIR}`);
  return wrap(sbx);
}

/** 기존 샌드박스에 다시 붙는다. 수명이 지났으면 던진다 */
export async function connectSandbox(sandboxId: string): Promise<ExamSandbox> {
  const sbx = await Sandbox.connect(sandboxId, { apiKey: apiKey() });
  return wrap(sbx);
}
