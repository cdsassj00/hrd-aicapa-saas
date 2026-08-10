import { describe, expect, it } from 'vitest';
// Edge Function 의 순수 헬퍼. Deno API 를 top-level 에서 쓰지 않으므로
// 여기서 그대로 불러 검증할 수 있다 — 설계문서 §8 이 노린 이점.
import { euckrBytes, normalizeKrPhone } from '../../supabase/functions/_shared/sms';

describe('normalizeKrPhone', () => {
  it('하이픈과 공백을 제거한다', () => {
    expect(normalizeKrPhone('010-1234-5678')).toBe('01012345678');
    expect(normalizeKrPhone('010 1234 5678')).toBe('01012345678');
  });

  it('국가번호 82를 0으로 되돌린다', () => {
    expect(normalizeKrPhone('+82 10-1234-5678')).toBe('01012345678');
    expect(normalizeKrPhone('821012345678')).toBe('01012345678');
  });

  it('이미 정규화된 번호는 그대로 둔다', () => {
    expect(normalizeKrPhone('01012345678')).toBe('01012345678');
  });
});

describe('euckrBytes', () => {
  it('영문·숫자는 1바이트', () => {
    expect(euckrBytes('ABC123')).toBe(6);
  });

  it('한글은 2바이트', () => {
    expect(euckrBytes('인증번호')).toBe(8);
  });

  it('SMS 한도 판정에 쓰이는 실제 문구를 잰다', () => {
    // 이 문구가 90바이트를 넘으면 LMS 단가로 넘어간다
    const body = '[AI CAPA] 인증번호 123456 (3분 내 입력)';
    expect(euckrBytes(body)).toBeLessThanOrEqual(90);
  });
});
