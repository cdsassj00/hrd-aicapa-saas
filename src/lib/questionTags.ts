// 문제은행 화면의 태그 = 직접 단 태그(answer_key.tags) + 분류 메타에서 자동 도출한 태그.
//
// 0022 이후 문항 분류는 answer_key.meta(섹터·직무·도구요건·레벨)와
// question_competencies(6대 역량)로 표준화됐다. 플랫폼 기본 문항은 이 두 곳에만
// 분류가 있고 answer_key.tags 는 비어 있어, tags 만 보던 목록·검색·필터에서
// "태그 없음"으로 보였다. 메타를 읽기 전용 태그로 풀어 같은 자리에 보여준다.
// 저장은 하지 않는다 — 원본은 meta/question_competencies 하나뿐이어야 한다.

const SECTOR_LABELS: Record<string, string> = {
  common: '공통',
  private: '민간',
  public: '공공',
};

const TOOL_LABELS: Record<string, string> = {
  chat: '채팅형',
  office: '오피스',
  code_sandbox: '코드실행',
};

interface QuestionMeta {
  sector?: string;
  job_roles?: string[];
  tool_req?: string;
  level?: string;
}

/** answer_key.meta + 역량명 → 화면용 태그. 값이 없는 항목은 건너뛴다. */
export function deriveMetaTags(answerKey: unknown, competencyNames: string[] = []): string[] {
  const meta = ((answerKey as { meta?: QuestionMeta } | null)?.meta ?? {}) as QuestionMeta;
  const out: string[] = [];
  if (meta.sector) out.push(SECTOR_LABELS[meta.sector] ?? meta.sector);
  if (meta.tool_req) out.push(TOOL_LABELS[meta.tool_req] ?? meta.tool_req);
  // 레벨은 기본값 '일반'이 모든 문항에 붙어 변별력이 없으므로 그 외 값만 태그로.
  if (meta.level && meta.level !== '일반') out.push(meta.level);
  for (const r of meta.job_roles ?? []) if (r) out.push(r);
  for (const c of competencyNames) if (c) out.push(c);
  return out;
}

/** 직접 태그 + 자동 태그, 순서 유지·중복 제거. */
export function mergeTags(explicit: string[] = [], derived: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...explicit, ...derived]) {
    const v = (t ?? '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
