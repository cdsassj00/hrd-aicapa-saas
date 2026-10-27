// 문항·문항세트: DB(조직 문제은행 구조) → 화면이 쓰는 형태로 펼친다.
//
// 0029 에서 시험 도메인은 DB 를 화면에 맞췄지만, 문항은 예외로 DB 구조를 유지했다
// (조직별 문제은행·공개범위·역량 매핑 — 문제은행 화면과 플랫폼 기본 문항 38개가 이미 이 구조).
//   questions       : points + answer_key(jsonb: category·grade·tags·options·correct_answer·
//                     submission_slots·allow_file_upload)
//   question_sets   : name/description (+ 0029: attachments·category·grade·difficulty·tags)
//   question_set_items(set_id, question_id, sort_order) : 세트 소속
// 응시 화면은 get_exam_questions_for_session RPC(정답 제외)로 같은 형태를 받는다.
// 이 파일은 그 외(출제·채점·내보내기·통계) 화면과 ai-grade 엣지 함수가 같은 형태를 쓰게 하는 어댑터다.
// Deno·Vite 양쪽에서 import 하므로 외부 의존성 없이 순수 TS 로 유지한다.

/** questions 를 이 select 로 읽어야 set_id/set_order 가 채워진다. */
export const QUESTION_SELECT = '*, question_set_items(set_id, sort_order)';

interface AnswerKey {
  category?: string | null;
  grade?: string | null;
  tags?: string[] | null;
  options?: unknown;
  correct_answer?: string | null;
  submission_slots?: unknown;
  allow_file_upload?: boolean | null;
}

/** DB 문항 행(또는 이미 펼친 행) → 화면 형태. 이미 펼친 행이면 그대로 둔다. */
export function toLegacyQuestion(row: any): any {
  if (!row || row.answer_key === undefined) return row;
  const { answer_key, question_set_items, points, ...rest } = row;
  const ak: AnswerKey = (answer_key ?? {}) as AnswerKey;
  const items: { set_id: string; sort_order: number | null }[] = Array.isArray(question_set_items)
    ? question_set_items
    : [];
  const firstSet = items[0];
  return {
    ...rest,
    answer_key,
    points,
    category: ak.category ?? null,
    grade: ak.grade ?? null,
    tags: Array.isArray(ak.tags) ? ak.tags : [],
    max_score: points ?? 0,
    options: ak.options ?? null,
    correct_answer: ak.correct_answer ?? null,
    submission_slots: ak.submission_slots ?? null,
    allow_file_upload: ak.allow_file_upload ?? row.type === 'file_upload',
    set_id: row.set_id ?? firstSet?.set_id ?? null,
    set_order: row.set_order ?? firstSet?.sort_order ?? null,
  };
}

/** DB 세트 행 → 화면 형태 (title/scenario). */
export function toLegacySet(row: any): any {
  if (!row || row.name === undefined) return row;
  return {
    ...row,
    title: row.title ?? row.name ?? '',
    scenario: row.scenario ?? row.description ?? '',
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

/** 화면 형태 문항(JSON 업로드·편집) → questions INSERT 행. 분류·정답·슬롯은 answer_key 로 접는다. */
export function toDbQuestion(q: any, orgId: string, createdBy: string | null) {
  return {
    org_id: orgId,
    visibility: 'org' as const,
    type: q.type || 'work_based',
    content: q.content || '',
    difficulty: q.difficulty ?? 'medium',
    points: q.max_score ?? 0,
    answer_key: {
      correct_answer: q.correct_answer ?? null,
      submission_slots: q.submission_slots ?? null,
      options: q.options ?? null,
      tags: q.tags ?? [],
      category: q.category ?? null,
      grade: q.grade ?? null,
      allow_file_upload: q.allow_file_upload ?? true,
    },
    attachments: q.attachments ?? [],
    created_by: createdBy,
  };
}
