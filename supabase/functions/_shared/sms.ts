// SMS 발송 — NHN Cloud SMS.
//
// 국내 발송에 해외 게이트웨이(Twilio 등)를 쓰면 건당 단가가 몇 배이고,
// 발신번호 사전등록(KISA) 체계 밖이라 통신사 스팸 필터에 걸리거나 아예
// 도달하지 않는다. 응시자 본인확인처럼 "반드시 도착해야 하는" 문자에서는
// 이 차이가 그대로 사고가 된다.
//
// 필요한 환경변수 (Supabase Edge Function Secrets)
//   NHN_SMS_APP_KEY      콘솔 → SMS → URL & AppKey
//   NHN_SMS_SECRET_KEY   같은 화면의 SecretKey
//   NHN_SMS_SEND_NO      사전등록한 발신번호 (하이픈 없이)
//
// 설계문서 §8: 로직은 순수 모듈로, Edge Function 은 HTTP 껍데기만.

// Edge Function 런타임(Deno)이 제공하는 전역. 이 파일의 순수 헬퍼
// (normalizeKrPhone·euckrBytes)는 프런트엔드 테스트에서도 불러 쓰므로,
// 앱의 tsconfig 로 타입체크될 때 Deno 타입이 없어 깨진다. 모듈 스코프
// 선언으로 최소한만 알려 준다 — 컴파일 시 지워지고 런타임 동작은 그대로다.
declare const Deno: { env: { get(key: string): string | undefined } };

const API_BASE = "https://api-sms.cloud.toast.com/sms/v3.0";

/** SMS 는 EUC-KR 기준 90바이트(한글 45자)를 넘으면 LMS 로 넘어간다.
 *  단가가 다르므로 넘길지 자르는지를 호출부가 알고 있어야 한다. */
const SMS_MAX_BYTES = 90;

export interface SendSmsInput {
  /** 하이픈 없는 국내 번호. 예: 01012345678 */
  to: string;
  body: string;
  /** 미지정 시 NHN_SMS_SEND_NO */
  from?: string;
}

export interface SendSmsResult {
  requestId: string;
  statusCode: string;
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

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const appKey = Deno.env.get("NHN_SMS_APP_KEY");
  const secretKey = Deno.env.get("NHN_SMS_SECRET_KEY");
  const sendNo = input.from ?? Deno.env.get("NHN_SMS_SEND_NO");

  if (!appKey || !secretKey) throw new SmsConfigError("NHN_SMS_APP_KEY / NHN_SMS_SECRET_KEY 미설정");
  if (!sendNo) throw new SmsConfigError("NHN_SMS_SEND_NO 미설정 (사전등록한 발신번호)");

  const recipientNo = normalizeKrPhone(input.to);
  if (!/^01[016789][0-9]{7,8}$/.test(recipientNo)) {
    throw new SmsSendError(`휴대폰 번호 형식이 올바르지 않습니다: ${input.to}`);
  }

  if (euckrBytes(input.body) > SMS_MAX_BYTES) {
    // 조용히 잘리면 인증코드가 사라진 문자가 간다. 터뜨려서 알린다.
    throw new SmsSendError(
      `본문이 SMS 한도(EUC-KR ${SMS_MAX_BYTES}바이트)를 초과했습니다. LMS 를 쓰거나 문구를 줄이세요.`,
    );
  }

  const res = await fetch(`${API_BASE}/appKeys/${appKey}/sender/sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Secret-Key": secretKey,
    },
    body: JSON.stringify({
      body: input.body,
      sendNo,
      recipientList: [{ recipientNo }],
    }),
  });

  if (!res.ok) {
    throw new SmsSendError(`NHN SMS HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  // NHN 은 HTTP 200 을 주면서 header.isSuccessful=false 로 실패를 알린다.
  // 여기를 안 보면 "보냈다"고 착각한 채 문자가 안 간다.
  const json = await res.json();
  if (!json?.header?.isSuccessful) {
    throw new SmsSendError(
      `NHN SMS ${json?.header?.resultCode}: ${json?.header?.resultMessage ?? "알 수 없는 오류"}`,
    );
  }

  return {
    requestId: json?.body?.data?.requestId ?? "",
    statusCode: json?.body?.data?.statusCode ?? "",
  };
}
