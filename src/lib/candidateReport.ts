// 응시자 1인 리포트 계산 — 화면과 분리한 순수 모듈 (테스트 가능, 이식성 §8)

export interface ReportQuestion {
  id: string;
  points: number;        // 배점 (exam_questions.points_override 우선)
  score: number | null;  // 획득 점수 (미채점 null)
}

export interface QuestionCompetency { question_id: string; competency_id: string; weight: number }
export interface CompetencyInfo { id: string; name: string; code: string; parent_id: string | null; sort_order: number }

export interface CompetencyScore {
  id: string;
  name: string;
  code: string;
  earned: number;
  possible: number;
  percent: number;       // 0~100
  questionCount: number;
}

/** 문항 → 역량 매핑으로 역량별 득점률. 하위 역량은 상위 역량으로 합산한다. */
export function competencyScores(
  questions: ReportQuestion[],
  links: QuestionCompetency[],
  comps: CompetencyInfo[],
): CompetencyScore[] {
  const byId = new Map(comps.map(c => [c.id, c]));
  const topOf = (id: string): CompetencyInfo | undefined => {
    let c = byId.get(id);
    const seen = new Set<string>();
    while (c?.parent_id && byId.has(c.parent_id) && !seen.has(c.id)) {
      seen.add(c.id);
      c = byId.get(c.parent_id);
    }
    return c;
  };
  const qById = new Map(questions.map(q => [q.id, q]));
  const acc = new Map<string, { earned: number; possible: number; qs: Set<string> }>();
  for (const l of links) {
    const q = qById.get(l.question_id);
    const top = topOf(l.competency_id);
    if (!q || !top || q.points <= 0) continue;
    const w = l.weight > 0 ? l.weight : 1;
    const a = acc.get(top.id) ?? { earned: 0, possible: 0, qs: new Set<string>() };
    a.possible += q.points * w;
    a.earned += (q.score ?? 0) * w;
    a.qs.add(q.id);
    acc.set(top.id, a);
  }
  return [...acc.entries()]
    .map(([id, a]) => {
      const c = byId.get(id)!;
      return {
        id, name: c.name, code: c.code,
        earned: a.earned, possible: a.possible,
        percent: a.possible > 0 ? Math.round((a.earned / a.possible) * 1000) / 10 : 0,
        questionCount: a.qs.size,
        _sort: c.sort_order,
      };
    })
    .sort((x, y) => x._sort - y._sort || x.code.localeCompare(y.code))
    .map(({ _sort, ...rest }) => rest);
}

/** 같은 회차 응시자 중 상위 몇 %인지 (1 = 최상위). 점수 없는 응시자는 제외. */
export function cohortStats(myScore: number | null, scores: number[]) {
  const valid = scores.filter(s => Number.isFinite(s));
  const n = valid.length;
  if (myScore == null || n === 0) return { n, avg: null as number | null, rank: null as number | null, topPercent: null as number | null };
  const avg = Math.round((valid.reduce((a, b) => a + b, 0) / n) * 10) / 10;
  const rank = valid.filter(s => s > myScore).length + 1;
  const topPercent = Math.max(1, Math.round((rank / n) * 100));
  return { n, avg, rank, topPercent };
}

/** 강점·보완점: 득점률 상위/하위 (역량이 2개 이상일 때만 의미가 있다). */
export function strengthsAndGaps(scores: CompetencyScore[], k = 2) {
  if (scores.length < 2) return { strengths: [] as CompetencyScore[], gaps: [] as CompetencyScore[] };
  const sorted = [...scores].sort((a, b) => b.percent - a.percent);
  const take = Math.min(k, Math.floor(sorted.length / 2));
  return { strengths: sorted.slice(0, take), gaps: sorted.slice(-take).reverse() };
}

/** 문항 본문 첫 줄을 제목으로 (마크다운 기호 제거, 60자). */
export function questionTitle(content: string | null | undefined, fallback: string) {
  const line = (content ?? '').split('\n').map(s => s.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean);
  if (!line) return fallback;
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}
