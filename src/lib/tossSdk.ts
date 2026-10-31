// 토스페이먼츠 결제창 SDK v2 로더.
// npm 패키지 대신 공식 CDN 스크립트를 쓴다 — 토스가 결제창 UI 를 서버 측에서 갱신하므로
// 버전 고정 번들보다 공식 로더가 카드사 정책 변경을 바로 따라간다.

const SDK_URL = 'https://js.tosspayments.com/v2/standard';

export const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY?.trim() ?? '';
/** 일반 결제(1회) MID 의 클라이언트 키. 정기결제(빌링) MID 와 다를 수 있다. 없으면 위 키를 쓴다. */
export const TOSS_PAYMENT_CLIENT_KEY = import.meta.env.VITE_TOSS_PAYMENT_CLIENT_KEY?.trim() || TOSS_CLIENT_KEY;

interface TossBillingAuthRequest {
  method: 'CARD';
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
}

interface TossPaymentRequest {
  method: 'CARD';
  amount: { currency: 'KRW'; value: number };
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
}

interface TossPaymentInstance {
  requestBillingAuth(req: TossBillingAuthRequest): Promise<void>;
  requestPayment(req: TossPaymentRequest): Promise<void>;
}

interface TossPaymentsInstance {
  payment(opts: { customerKey: string }): TossPaymentInstance;
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => TossPaymentsInstance;
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.TossPayments) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('결제 모듈을 불러오지 못했습니다.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** 카드 등록(빌링 인증) 결제창을 띄운다. 성공 시 successUrl 로 authKey·customerKey 가 붙어 돌아온다. */
export async function openBillingAuth(customerKey: string, req: Omit<TossBillingAuthRequest, 'method'>): Promise<void> {
  if (!TOSS_CLIENT_KEY) throw new Error('결제 설정(VITE_TOSS_CLIENT_KEY)이 없습니다.');
  await loadScript();
  if (!window.TossPayments) throw new Error('결제 모듈 초기화에 실패했습니다.');
  const toss = window.TossPayments(TOSS_CLIENT_KEY);
  await toss.payment({ customerKey }).requestBillingAuth({ method: 'CARD', ...req });
}

/** 일반 결제(1회) 결제창. 성공 시 successUrl 로 paymentKey·orderId·amount 가 붙어 돌아온다.
 *  금액·주문번호는 서버(seat-checkout create)가 정한 값을 그대로 넘긴다. */
export async function openPayment(req: Omit<TossPaymentRequest, 'method'>): Promise<void> {
  if (!TOSS_PAYMENT_CLIENT_KEY) throw new Error('결제 설정(VITE_TOSS_PAYMENT_CLIENT_KEY)이 없습니다.');
  await loadScript();
  if (!window.TossPayments) throw new Error('결제 모듈 초기화에 실패했습니다.');
  const toss = window.TossPayments(TOSS_PAYMENT_CLIENT_KEY);
  await toss.payment({ customerKey: crypto.randomUUID() }).requestPayment({ method: 'CARD', ...req });
}
