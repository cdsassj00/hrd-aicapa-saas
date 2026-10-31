import { describe, expect, it, vi } from 'vitest';
// Edge Function 의 순수 결제 로직. fetch 를 주입받으므로 네트워크 없이 검증한다.
import {
  PRO_PLAN, SEAT_PRODUCT, TossApiError, addOneMonth, basicAuth, chargeBilling, confirmPayment, issueBillingKey,
  makeOrderId, makeSeatOrderId, seatAmount, seatOrderName, withVat,
} from '../../supabase/functions/_shared/tossBilling';

describe('withVat', () => {
  it('Pro 공급가 290,000원 → 결제 금액 319,000원 (랜딩·환불정책 표기와 일치)', () => {
    expect(withVat(PRO_PLAN.supplyAmount)).toBe(319_000);
  });
  it('음수·소수 공급가는 거부한다', () => {
    expect(() => withVat(-1)).toThrow();
    expect(() => withVat(1.5)).toThrow();
  });
});

describe('addOneMonth', () => {
  it('같은 날짜로 한 달 뒤', () => {
    expect(addOneMonth(new Date('2026-10-13T06:00:00Z')).toISOString()).toBe('2026-11-13T06:00:00.000Z');
  });
  it('말일 결제는 다음 달 말일을 넘지 않는다', () => {
    expect(addOneMonth(new Date('2026-01-31T00:00:00Z')).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addOneMonth(new Date('2026-12-31T00:00:00Z')).toISOString()).toBe('2027-01-31T00:00:00.000Z');
  });
});

describe('makeOrderId', () => {
  it('토스 주문번호 규칙(6~64자, 영숫자·-·_)을 지킨다', () => {
    const id = makeOrderId('3f2a9c1e-1111-2222-3333-444455556666', new Date('2026-10-13T06:00:00Z'));
    expect(id).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    expect(id.startsWith('pro-3f2a9c1e1111-20261013060000-')).toBe(true);
  });
});

describe('토스 API 호출', () => {
  it('시크릿 키 뒤에 콜론을 붙여 Basic 인증한다', () => {
    expect(basicAuth('test_sk_abc')).toBe('Basic ' + btoa('test_sk_abc:'));
  });

  it('빌링키 발급 요청 형식', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ billingKey: 'bk', customerKey: 'ck' }), { status: 200 }));
    const r = await issueBillingKey(fetchFn, 'sk', 'auth1', 'ck');
    expect(r.billingKey).toBe('bk');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.tosspayments.com/v1/billing/authorizations/issue');
    expect(JSON.parse(init.body)).toEqual({ authKey: 'auth1', customerKey: 'ck' });
  });

  it('결제 승인은 orderId 를 멱등 키로 보내고 빌링키는 본문에 넣지 않는다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ paymentKey: 'pk', orderId: 'o1', status: 'DONE', totalAmount: 319000 }), { status: 200 }));
    await chargeBilling(fetchFn, 'sk', { billingKey: 'bk/1', customerKey: 'ck', amount: 319000, orderId: 'o1-abcdef', orderName: PRO_PLAN.orderName });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.tosspayments.com/v1/billing/bk%2F1');
    expect(init.headers['Idempotency-Key']).toBe('o1-abcdef');
    expect(JSON.parse(init.body)).not.toHaveProperty('billingKey');
  });

  it('토스 오류 응답을 코드와 메시지가 담긴 예외로 바꾼다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'REJECT_CARD_COMPANY', message: '카드사 거절' }), { status: 400 }));
    await expect(issueBillingKey(fetchFn, 'sk', 'a', 'c')).rejects.toMatchObject({ code: 'REJECT_CARD_COMPANY', message: '카드사 거절' });
    await expect(issueBillingKey(fetchFn, 'sk', 'a', 'c')).rejects.toBeInstanceOf(TossApiError);
  });
});

describe('응시권(1명 = 1회 응시)', () => {
  it('단가는 랜딩·환불정책 표기 1인당 25,000원(부가세 별도)', () => {
    expect(SEAT_PRODUCT.unitSupplyAmount).toBe(25_000);
    expect(seatAmount(1)).toBe(27_500);
    expect(seatAmount(10)).toBe(275_000);
  });
  it('수량은 1~1000 정수만', () => {
    expect(() => seatAmount(0)).toThrow();
    expect(() => seatAmount(1.5)).toThrow();
    expect(() => seatAmount(1001)).toThrow();
  });
  it('주문명·주문번호 형식', () => {
    expect(seatOrderName(30)).toBe('AI 역량평가 응시권 30명분');
    const id = makeSeatOrderId('3f2a9c1e-1111-2222-3333-444455556666', new Date('2026-10-31T06:00:00Z'));
    expect(id).toMatch(/^seat-[A-Za-z0-9_-]{6,64}$/);
    expect(id.length).toBeLessThanOrEqual(64);
  });
  it('결제 승인은 /v1/payments/confirm 에 orderId 를 멱등 키로 보낸다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ paymentKey: 'pk', orderId: 'seat-1', status: 'DONE', totalAmount: 27500 }), { status: 200 }));
    const r = await confirmPayment(fetchFn, 'sk', { paymentKey: 'pk', orderId: 'seat-1-abcdef', amount: 27500 });
    expect(r.status).toBe('DONE');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.tosspayments.com/v1/payments/confirm');
    expect(init.headers['Idempotency-Key']).toBe('seat-1-abcdef');
    expect(JSON.parse(init.body)).toEqual({ paymentKey: 'pk', orderId: 'seat-1-abcdef', amount: 27500 });
  });
});
