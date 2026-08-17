// SMS 발송 — 네이버 클라우드 플랫폼 SENS (Simple & Easy Notification Service)
//
// 국내 발송에 해외 게이트웨이(Twilio 등)를 쓰면 건당 단가가 몇 배이고,
// 발신번호 사전등록(KISA) 체계 밖이라 통신사 스팸 필터에 걸리거나 아예
// 도달하지 않는다. 응시자 본인확인처럼 "반드시 도착해야 하는" 문자에서는
// 그 차이가 그대로 사고가 된다.
//
// 필요한 환경변수 (Supabase Edge Function Secrets)
//   NCP_ACCESS_KEY        NCP 콘솔 → 마이페이지 → 인증키 관리
//   NCP_SECRET_KEY        같은 화면
//   NCP_SENS_SERVICE_ID   SENS → Project → SMS 서비스 ID (ncp:sms:kr:...)
//   NCP_SMS_SEND_NO       사전등록·승인된 발신번호 (하이픈 없이)
//
// 설계문서 §8: 로직은 순수 모듈로, Edge Function 은 HTTP 껍데기만.

// Edge Function 런타임(Deno)이 제공하는 전역. 이 파일의 순수 헬퍼
// (normalizeKrPhone·euckrBytes)는 프런트엔드 테스트에서도 불러 쓰므로,
// 앱의 tsconfig 로 타입체크될 때 Deno 타입이 없어 깨진다. 모듈 스코프
// 선언으로 최소한만 알려 준다 — 컴파일 시 지워지고 런타임 동작은 그대로다.
declare const Deno: { env: { get(key: string): string | undefined } };

const API_HOST = "https://sens.apigw.ntruss.com";

/** SMS 는 EUC-KR 기준 90바이트(한글 45자)를 넘으면 LMS 로 넘어간다.
 *  단가가 다르므로 넘길지 자르는지를 호출부가 알고 있어야 한다. */
const SMS_MAX_BYTES = 90;

export interface SendSmsInput {
  /** 하이픈 없는 국내 번호. 예: 01012345678 */
  to: string;
  content: string;
  /** 미지정 시 NCP_SMS_SEND_NO */
  from?: string;
}

export interface SendSmsResult {
  requestId: string;
  statusName: string;
}

export class SmsConfigError extends Error {}
export class SmsSendError extends Error {}

/** EUC-KR 기준 바이트 길이. 한글·전각은 2바이트로 센다. */
export function euckrBytes(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

/** 하이픈·공백·국가번호를 떼고 01012345678 형태로 정규화 */
export function normalizeKrPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("82")) return "0" + digits.slice(2);
  return digits;
}

/** NCP API Gateway 서명 v2.
 *  StringToSign = "{METHOD} {path}\n{timestamp}\n{accessKey}" 를
 *  secretKey 로 HMAC-SHA256 서명 후 base64. 개행·공백 하나만 틀려도
 *  401 이 나고 원인이 안 보이므로 형식을 그대로 지킨다. */
export async function ncpSignature(
  method: string,
  path: string,
  timestamp: string,
  accessKey: string,
  secretKey: string,
): Promise<string> {
  const message = `${method} ${path}\n${timestamp}\n${accessKey}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const accessKey = Deno.env.get("NCP_ACCESS_KEY");
  const secretKey = Deno.env.get("NCP_SECRET_KEY");
  const serviceId = Deno.env.get("NCP_SENS_SERVICE_ID");
  const from = input.from ?? Deno.env.get("NCP_SMS_SEND_NO");

  if (!accessKey || !secretKey) throw new SmsConfigError("NCP_ACCESS_KEY / NCP_SECRET_KEY 미설정");
  if (!serviceId) throw new SmsConfigError("NCP_SENS_SERVICE_ID 미설정");
  if (!from) throw new SmsConfigError("NCP_SMS_SEND_NO 미설정 (사전등록·승인된 발신번호)");

  const to = normalizeKrPhone(input.to);
  if (!/^01[016789][0-9]{7,8}$/.test(to)) {
    throw new SmsSendError(`휴대폰 번호 형식이 올바르지 않습니다: ${input.to}`);
  }

  if (euckrBytes(input.content) > SMS_MAX_BYTES) {
    // 조용히 잘리면 인증번호가 사라진 문자가 간다. 터뜨려서 알린다.
    throw new SmsSendError(
      `본문이 SMS 한도(EUC-KR ${SMS_MAX_BYTES}바이트)를 초과했습니다. LMS 를 쓰거나 문구를 줄이세요.`,
    );
  }

  // serviceId 에 콜론이 들어가므로 경로에 그대로 쓰되, 서명 대상 경로와
  // 실제 요청 경로가 반드시 같아야 한다.
  const path = `/sms/v2/services/${serviceId}/messages`;
  const timestamp = String(Date.now());
  const signature = await ncpSignature("POST", path, timestamp, accessKey, secretKey);

  const res = await fetch(`${API_HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "x-ncp-apigw-timestamp": timestamp,
      "x-ncp-iam-access-key": accessKey,
      "x-ncp-apigw-signature-v2": signature,
    },
    body: JSON.stringify({
      type: "SMS",
      contentType: "COMM",
      countryCode: "82",
      from,
      content: input.content,
      messages: [{ to }],
    }),
  });

  // SENS 는 접수 성공에 202 를 준다. 200 만 보고 판단하면 안 된다.
  if (res.status !== 202) {
    const detail = await res.text().catch(() => "");
    throw new SmsSendError(`SENS ${res.status}: ${detail || res.statusText}`);
  }

  const json = await res.json();
  if (json?.statusName !== "success") {
    throw new SmsSendError(`SENS 접수 실패: ${json?.statusName ?? "알 수 없음"}`);
  }

  return { requestId: json?.requestId ?? "", statusName: json.statusName };
}
