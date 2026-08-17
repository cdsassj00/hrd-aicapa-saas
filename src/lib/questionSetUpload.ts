/**
 * 세트형 문제 JSON 업로드 (B안: JSON + 첨부)
 *
 * - 스키마 검증 (zod)
 * - dry-run 시 DB 쓰기 0건
 * - commit 시 question_sets → 첨부 업로드 → questions 순서로 트랜잭션-유사 처리
 *   (실패 시 이미 만든 set 을 rollback)
 *
 * 기존 단일 문항 업로드(Excel) 와 완전 별도. 영향 없음.
 */

import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

// ── 스키마 ────────────────────────────────────────────────
const slotSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(['file', 'text', 'long_text', 'url', 'number']),
  label: z.string().min(1).max(200),
  max_score: z.number().int().min(0).max(1000),
  required: z.boolean().optional(),
  accept: z.string().max(200).optional(),
  max_size_mb: z.number().min(0).max(200).optional(),
  max_length: z.number().int().min(0).max(20000).optional(),
  placeholder: z.string().max(500).optional(),
  rubric: z.string().max(2000).optional(),
  // 자동채점 보조 (선택)
  correct_answer: z.union([z.string(), z.number()]).nullable().optional(),
  auto_grade: z.enum(['none', 'exact', 'numeric']).optional(),
  tolerance: z.number().min(0).optional(), // numeric 비교 허용 오차
});

const mcOptionSchema = z.object({
  id: z.string(),
  text: z.string().max(500),
  is_correct: z.boolean(),
});

const categorySchema = z.enum(['생성형AI활용', '데이터분석', '서비스구현']);
const gradeSchema = z.enum(['green', 'blue', 'black', '전문인재']);
const difficultySchema = z.enum(['easy', 'medium', 'hard']);
const typeSchema = z.enum(['multiple_choice', 'short_answer', 'essay', 'file_upload', 'work_based']);

const questionSchema = z.object({
  set_order: z.number().int().min(1).optional(),
  content: z.string().min(1).max(20000),
  type: typeSchema,
  max_score: z.number().int().min(0).max(1000).default(10),
  difficulty: difficultySchema.default('medium'),
  category: categorySchema.optional(),
  grade: gradeSchema.nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  allow_file_upload: z.boolean().default(true),
  options: z.array(mcOptionSchema).max(10).nullable().optional(),
  correct_answer: z.string().max(20000).nullable().optional(),
  submission_slots: z.array(slotSchema).max(20).optional(),
  attachment_refs: z.array(z.string().max(200)).max(50).optional(), // 첨부 파일명 참조
});

const setSchema = z.object({
  title: z.string().min(1).max(200),
  scenario: z.string().max(50000).default(''),
  category: categorySchema.optional(),
  grade: gradeSchema.nullable().optional(),
  difficulty: difficultySchema.default('medium'),
  tags: z.array(z.string().max(40)).max(20).default([]),
  order_num: z.number().int().min(1).default(1),
  attachment_refs: z.array(z.string().max(200)).max(100).default([]),
  questions: z.array(questionSchema).min(1).max(50),
});

export const uploadPayloadSchema = z.object({
  version: z.literal(1).default(1),
  sets: z.array(setSchema).default([]),
  standalone: z.array(questionSchema).default([]),
});

export type UploadPayload = z.infer<typeof uploadPayloadSchema>;
export type UploadSet = z.infer<typeof setSchema>;
export type UploadQuestion = z.infer<typeof questionSchema>;

// ── 검증 결과 ──────────────────────────────────────────────
export interface DryRunReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    set_count: number;
    standalone_count: number;
    total_questions: number;
    total_score: number;
    missing_attachments: string[];     // JSON 에서 참조했지만 업로드 안된 파일
    unused_attachments: string[];      // 업로드했지만 어디서도 참조 안한 파일
  };
}

export function parseJson(raw: string): { data?: UploadPayload; error?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (e: any) {
    return { error: `JSON 파싱 실패: ${e.message}` };
  }
  const result = uploadPayloadSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues.slice(0, 5).map(i => `• ${i.path.join('.')}: ${i.message}`).join('\n');
    return { error: `스키마 오류:\n${msg}` };
  }
  return { data: result.data };
}

export function dryRun(payload: UploadPayload, uploadedNames: string[]): DryRunReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const referenced = new Set<string>();
  let totalQ = 0;
  let totalScore = 0;

  const checkSlotSum = (q: UploadQuestion, ctx: string) => {
    if (!q.submission_slots || q.submission_slots.length === 0) return;
    const sum = q.submission_slots.reduce((s, slot) => s + slot.max_score, 0);
    if (sum !== q.max_score) {
      warnings.push(`${ctx}: 슬롯 배점 합(${sum})이 max_score(${q.max_score})와 다릅니다`);
    }
    const ids = q.submission_slots.map(s => s.id);
    if (new Set(ids).size !== ids.length) {
      errors.push(`${ctx}: 슬롯 id 중복`);
    }
    // 🔒 보안 경고: placeholder 에 정답이 그대로 들어가면 응시자에게 노출됨
    q.submission_slots.forEach((slot, si) => {
      const ca = slot.correct_answer;
      const ph = slot.placeholder;
      if (ca != null && String(ca).trim() !== '' && ph && String(ph).trim() === String(ca).trim()) {
        errors.push(`${ctx}/슬롯[${slot.id || si}]: placeholder("${ph}")가 정답과 동일합니다 — 응시자에게 정답이 노출됩니다. placeholder 를 비우거나 안내 문구로 바꾸세요.`);
      }
    });
  };

  // 동일 base title 로 여러 세트가 N과목 접미어만 다른 채 분리돼 들어오면 경고
  // 예: "[연습세트03] 1과목 — A", "[연습세트03] 2과목 — B" → 1세트 3과목으로 합쳐야 함
  const baseTitleMap = new Map<string, string[]>();
  const stripSubject = (t: string) =>
    t.replace(/\s*[—\-]\s*.*$/, '')               // " — 부제" 제거
     .replace(/\s*\d+\s*과목.*$/, '')               // " 1과목 ..." 제거
     .replace(/[\[\]()（）]/g, '')
     .trim();

  payload.sets.forEach((set, si) => {
    const ctxS = `세트${si + 1}(${set.title})`;
    const base = stripSubject(set.title);
    if (base) {
      const arr = baseTitleMap.get(base) || [];
      arr.push(set.title);
      baseTitleMap.set(base, arr);
    }
    (set.attachment_refs || []).forEach(n => referenced.add(n));
    set.questions.forEach((q, qi) => {
      const ctxQ = `${ctxS}/Q${qi + 1}`;
      totalQ++;
      totalScore += q.max_score;
      checkSlotSum(q, ctxQ);
      (q.attachment_refs || []).forEach(n => referenced.add(n));
      if (q.type === 'multiple_choice' && (!q.options || q.options.length < 2)) {
        errors.push(`${ctxQ}: 객관식은 보기 2개 이상 필요`);
      }
    });
    // 세트가 과목 1개 + 제목에 "N과목" 패턴 → 잘못 분리된 신호
    if (set.questions.length === 1 && /\d+\s*과목/.test(set.title)) {
      warnings.push(`${ctxS}: 제목에 "N과목" 표기가 있지만 문제가 1개입니다. 같은 시나리오의 과목들을 하나의 세트(questions 배열)로 합쳐야 합니다.`);
    }
  });

  // 동일 base title 묶음 경고 → 오류 처리 (실수 방지)
  baseTitleMap.forEach((titles, base) => {
    if (titles.length > 1) {
      errors.push(
        `세트 분리 오류: 동일 시나리오로 보이는 세트 ${titles.length}개가 따로 등록되려 합니다 — "${base}"\n` +
        `  → ${titles.map(t => `"${t}"`).join(', ')}\n` +
        `  하나의 "sets" 항목 안에 "questions" 배열로 과목을 모두 넣어 주세요.`
      );
    }
  });

  payload.standalone.forEach((q, qi) => {
    const ctxQ = `독립Q${qi + 1}`;
    totalQ++;
    totalScore += q.max_score;
    checkSlotSum(q, ctxQ);
    (q.attachment_refs || []).forEach(n => referenced.add(n));
    if (!q.category) errors.push(`${ctxQ}: 독립 문항은 category 필수`);
  });

  const uploadedSet = new Set(uploadedNames);
  const missing = [...referenced].filter(n => !uploadedSet.has(n));
  const unused = uploadedNames.filter(n => !referenced.has(n));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      set_count: payload.sets.length,
      standalone_count: payload.standalone.length,
      total_questions: totalQ,
      total_score: totalScore,
      missing_attachments: missing,
      unused_attachments: unused,
    },
  };
}

// ── 업로드/커밋 ────────────────────────────────────────────
const BUCKET = 'question-attachments';

// Storage path는 ASCII만 허용되므로 한글/특수문자는 모두 제거하고 확장자만 보존.
// 표시용 원본 파일명(한글 포함)은 DB attachments.name 필드에 그대로 저장.
function safeStoragePath(name: string): string {
  const dot = name.lastIndexOf('.');
  const rawExt = dot >= 0 ? name.slice(dot + 1) : '';
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase();
  const rand = (crypto as any)?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return ext ? `${rand}.${ext}` : rand;
}

export async function uploadAttachments(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, { name: string; url: string; size: number; mime: string }>> {
  const out: Record<string, { name: string; url: string; size: number; mime: string }> = {};
  const ts = Date.now();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = `sets/${ts}/${i}_${safeStoragePath(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, {
      contentType: f.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw new Error(`첨부 업로드 실패 (${f.name}): ${error.message}`);
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    // key는 원본 한글 파일명 유지 (매칭/표시용), name도 원본 그대로 저장
    out[f.name] = { name: f.name, url: pub.publicUrl, size: f.size, mime: f.type };
    onProgress?.(i + 1, files.length);
  }
  return out;
}

export interface CommitResult {
  set_ids: string[];
  question_ids: string[];
}

/**
 * 실제 DB 적재. 실패 시 생성한 세트를 best-effort rollback.
 */
export async function commitPayload(
  payload: UploadPayload,
  attachmentMap: Record<string, { name: string; url: string; size: number; mime: string }>,
): Promise<CommitResult> {
  const createdSetIds: string[] = [];
  const createdQuestionIds: string[] = [];

  const resolveRefs = (refs?: string[]) =>
    (refs || []).map(n => attachmentMap[n]).filter(Boolean);

  try {
    // 1) 세트 + 세트 소속 문항
    for (const set of payload.sets) {
      const setAttachments = resolveRefs(set.attachment_refs);
      const slotSum = set.questions.reduce((s, q) => s + q.max_score, 0);
      const { data: insertedSet, error: setErr } = await supabase
        .from('question_sets')
        .insert({
          title: set.title,
          scenario: set.scenario,
          category: set.category ?? null,
          grade: set.grade ?? null,
          difficulty: set.difficulty,
          tags: set.tags,
          order_num: set.order_num,
          total_score: slotSum,
          attachments: setAttachments as any,
        })
        .select('id')
        .single();
      if (setErr || !insertedSet) throw new Error(`세트 등록 실패: ${setErr?.message}`);
      createdSetIds.push(insertedSet.id);

      const qRows = set.questions.map((q, idx) => ({
        category: q.category ?? set.category ?? '생성형AI활용',
        grade: q.grade ?? set.grade ?? null,
        difficulty: q.difficulty,
        type: q.type,
        content: q.content,
        max_score: q.max_score,
        tags: q.tags,
        allow_file_upload: q.allow_file_upload,
        options: (q.options ?? null) as any,
        correct_answer: q.correct_answer ?? null,
        attachments: resolveRefs(q.attachment_refs) as any,
        submission_slots: (q.submission_slots ?? null) as any,
        set_id: insertedSet.id,
        set_order: q.set_order ?? idx + 1,
        order_num: idx + 1,
      }));
      const { data: insertedQs, error: qErr } = await supabase
        .from('questions')
        .insert(qRows)
        .select('id');
      if (qErr) throw new Error(`세트 문항 등록 실패: ${qErr.message}`);
      createdQuestionIds.push(...(insertedQs || []).map(r => r.id));
    }

    // 2) 독립 문항
    if (payload.standalone.length > 0) {
      const rows = payload.standalone.map((q, idx) => ({
        category: q.category!,
        grade: q.grade ?? null,
        difficulty: q.difficulty,
        type: q.type,
        content: q.content,
        max_score: q.max_score,
        tags: q.tags,
        allow_file_upload: q.allow_file_upload,
        options: (q.options ?? null) as any,
        correct_answer: q.correct_answer ?? null,
        attachments: resolveRefs(q.attachment_refs) as any,
        submission_slots: (q.submission_slots ?? null) as any,
        set_id: null,
        set_order: null,
        order_num: idx + 1,
      }));
      const { data: insertedQs, error: qErr } = await supabase
        .from('questions')
        .insert(rows)
        .select('id');
      if (qErr) throw new Error(`독립 문항 등록 실패: ${qErr.message}`);
      createdQuestionIds.push(...(insertedQs || []).map(r => r.id));
    }

    return { set_ids: createdSetIds, question_ids: createdQuestionIds };
  } catch (err) {
    // best-effort rollback
    if (createdQuestionIds.length > 0) {
      await supabase.from('questions').delete().in('id', createdQuestionIds);
    }
    if (createdSetIds.length > 0) {
      await supabase.from('question_sets').delete().in('id', createdSetIds);
    }
    throw err;
  }
}

// ── 샘플 ───────────────────────────────────────────────────
// 운영 표준: 1세트 = 3과목 = 3문제(작업형), 각 문제는 슬롯 N개
// 슬롯마다 정답(correct_answer)/채점방식(auto_grade)/채점기준(rubric)을 명시
export const SAMPLE_PAYLOAD: UploadPayload = {
  version: 1,
  sets: [
    {
      title: '실습세트01: AI 기반 고객 응대 자동화',
      scenario:
        '## 시나리오\n' +
        '귀하는 OO기업 디지털혁신팀 담당자입니다. 첨부된 case_study.pdf 와 sample_data.csv 를 참고하여 아래 3개 과목의 과제를 수행하세요.\n\n' +
        '- 제출물은 모두 본인이 직접 작성/실행해야 합니다.\n' +
        '- 외부 URL 은 평가 종료 전까지 접근 가능해야 합니다.',
      category: '생성형AI활용',
      grade: 'blue',
      difficulty: 'medium',
      tags: ['실습', '시나리오'],
      order_num: 1,
      attachment_refs: ['case_study.pdf'],
      questions: [
        // ───── 과목 1: 생성형AI활용 ─────
        {
          set_order: 1,
          content:
            '## 과목1. 생성형 AI 활용 (100점)\n' +
            '시나리오에 제시된 고객 문의 데이터를 학습/참고하여 LLM 기반 자동응답 프로토타입을 구축하고, 결과를 제출하세요.',
          type: 'work_based',
          category: '생성형AI활용',
          max_score: 100,
          difficulty: 'medium',
          tags: [],
          allow_file_upload: true,
          attachment_refs: ['case_study.pdf'],
          correct_answer: '과목1 종합 모범답안/해설 (관리자·AI 참고용)',
          submission_slots: [
            {
              id: 'prompt_url',
              type: 'url',
              label: '(1) 프롬프트 공유 URL',
              max_score: 30,
              required: true,
              auto_grade: 'none',
              rubric:
                'URL 접속하여 프롬프트 구조 확인 후 수동 채점.\n' +
                '- 역할/제약/예시 포함: 10점\n- 시나리오 반영: 10점\n- 재현 가능성: 10점',
            },
            {
              id: 'demo_url',
              type: 'url',
              label: '(2) 데모 실행 URL',
              max_score: 50,
              required: true,
              auto_grade: 'none',
              rubric:
                'URL 접속하여 실제 동작 확인 후 수동 채점.\n' +
                '- 기본 동작: 20점\n- 엣지케이스 처리: 15점\n- UX 완성도: 15점',
            },
            {
              id: 'model_name',
              type: 'text',
              label: '(3) 사용한 모델명',
              max_score: 10,
              required: true,
              correct_answer: 'gpt-4o-mini',
              auto_grade: 'exact',
              rubric: '정확히 일치 시 정답 (예: gpt-4o-mini)',
            },
            {
              id: 'token_count',
              type: 'number',
              label: '(4) 평균 응답 토큰 수',
              max_score: 10,
              required: true,
              correct_answer: 350,
              auto_grade: 'numeric',
              tolerance: 50,
              rubric: '350 ±50 범위면 정답',
            },
          ],
        },
        // ───── 과목 2: 데이터분석 ─────
        {
          set_order: 2,
          content:
            '## 과목2. 데이터 분석 (100점)\n' +
            '첨부 sample_data.csv 를 분석하여 핵심 인사이트를 도출하고 검증 코드를 제출하세요.',
          type: 'work_based',
          category: '데이터분석',
          max_score: 100,
          difficulty: 'medium',
          tags: [],
          allow_file_upload: true,
          attachment_refs: ['sample_data.csv'],
          correct_answer: '과목2 종합 모범답안/해설',
          submission_slots: [
            {
              id: 'notebook_url',
              type: 'url',
              label: '(1) 분석 노트북 URL (Colab 등)',
              max_score: 60,
              required: true,
              auto_grade: 'none',
              rubric:
                '노트북 접속 → 코드/결과 확인 후 수동 채점.\n' +
                '- 데이터 정제: 15점\n- EDA: 20점\n- 결론 도출: 25점',
            },
            {
              id: 'code_file',
              type: 'file',
              label: '(2) 코드 파일 (.py/.ipynb)',
              max_score: 20,
              required: true,
              accept: '.py,.ipynb',
              max_size_mb: 10,
              auto_grade: 'none',
              rubric: '파일 다운로드 후 코드 품질 수동 채점',
            },
            {
              id: 'top_feature',
              type: 'text',
              label: '(3) 가장 중요한 변수명',
              max_score: 10,
              required: true,
              correct_answer: 'tenure',
              auto_grade: 'exact',
              rubric: '정답: tenure',
            },
            {
              id: 'churn_rate',
              type: 'number',
              label: '(4) 이탈률(%) — 소수 1자리',
              max_score: 10,
              required: true,
              correct_answer: 26.5,
              auto_grade: 'numeric',
              tolerance: 0.5,
              rubric: '26.5% ±0.5%p 범위 정답',
            },
          ],
        },
        // ───── 과목 3: 서비스구현 ─────
        {
          set_order: 3,
          content:
            '## 과목3. 서비스 구현 (100점)\n' +
            '과목1·2의 결과를 활용하여 간단한 웹 서비스 프로토타입을 배포하세요.',
          type: 'work_based',
          category: '서비스구현',
          max_score: 100,
          difficulty: 'hard',
          tags: [],
          allow_file_upload: true,
          attachment_refs: [],
          correct_answer: '과목3 종합 모범답안/해설',
          submission_slots: [
            {
              id: 'deploy_url',
              type: 'url',
              label: '(1) 배포된 서비스 URL',
              max_score: 50,
              required: true,
              auto_grade: 'none',
              rubric:
                'URL 접속하여 서비스 동작 확인.\n' +
                '- 정상 접속: 10점\n- 핵심 기능: 25점\n- 안정성: 15점',
            },
            {
              id: 'repo_url',
              type: 'url',
              label: '(2) 소스코드 저장소 URL',
              max_score: 30,
              required: true,
              auto_grade: 'none',
              rubric:
                '저장소 접속하여 코드 확인.\n' +
                '- README: 10점\n- 코드 구조: 10점\n- 커밋 이력: 10점',
            },
            {
              id: 'screenshot',
              type: 'file',
              label: '(3) 실행 스크린샷',
              max_score: 10,
              required: true,
              accept: '.png,.jpg,.pdf',
              max_size_mb: 5,
              auto_grade: 'none',
              rubric: '스크린샷 확인 후 수동 채점',
            },
            {
              id: 'response_ms',
              type: 'number',
              label: '(4) 평균 응답시간 (ms)',
              max_score: 10,
              required: true,
              correct_answer: 800,
              auto_grade: 'numeric',
              tolerance: 200,
              rubric: '800ms ±200ms 정답',
            },
          ],
        },
      ],
    },
  ],
  standalone: [],
};
