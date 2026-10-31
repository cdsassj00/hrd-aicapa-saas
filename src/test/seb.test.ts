import { describe, it, expect } from 'vitest';
import { buildSebSettings, sebKeyJson, sebConfigKey, sebRequestHash, sebPlist, parseSebKeys, sha256Hex } from '@/lib/seb';

describe('SEB Config Key', () => {
  it('키를 대소문자 무시 정렬하고 공백 없이 직렬화한다', () => {
    expect(sebKeyJson({ b: 1, A: true, a2: [{ z: 'x/y', Y: '한' }] })).toBe('{"A":true,"a2":[{"Y":"한","z":"x/y"}],"b":1}');
  });
  it('originatorVersion 은 키 계산에서 빠진다', async () => {
    const s = buildSebSettings({ origin: 'https://app.ai-hrd.com' });
    const k1 = await sebConfigKey(s);
    const k2 = await sebConfigKey({ ...s, originatorVersion: 'other' });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('같은 origin 이면 같은 키, 다른 origin 이면 다른 키', async () => {
    const a = await sebConfigKey(buildSebSettings({ origin: 'https://app.ai-hrd.com/' }));
    const b = await sebConfigKey(buildSebSettings({ origin: 'https://app.ai-hrd.com' }));
    const c = await sebConfigKey(buildSebSettings({ origin: 'http://127.0.0.1:8080' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('요청 해시 = SHA256(URL(# 제외) + 키)', async () => {
    expect(await sebRequestHash('https://x/y#frag', 'k')).toBe(await sha256Hex('https://x/yk'));
  });
  it('plist 에 시작 URL·화이트리스트가 들어간다', () => {
    const xml = sebPlist(buildSebSettings({ origin: 'https://app.ai-hrd.com' }));
    expect(xml).toContain('<key>startURL</key>\n\t<string>https://app.ai-hrd.com/applicant</string>');
    expect(xml).toContain('<string>app.ai-hrd.com</string>');
    expect(xml).toContain('<key>URLFilterEnable</key>\n\t<true/>');
  });
  it('붙여 넣은 키 정리', () => {
    const k = 'A'.repeat(64);
    expect(parseSebKeys(`${k}\n${k.toLowerCase()} x 123`)).toEqual(['a'.repeat(64)]);
  });
});
