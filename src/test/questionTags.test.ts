import { describe, expect, it } from 'vitest';
import { deriveMetaTags, mergeTags } from '@/lib/questionTags';

describe('deriveMetaTags', () => {
  it('플랫폼 문항 메타(섹터·도구)와 역량명을 태그로 푼다', () => {
    const ak = { meta: { sector: 'common', tool_req: 'code_sandbox', level: '일반', job_roles: [] } };
    expect(deriveMetaTags(ak, ['자기주도 과업완수 역량'])).toEqual(['공통', '코드실행', '자기주도 과업완수 역량']);
  });

  it("레벨 기본값 '일반'은 빼고 그 외 레벨·직무는 넣는다", () => {
    const ak = { meta: { sector: 'public', tool_req: 'chat', level: '심화', job_roles: ['인사'] } };
    expect(deriveMetaTags(ak)).toEqual(['공공', '채팅형', '심화', '인사']);
  });

  it('meta 가 없으면 역량명만', () => {
    expect(deriveMetaTags({}, ['과업 구조화 역량'])).toEqual(['과업 구조화 역량']);
    expect(deriveMetaTags(null)).toEqual([]);
  });

  it('모르는 값은 원문 그대로', () => {
    expect(deriveMetaTags({ meta: { sector: 'edu', tool_req: 'browser' } })).toEqual(['edu', 'browser']);
  });
});

describe('mergeTags', () => {
  it('직접 태그를 앞에 두고 중복·공백을 제거한다', () => {
    expect(mergeTags(['민간', ' '], ['민간', '오피스'])).toEqual(['민간', '오피스']);
  });
});
