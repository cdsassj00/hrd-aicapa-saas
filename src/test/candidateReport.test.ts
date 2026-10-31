import { describe, it, expect } from 'vitest';
import { competencyScores, cohortStats, strengthsAndGaps, questionTitle } from '@/lib/candidateReport';

const comps = [
  { id: 'A', name: '생성형 AI', code: 'GEN', parent_id: null, sort_order: 1 },
  { id: 'A1', name: '프롬프트', code: 'GEN.PMT', parent_id: 'A', sort_order: 1 },
  { id: 'B', name: '데이터', code: 'DATA', parent_id: null, sort_order: 2 },
];

describe('competencyScores', () => {
  it('하위 역량은 상위로 합산하고 가중치를 반영한다', () => {
    const r = competencyScores(
      [{ id: 'q1', points: 10, score: 5 }, { id: 'q2', points: 10, score: 10 }, { id: 'q3', points: 20, score: null }],
      [
        { question_id: 'q1', competency_id: 'A1', weight: 1 },
        { question_id: 'q2', competency_id: 'A', weight: 2 },
        { question_id: 'q3', competency_id: 'B', weight: 1 },
      ],
      comps,
    );
    expect(r.map(x => x.code)).toEqual(['GEN', 'DATA']);
    expect(r[0]).toMatchObject({ earned: 25, possible: 30, percent: 83.3, questionCount: 2 });
    expect(r[1]).toMatchObject({ earned: 0, possible: 20, percent: 0 });
  });
  it('매핑이 없으면 빈 배열', () => {
    expect(competencyScores([{ id: 'q', points: 5, score: 5 }], [], comps)).toEqual([]);
  });
});

describe('cohortStats', () => {
  it('순위·상위 %·평균', () => {
    expect(cohortStats(80, [90, 80, 70, 60])).toEqual({ n: 4, avg: 75, rank: 2, topPercent: 50 });
  });
  it('점수 없으면 null', () => {
    expect(cohortStats(null, [1, 2]).rank).toBeNull();
  });
});

describe('strengthsAndGaps', () => {
  it('상위·하위를 겹치지 않게 고른다', () => {
    const s = [10, 90, 50].map((p, i) => ({ id: String(i), name: String(i), code: String(i), earned: 0, possible: 1, percent: p, questionCount: 1 }));
    const r = strengthsAndGaps(s);
    expect(r.strengths.map(x => x.percent)).toEqual([90]);
    expect(r.gaps.map(x => x.percent)).toEqual([10]);
  });
});

describe('questionTitle', () => {
  it('첫 줄의 마크다운 기호 제거', () => {
    expect(questionTitle('\n## 매출 데이터 정리\n본문', 'Q1')).toBe('매출 데이터 정리');
    expect(questionTitle('', 'Q1')).toBe('Q1');
  });
});
