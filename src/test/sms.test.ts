import { describe, expect, it } from 'vitest';
// Edge Function 의 순수 헬퍼. Deno API 를 top-level 에서 쓰지 않으므로
// 여기서 그대로 불러 검증할 수 있다 — 설계문서 §8 이 노린 이점.
import { euckrBytes, ncpSignature, normalizeKrPhone } from '../../supabase/functions/_shared/sms';

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

describe('ncpSignature', () => {
  // NCP 서명은 개행·공백 하나만 틀려도 401 이 나고 원인이 안 보인다.
  // 알려진 입력에 대해 결정적으로 같은 값이 나오는지 고정해 둔다.
  it('같은 입력에 항상 같은 서명을 만든다', async () => {
    const a = await ncpSignature('POST', '/sms/v2/services/svc/messages', '1700000000000', 'AK', 'SK');
    const b = await ncpSignature('POST', '/sms/v2/services/svc/messages', '1700000000000', 'AK', 'SK');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64
  });

  it('타임스탬프가 다르면 서명도 다르다', async () => {
    const a = await ncpSignature('POST', '/p', '1700000000000', 'AK', 'SK');
    const b = await ncpSignature('POST', '/p', '1700000000001', 'AK', 'SK');
    expect(a).not.toBe(b);
  });
});
