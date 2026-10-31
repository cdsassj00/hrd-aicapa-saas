// Safe Exam Browser(SEB) 연동 — 설정 파일(.seb) 생성과 Config Key 계산.
//
// 흐름
//   1) 관리자가 시험에 "SEB 필수"를 켜면, 이 모듈이 그 시험용 .seb 설정을 만든다
//      (시작 URL = 우리 앱, URL 필터 = 우리 도메인 화이트리스트, 웹캠·마이크 허용, 모니터 1대).
//   2) 같은 설정으로 Config Key(SHA-256)를 계산해 exams.seb_config_keys 에 저장한다.
//   3) SEB 안의 페이지는 SafeExamBrowser.security.configKey = SHA256(현재 URL + Config Key) 를 준다.
//      문항 RPC(get_exam_questions_for_session)가 이 값을 서버에서 재계산해 비교한다.
//
// Config Key 규칙(SEB 문서 "Config Key" / Moodle quizaccess_seb 와 동일):
//   originatorVersion 제외 → 딕셔너리 키를 대소문자 무시 알파벳순 정렬(재귀) →
//   공백 없는 JSON(슬래시·유니코드 이스케이프 안 함) → UTF-8 SHA-256 hex.
//
// 외부 의존성 없는 순수 TS — 필요하면 그대로 Edge Function(_shared)으로 옮길 수 있다 (설계문서 §8).

export type SebValue = string | number | boolean | SebValue[] | { [k: string]: SebValue };
export type SebSettings = { [k: string]: SebValue };

export interface SebOptions {
  /** 앱 origin (예: https://app.ai-hrd.com). 시작 URL·화이트리스트의 기준. */
  origin: string;
  /** 추가로 허용할 호스트 (와일드카드 가능, 예: "*.supabase.co") */
  extraHosts?: string[];
}

/** 시험용 SEB 설정. 같은 입력이면 항상 같은 결과(= 같은 Config Key)가 나와야 한다. */
export function buildSebSettings(opts: SebOptions): SebSettings {
  const origin = opts.origin.replace(/\/+$/, "");
  const host = new URL(origin).host;
  const hosts = [host, "*.supabase.co", ...(opts.extraHosts ?? [])];
  const uniq = [...new Set(hosts)];
  return {
    originatorVersion: "AI-HRD-SEB-1",
    sebConfigPurpose: 0, // 0 = 시험 시작용
    startURL: `${origin}/applicant`,
    sendBrowserExamKey: true,
    allowQuit: true,
    quitURL: `${origin}/applicant/submitted`,
    quitURLConfirm: false,
    browserWindowAllowReload: true,
    allowPreferencesWindow: false,
    allowSpellCheck: false,
    enablePrivateClipboard: true,
    allowedDisplaysMaxNumber: 1,
    // 감독(웹캠·마이크) — Windows / macOS 키가 다르다
    allowVideoCapture: true,
    allowAudioCapture: true,
    browserMediaCaptureCamera: true,
    browserMediaCaptureMicrophone: true,
    // 페이지 이동 화이트리스트. 하위 리소스(API·영상)는 막지 않는다.
    URLFilterEnable: true,
    URLFilterEnableContentFilter: false,
    URLFilterRules: uniq.map((expression) => ({ action: 1, active: true, expression, regex: false })),
  };
}

const cmpKey = (a: string, b: string) => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** Config Key 계산용 정규화 JSON. */
export function sebKeyJson(v: SebValue): string {
  if (Array.isArray(v)) return `[${v.map(sebKeyJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v).sort(cmpKey).map((k) => `${JSON.stringify(k)}:${sebKeyJson(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sebConfigKey(settings: SebSettings): Promise<string> {
  const { originatorVersion: _ignored, ...rest } = settings;
  return sha256Hex(sebKeyJson(rest));
}

/** SEB 가 페이지에 주는 값과 같은 식: SHA256(URL + ConfigKey). URL 은 # 앞까지. */
export async function sebRequestHash(url: string, configKey: string): Promise<string> {
  return sha256Hex(url.split("#")[0] + configKey);
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plistValue(v: SebValue, ind: string): string {
  if (typeof v === "boolean") return `${ind}<${v}/>`;
  if (typeof v === "number") return `${ind}<integer>${Math.trunc(v)}</integer>`;
  if (typeof v === "string") return `${ind}<string>${xmlEsc(v)}</string>`;
  if (Array.isArray(v)) {
    if (!v.length) return `${ind}<array/>`;
    return `${ind}<array>\n${v.map((x) => plistValue(x, ind + "\t")).join("\n")}\n${ind}</array>`;
  }
  const keys = Object.keys(v).sort(cmpKey);
  if (!keys.length) return `${ind}<dict/>`;
  return `${ind}<dict>\n${keys.map((k) => `${ind}\t<key>${xmlEsc(k)}</key>\n${plistValue(v[k], ind + "\t")}`).join("\n")}\n${ind}</dict>`;
}

/** 암호화하지 않은 .seb (XML plist). SEB 가 더블클릭으로 연다. */
export function sebPlist(settings: SebSettings): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${plistValue(settings, "")}
</plist>
`;
}

/** 관리자가 붙여 넣은 Config Key 목록 정리 (64자리 hex 만). */
export function parseSebKeys(text: string): string[] {
  return [...new Set((text.match(/[0-9a-fA-F]{64}/g) ?? []).map((k) => k.toLowerCase()))];
}

// ─── 브라우저 쪽 ──────────────────────────────────────────────────────────────

interface SebJsApi {
  security?: {
    configKey?: string;
    browserExamKey?: string;
    updateKeys?: (cb: () => void) => void;
  };
  version?: string;
}

function sebApi(): SebJsApi | undefined {
  return (globalThis as unknown as { SafeExamBrowser?: SebJsApi }).SafeExamBrowser;
}

/** 지금 페이지가 Safe Exam Browser 안에서 열렸는가. */
export function isInSeb(): boolean {
  if (sebApi()) return true;
  return typeof navigator !== "undefined" && /\bSEB\//.test(navigator.userAgent);
}

/** 서버 검증용 값. SEB 가 아니거나 JS API 가 없으면 null. SPA 이동 후 값을 갱신하려고 updateKeys 를 부른다. */
export async function getSebProof(): Promise<{ url: string; hash: string } | null> {
  const api = sebApi();
  if (!api?.security) return null;
  const sec = api.security;
  if (typeof sec.updateKeys === "function") {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1500);
      try { sec.updateKeys!(() => { clearTimeout(t); resolve(); }); } catch { clearTimeout(t); resolve(); }
    });
  }
  const hash = sec.configKey;
  if (!hash) return null;
  return { url: window.location.href.split("#")[0], hash };
}

/** 이 origin 기준 .seb 설정과 Config Key. */
export async function sebForOrigin(origin: string) {
  const settings = buildSebSettings({ origin });
  return { settings, configKey: await sebConfigKey(settings), plist: sebPlist(settings) };
}

/** .seb 파일 내려받기 (응시자·관리자 공용). */
export async function downloadSebFile(origin: string, fileName = "ai-hrd-exam.seb") {
  const { plist } = await sebForOrigin(origin);
  const blob = new Blob([plist], { type: "application/seb" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const SEB_DOWNLOAD_URL = "https://safeexambrowser.org/download_en.html";
