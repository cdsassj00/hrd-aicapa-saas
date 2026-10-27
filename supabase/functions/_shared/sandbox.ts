// 시험용 샌드박스 — 공급자 중립 래퍼.
//
// 응시자가 시험 중 코드를 돌리고 파일을 만드는 공간이다. 지금은 E2B 를 쓰지만
// 설계문서 §8 의 이식성 방어선대로 호출부(examAgent.ts)는 이 인터페이스만 본다.
// 공급자를 바꿀 때 고치는 파일은 이 하나다.
//
// 비용·보안상 반드시 지키는 것들
//   · 유휴 시 자동 일시정지(onTimeout: 'pause'). 응시자는 90분 세션에서 대부분
//     생각하고 타이핑한다 — 실제 CPU 사용은 몇 분뿐이다. 수명만 걸어 두면
//     "끊긴 브라우저가 30분을 태우는" 구조가 된다. 일시정지는 컴퓨트 과금을
//     끊고 디스크를 남기며, connect 가 다시 깨운다.
//   · 외부 송신은 기본 개방이다. 이 시험이 재는 것은 "AI 에이전트를 얼마나 잘
//     쓰는가"이고, 도구를 제한하면 제한된 환경에서의 역량만 측정된다. 실무는
//     도구를 자유롭게 쓴다. 응시자가 다른 사이트에 접속하는 문제는 브라우저
//     정책 계층에서 막는다(docs/EXAM_LOCKDOWN.md) — 에이전트 안에서가 아니다.
//     폐쇄망·공공 회차처럼 정말 좁혀야 할 때만 SANDBOX_EGRESS=allowlist 로
//     바꾼다. 무엇을 했는지는 과정 로그가 남긴다.
//   · 작업 디렉터리를 WORK_DIR 하나로 고정하고 경로를 그 밖으로 못 나가게 막는다.
//   · 명령 실행에 개별 타임아웃을 건다.

import { Sandbox } from "npm:e2b@2.55.0";

/** 응시자 작업 디렉터리. 산출물 수집도 이 아래만 훑는다 */
export const WORK_DIR = "/home/user/work";

/**
 * 유휴 허용 시간. 이 시간 동안 요청이 없으면 샌드박스가 스스로 일시정지한다.
 * 요청마다 touch() 로 다시 늘린다 — 작업 중인 응시자는 멈추지 않고,
 * 창을 닫고 가 버린 응시자는 컴퓨트 과금이 끊긴다.
 */
export const SANDBOX_IDLE_MS = 10 * 60 * 1000;

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
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
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

    async writeBytes(path: string, bytes: Uint8Array) {
      // 응시자가 올린 파일. 텍스트로 가정하면 xlsx·zip 이 깨진다.
      await sbx.files.write(resolveWorkPath(path), bytes.buffer as ArrayBuffer);
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
      await sbx.setTimeout(SANDBOX_IDLE_MS);
    },

    async dispose() {
      await sbx.kill();
    },
  };
}

/**
 * allowlist 모드에서만 쓰는 기본 허용 호스트 — 패키지 저장소와 공개 데이터 출처.
 * 기본(open) 모드에서는 쓰이지 않는다.
 */
const DEFAULT_ALLOW_OUT = [
  // 패키지 — 커스텀 템플릿에 없는 것을 응시 중 설치할 수 있게 둔다
  "pypi.org",
  "files.pythonhosted.org",
  // 공개 데이터·법령·통계
  "www.data.go.kr",
  "data.go.kr",
  "kosis.kr",
  "www.law.go.kr",
  "law.go.kr",
  "kostat.go.kr",
];

/**
 * 외부 송신 정책. 기본은 개방이다.
 *
 * SANDBOX_EGRESS=allowlist 로 바꾸면 DEFAULT_ALLOW_OUT + SANDBOX_ALLOW_OUT 만
 * 열린다. 폐쇄망 반입 회차나 공공 조달처럼 송신 범위를 증빙해야 하는 경우에만
 * 쓴다. 도메인 매칭은 HTTP(:80) Host 헤더와 TLS(:443) SNI 로 동작하므로 다른
 * 포트를 열려면 IP·CIDR 로 적어야 한다.
 */
function networkPolicy(mode?: string) {
  const m = (mode ?? Deno.env.get("SANDBOX_EGRESS") ?? "open").trim().toLowerCase();
  if (m !== "allowlist") return {};
  const extra = (Deno.env.get("SANDBOX_ALLOW_OUT") ?? "")
    .split(",").map((h) => h.trim()).filter(Boolean);
  return { allowOut: [...new Set([...DEFAULT_ALLOW_OUT, ...extra])] };
}

/** 새 샌드박스를 띄운다. metadata 는 E2B 대시보드에서 추적용 */
export async function createSandbox(
  metadata: Record<string, string>,
  egressMode?: string,
): Promise<ExamSandbox> {
  const template = Deno.env.get("E2B_TEMPLATE")?.trim();
  const sbx = await Sandbox.create({
    apiKey: apiKey(),
    ...(template ? { template } : {}),
    // 유휴 10분이면 스스로 멈춘다. kill 이 아니라 pause 여야 작업 파일이 남는다.
    timeoutMs: SANDBOX_IDLE_MS,
    onTimeout: "pause",
    metadata,
    network: networkPolicy(egressMode),
  });
  await sbx.commands.run(`mkdir -p ${WORK_DIR}`);
  return wrap(sbx);
}

/**
 * 기존 샌드박스에 다시 붙는다. 일시정지된 샌드박스는 connect 가 깨운다.
 * 완전히 사라진 샌드박스면 던진다 — 호출부가 새로 띄우고 만료를 알린다.
 */
export async function connectSandbox(sandboxId: string): Promise<ExamSandbox> {
  const sbx = await Sandbox.connect(sandboxId, {
    apiKey: apiKey(),
    timeoutMs: SANDBOX_IDLE_MS,
  });
  return wrap(sbx);
}
