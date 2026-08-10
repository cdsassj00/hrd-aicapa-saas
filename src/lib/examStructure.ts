/**
 * 시험 구조 어댑터 (세트형 + 독립문항 + 슬롯형 통합)
 *
 * 목적:
 *   응시/채점/관리 화면이 "세트 묶음 + 독립 문항 + 슬롯" 을 단 하나의 함수로
 *   불러올 수 있게 해서, 기존 코드의 분기를 최소화한다.
 *
 * 하위호환:
 *   - 세트가 없는 기존 시험은 items 전부 StandaloneItem 만 반환된다.
 *   - submission_slots 가 NULL 인 문항은 type 1개짜리 default slot 으로 정규화된다.
 *     → 채점 코드는 항상 슬롯 단위로 합산하면 되므로 분기 불필요.
 *
 * 읽기 전용. RLS 에 따라 자동으로 권한이 적용된다.
 */

import { supabase } from '@/integrations/supabase/client';
import type {
  Question,
  QuestionType,
  QuestionCategory,
  ExamGrade,
  QuestionDifficulty,
  McOption,
} from '@/types';

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export type SlotType = 'file' | 'text' | 'url' | 'number' | 'long_text';

/** 한 문항 내 입력칸 1개 (파일 1개 / 텍스트 1줄 / URL 등) */
export interface SubmissionSlot {
  id: string;                 // 문항 내 고유 (예: "file1", "summary")
  type: SlotType;
  label: string;              // 응시자에게 보일 라벨
  max_score: number;          // 슬롯별 배점
  required?: boolean;
  // file 전용
  accept?: string;            // ".pdf,.zip"
  max_size_mb?: number;
  // text/long_text 전용
  max_length?: number;
  placeholder?: string;
  // 채점 보조 (선택)
  rubric?: string;            // 해당 슬롯의 채점 기준
  correct_answer?: string | number | null; // 자동채점 정답
  auto_grade?: 'none' | 'exact' | 'numeric';
  tolerance?: number;
}

/** 정규화된 문항 (슬롯 항상 1개 이상 보장) */
export interface NormalizedQuestion extends Question {
  submission_slots: SubmissionSlot[];   // 정규화 후엔 항상 존재
  set_id: string | null;
  set_order: number | null;
  /** 슬롯 합계가 max_score 와 다를 수 있으므로 명시적으로 노출 */
  effective_max_score: number;
}

/** 시나리오형 묶음 */
export interface QuestionSet {
  id: string;
  exam_id: string | null;
  title: string;
  scenario: string;
  attachments: SetAttachment[];
  total_score: number;        // DB 저장값 (참고용)
  computed_score: number;     // 하위 문항 슬롯 합계 (실채점 분모)
  order_num: number;
  category: QuestionCategory | null;
  grade: ExamGrade | null;
  difficulty: QuestionDifficulty;
  tags: string[];
  /** true 면 이 세트 풀이 중에는 부정행위 감지(전체화면/얼굴/음성)를 일시 중지 */
  proctoring_disabled?: boolean;
}

export interface SetAttachment {
  name: string;
  url: string;
  size?: number;
  type?: string;
}

export type SetItem = {
  kind: 'set';
  order_num: number;          // exam_questions 기준 정렬 순서
  set: QuestionSet;
  questions: NormalizedQuestion[];
};

export type StandaloneItem = {
  kind: 'question';
  order_num: number;
  question: NormalizedQuestion;
};

export type ExamItem = SetItem | StandaloneItem;

export interface ExamStructure {
  exam_id: string;
  items: ExamItem[];
  /** 슬롯 단위 총 만점 (정규화된 분모) */
  total_max_score: number;
  /** 평탄화된 문항 리스트 (응시 화면 진행률 등에 사용) */
  flat_questions: NormalizedQuestion[];
}

// ──────────────────────────────────────────────────────────
// 정규화 헬퍼
// ──────────────────────────────────────────────────────────

/** raw question row → NormalizedQuestion */
export function normalizeQuestion(raw: any): NormalizedQuestion {
  const slots = parseSlots(raw.submission_slots, raw.type, raw.max_score);
  const effective_max_score = slots.reduce((s, x) => s + (x.max_score || 0), 0);

  return {
    id: raw.id,
    exam_id: raw.exam_id ?? null,
    category: raw.category,
    content: raw.content ?? '',
    type: raw.type as QuestionType,
    max_score: raw.max_score ?? 0,
    order_num: raw.order_num ?? 1,
    grade: raw.grade ?? null,
    difficulty: raw.difficulty ?? 'medium',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    options: Array.isArray(raw.options) ? (raw.options as McOption[]) : null,
    correct_answer: raw.correct_answer ?? null,
    allow_file_upload: !!raw.allow_file_upload,
    submission_slots: slots,
    set_id: raw.set_id ?? null,
    set_order: raw.set_order ?? null,
    effective_max_score,
  };
}

/**
 * submission_slots 가 NULL/빈 배열이면 question.type 에 맞는 기본 슬롯 1개를 생성한다.
 * → 채점/응시 코드가 항상 동일한 슬롯 루프로 처리할 수 있다.
 */
function parseSlots(raw: unknown, qtype: string, max_score: number): SubmissionSlot[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .filter((s) => s && typeof s === 'object' && (s as any).id)
      .map((s: any, i): SubmissionSlot => ({
        id: String(s.id ?? `slot${i + 1}`),
        type: (s.type ?? 'text') as SlotType,
        label: String(s.label ?? `답안 ${i + 1}`),
        max_score: Number.isFinite(s.max_score) ? Number(s.max_score) : 0,
        required: s.required !== false,
        accept: s.accept ?? undefined,
        max_size_mb: s.max_size_mb ?? undefined,
        max_length: s.max_length ?? undefined,
        placeholder: s.placeholder ?? undefined,
        rubric: s.rubric ?? undefined,
        correct_answer: s.correct_answer ?? null,
        auto_grade: s.auto_grade ?? undefined,
        tolerance: s.tolerance ?? undefined,
      }));
  }

  // 기본 슬롯 생성 (하위호환)
  const baseId = 'default';
  switch (qtype) {
    case 'multiple_choice':
      return [{ id: baseId, type: 'text', label: '선택', max_score, required: true }];
    case 'short_answer':
      return [{ id: baseId, type: 'text', label: '답안', max_score, required: true, max_length: 500 }];
    case 'essay':
      return [{ id: baseId, type: 'long_text', label: '서술', max_score, required: true }];
    case 'file_upload':
    case 'work_based':
      return [{ id: baseId, type: 'file', label: '제출 파일', max_score, required: true }];
    default:
      return [{ id: baseId, type: 'text', label: '답안', max_score, required: true }];
  }
}

function normalizeSet(raw: any, questions: NormalizedQuestion[]): QuestionSet {
  const computed = questions.reduce((s, q) => s + q.effective_max_score, 0);
  return {
    id: raw.id,
    exam_id: raw.exam_id ?? null,
    title: raw.title ?? '',
    scenario: raw.scenario ?? '',
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    total_score: raw.total_score ?? computed,
    computed_score: computed,
    order_num: raw.order_num ?? 1,
    category: raw.category ?? null,
    grade: raw.grade ?? null,
    difficulty: raw.difficulty ?? 'medium',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

// ──────────────────────────────────────────────────────────
// 메인: 시험 구조 로드
// ──────────────────────────────────────────────────────────

/**
 * 시험에 연결된 문항들을 exam_questions.order_num 순서대로 로드하고,
 * 세트 묶음/독립 문항/슬롯을 통합 트리로 반환한다.
 *
 * - 같은 세트에 속한 문항들은 첫 등장 위치에 SetItem 으로 한 번에 묶임
 * - 세트 내부 문항 순서는 set_order ASC, NULL은 뒤로
 * - 세트가 없는 문항은 StandaloneItem 으로 그 자리에 배치
 */
export async function loadExamStructure(examId: string): Promise<ExamStructure> {
  // 1) 시험-문항 연결 (순서 보장)
  const { data: eqs, error: eqErr } = await supabase
    .from('exam_questions')
    .select('question_id, order_num')
    .eq('exam_id', examId)
    .order('order_num', { ascending: true });
  if (eqErr) throw eqErr;

  const qIds = (eqs ?? []).map((r) => r.question_id);
  if (qIds.length === 0) {
    return { exam_id: examId, items: [], total_max_score: 0, flat_questions: [] };
  }

  // 2) 문항 로드 (set_id, submission_slots, set_order 포함)
  const { data: rawQuestions, error: qErr } = await supabase
    .from('questions')
    .select('*')
    .in('id', qIds);
  if (qErr) throw qErr;

  const normalized = (rawQuestions ?? []).map(normalizeQuestion);
  const byId = new Map(normalized.map((q) => [q.id, q]));

  // 3) 필요한 세트만 로드
  const setIds = Array.from(
    new Set(normalized.map((q) => q.set_id).filter((x): x is string => !!x)),
  );
  const setMap = new Map<string, any>();
  if (setIds.length > 0) {
    const { data: rawSets, error: sErr } = await supabase
      .from('question_sets')
      .select('*')
      .in('id', setIds);
    if (sErr) throw sErr;
    (rawSets ?? []).forEach((s) => setMap.set(s.id, s));
  }

  // 4) exam_questions 순서대로 순회하며 set/standalone 트리 구성
  //    같은 set_id 가 처음 등장한 위치에 SetItem 생성, 이후 같은 세트의 문항은 그 SetItem 에 합류
  const items: ExamItem[] = [];
  const setItemByKey = new Map<string, SetItem>();

  for (const eq of eqs ?? []) {
    const q = byId.get(eq.question_id);
    if (!q) continue; // 권한/RLS 로 누락된 문항은 건너뜀

    if (q.set_id) {
      let setItem = setItemByKey.get(q.set_id);
      if (!setItem) {
        const rawSet = setMap.get(q.set_id);
        if (!rawSet) {
          // 세트 row 가 없으면 안전하게 독립 문항으로 폴백
          items.push({ kind: 'question', order_num: eq.order_num ?? 1, question: q });
          continue;
        }
        setItem = {
          kind: 'set',
          order_num: eq.order_num ?? 1,
          set: normalizeSet(rawSet, []),
          questions: [],
        };
        setItemByKey.set(q.set_id, setItem);
        items.push(setItem);
      }
      setItem.questions.push(q);
    } else {
      items.push({ kind: 'question', order_num: eq.order_num ?? 1, question: q });
    }
  }

  // 5) 세트 내부 문항 정렬 + 세트 computed_score 재계산
  for (const it of items) {
    if (it.kind === 'set') {
      it.questions.sort((a, b) => {
        const ao = a.set_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.set_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.order_num - b.order_num;
      });
      // computed_score 갱신 (정렬 후에도 합계는 동일하지만 일관성 위해)
      const computed = it.questions.reduce((s, q) => s + q.effective_max_score, 0);
      it.set.computed_score = computed;
    }
  }

  // 6) 평탄화 + 총점
  const flat: NormalizedQuestion[] = [];
  for (const it of items) {
    if (it.kind === 'set') flat.push(...it.questions);
    else flat.push(it.question);
  }
  const total_max_score = flat.reduce((s, q) => s + q.effective_max_score, 0);

  return { exam_id: examId, items, total_max_score, flat_questions: flat };
}

// ──────────────────────────────────────────────────────────
// 답안 유틸 (다음 단계에서 사용)
// ──────────────────────────────────────────────────────────

/**
 * answers row 에서 슬롯별 값을 안전하게 꺼낸다.
 * - slot_values 가 있으면 그것을 사용
 * - 없으면 기존 content/file_url 을 default 슬롯 값으로 변환 (하위호환)
 */
export function getSlotValues(
  answer: { content?: string | null; file_url?: string | null; slot_values?: any } | null | undefined,
  slots: SubmissionSlot[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const sv = answer?.slot_values;
  if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
    for (const slot of slots) {
      const v = (sv as any)[slot.id];
      out[slot.id] = v == null ? '' : String(v);
    }
    return out;
  }
  // 하위호환: 단일 슬롯 매핑
  if (slots.length === 1) {
    const s = slots[0];
    if (s.type === 'file') out[s.id] = answer?.file_url ?? '';
    else out[s.id] = answer?.content ?? '';
  }
  return out;
}

/**
 * 슬롯별 점수에서 문항 점수를 합산한다.
 * - slot_scores 가 있으면 합산
 * - 없으면 기존 answer.score 를 default 슬롯 점수로 간주 (하위호환)
 */
export function computeAnswerScore(
  answer: { score?: number | null; slot_scores?: any } | null | undefined,
  slots: SubmissionSlot[],
): number {
  const ss = answer?.slot_scores;
  if (ss && typeof ss === 'object' && !Array.isArray(ss)) {
    let total = 0;
    for (const slot of slots) {
      const v = Number((ss as any)[slot.id]);
      if (Number.isFinite(v)) total += v;
    }
    return total;
  }
  return Number.isFinite(answer?.score) ? Number(answer?.score) : 0;
}
