// 토스페이먼츠 빌링(카드 정기결제) — 순수 로직
//
// 흐름: 브라우저에서 requestBillingAuth(카드 등록) → successUrl 로 authKey·customerKey
//       → 서버가 authKey 로 빌링키 발급 → 빌링키로 첫 달 결제 → 다음 달부터 같은 빌링키로 재결제.
//
// 필요한 환경변수 (Supabase Edge Function Secrets)
//   TOSS_SECRET_KEY   개발자센터 → API 키 → 시크릿 키 (test_sk_... / live_sk_...)
// 프런트 빌드 변수 (Cloudflare Build variables)
//   VITE_TOSS_CLIENT_KEY  같은 화면의 클라이언트 키 (test_ck_... / live_ck_...)
//
// 설계문서 §8: 로직은 순수 모듈로, Edge Function 은 HTTP 껍데기만.
// fetch 를 주입받아 Deno 전역 없이도 테스트할 수 있다.

const API_HOST = "https://api.tosspayments.com";

/** 판매 단위. 랜딩(#pricing)·환불정책(refund.html)과 반드시 같은 값이어야 한다 —
 *  카드사 심사는 "페이지에 적힌 금액 = 실제 결제 금액"을 대조한다. */
export const PRO_PLAN = {
  code: "pro",
  orderName: "AI 역량평가 Pro 월 구독 (1개월)",
  /** 공급가(부가세 별도) */
  supplyAmount: 290_000,
} as const;

/** 부가세 10% 포함 결제 금액. 원 단위 절사 없이 정수로 떨어지는 금액만 판다. */
export function withVat(supplyAmount: number): number {
  if (!Number.isInteger(supplyAmount) || supplyAmount < 0) {
    throw new Error(`invalid supply amount: ${supplyAmount}`);
  }
  return Math.round(supplyAmount * 1.1);
}

/** 결제일 기준 1개월 제공. 1/31 결제 → 2/28(말일)처럼 달 끝을 넘기지 않는다. */
export function addOneMonth(from: Date): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** 주문번호: 토스 규칙(6~64자, 영숫자·-·_)을 지키고 조직·시점별로 유일. */
export function makeOrderId(orgId: string, now: Date): string {
  const ts = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pro-${orgId.replace(/-/g, "").slice(0, 12)}-${ts}-${rand}`;
}

/** 시크릿 키 Basic 인증 헤더 — "시크릿키:" 를 base64. */
export function basicAuth(secretKey: string): string {
  return "Basic " + btoa(`${secretKey}:`);
}

export interface TossError {
  code: string;
  message: string;
}

export class TossApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

async function post<T>(fetchFn: FetchLike, secretKey: string, path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: basicAuth(secretKey),
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetchFn(`${API_HOST}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data as Partial<TossError>;
    throw new TossApiError(res.status, e.code ?? "UNKNOWN", e.message ?? `toss ${path} ${res.status}`);
  }
  return data as T;
}

export interface BillingKeyResult {
  billingKey: string;
  customerKey: string;
  cardCompany?: string;
  cardNumber?: string;
  card?: { number?: string; issuerCode?: string };
}

/** authKey(카드 등록 결과) → 빌링키 발급. */
export function issueBillingKey(fetchFn: FetchLike, secretKey: string, authKey: string, customerKey: string) {
  return post<BillingKeyResult>(fetchFn, secretKey, "/v1/billing/authorizations/issue", { authKey, customerKey });
}

export interface ChargeInput {
  billingKey: string;
  customerKey: string;
  amount: number;
  orderId: string;
  orderName: string;
  customerEmail?: string;
  customerName?: string;
}

export interface ChargeResult {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  approvedAt?: string;
  card?: { number?: string; issuerCode?: string };
}

/** 빌링키로 결제 승인. orderId 를 멱등 키로 써서 재시도가 이중결제가 되지 않게 한다. */
export function chargeBilling(fetchFn: FetchLike, secretKey: string, input: ChargeInput) {
  const { billingKey, ...body } = input;
  return post<ChargeResult>(fetchFn, secretKey, `/v1/billing/${encodeURIComponent(billingKey)}`, body, input.orderId);
}
