/**
 * 시험 단위 대용량 내보내기 유틸.
 * - downloadAnswerBundle: 필터된 세션들의 답안 CSV + 제출 첨부파일을 하나의 ZIP으로 다운로드
 * - downloadAnswerKey:   특정 시험의 정답지/채점 규격(슬롯 correct_answer 등)을 ZIP으로 다운로드
 *
 * 모든 조회는 클라이언트에서 RLS 하에 실행된다(관리자 세션 전제).
 */
import JSZip from 'jszip';
import { supabase } from '@/integrations/supabase/client';
import { normalizeQuestion, getSlotValues, type NormalizedQuestion } from '@/lib/examStructure';

const csvEscape = (v: any) => {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const toKst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';

const cleanName = (s: string) =>
  (s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim() || 'unknown';

/** slot_values 의 파일 경로에서 원래 이름 복원 (`_n-<b64>.<ext>` 규칙, 없으면 fallback) */
const decodeStoredName = (rawName: string): string => {
  try {
    const m = rawName.match(/_n-([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$/);
    if (!m) return rawName.split('_').slice(2).join('_') || rawName;
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return rawName;
  }
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 파일 출력 싱크: ZIP 또는 사용자 선택 디렉터리(FileSystem Access API)로 동일 API 사용.
 */
interface OutputSink {
  addFile(path: string, data: Blob | string): Promise<void>;
  finalize(defaultZipName: string): Promise<void>;
}

function createZipSink(): OutputSink {
  const zip = new JSZip();
  return {
    async addFile(path, data) {
      zip.file(path, data as any);
    },
    async finalize(defaultZipName) {
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerBlobDownload(blob, defaultZipName);
    },
  };
}

async function createDirectorySink(): Promise<OutputSink> {
  const anyWin = window as any;
  if (typeof anyWin.showDirectoryPicker !== 'function') {
    throw new Error('이 브라우저는 폴더 선택 저장을 지원하지 않습니다. (Chrome/Edge 계열 필요)');
  }
  const root: any = await anyWin.showDirectoryPicker({ mode: 'readwrite' });
  const ensureDir = async (segments: string[]) => {
    let dir = root;
    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
    return dir;
  };
  return {
    async addFile(path, data) {
      const parts = path.split('/');
      const filename = parts.pop()!;
      const dir = await ensureDir(parts);
      const fh = await dir.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(data as any);
      await w.close();
    },
    async finalize() {
      /* nothing to do */
    },
  };
}

export type SaveMode = 'zip' | 'directory';


export type BundleProgress = { phase: string; current: number; total: number };

export interface BundleSession {
  id: string;
  exam_id: string;
  applicant_id: string;
  submit_time?: string | null;
  score_total?: number | null;
  status?: string | null;
}

export interface BundleExam {
  id: string;
  title: string;
  pass_score?: number | null;
}

export interface BundleProfile {
  name?: string | null;
  organization?: string | null;
}

/**
 * 필터된 세션들의 답안 CSV + 제출 첨부파일을 시험별 폴더 구조로 다운로드.
 *
 * 폴더 구조 (시험명이 최상위):
 *   {시험명}/
 *     answers.csv                                — 해당 시험의 응시자별 답안 요약
 *     attachments/{응시자}/{Q번호}_{슬롯}__{원본파일명}
 *     grading_package/
 *       00_GRADING_INSTRUCTIONS.md
 *       01_rubric.json
 *       02_answer_key.csv
 *       03_scores_template.csv
 *       sets/{세트번호}_{세트명}/README.md, rubric.json, ...
 *
 * saveMode:
 *   - 'zip'       — 브라우저가 하나의 ZIP 파일로 다운로드
 *   - 'directory' — 사용자가 지정한 폴더에 파일을 직접 기록 (Chrome/Edge 계열 지원)
 */
export async function downloadAnswerBundle(params: {
  sessions: BundleSession[];
  exams: Map<string, BundleExam>;
  profiles: Map<string, BundleProfile>;
  emails: Map<string, string>;
  filename?: string;
  saveMode?: SaveMode;
  onProgress?: (p: BundleProgress) => void;
}) {
  const { sessions, exams, profiles, emails, onProgress, saveMode = 'zip' } = params;
  if (sessions.length === 0) throw new Error('다운로드할 세션이 없습니다.');

  // 사용자 폴더 선택은 사용자 제스처가 남아있는 초기에 처리해야 함.
  const sink: OutputSink = saveMode === 'directory' ? await createDirectorySink() : createZipSink();

  onProgress?.({ phase: '답안 조회', current: 0, total: sessions.length });

  const sessionIds = sessions.map((s) => s.id);
  const examIds = [...new Set(sessions.map((s) => s.exam_id))];

  // exam_questions (문항 순서 매핑)
  const { data: eqRows } = await supabase
    .from('exam_questions')
    .select('exam_id, question_id, order_num')
    .in('exam_id', examIds);

  const orderMap = new Map<string, Map<string, number>>();
  (eqRows || []).forEach((r: any) => {
    if (!orderMap.has(r.exam_id)) orderMap.set(r.exam_id, new Map());
    orderMap.get(r.exam_id)!.set(r.question_id, r.order_num ?? 0);
  });

  // 문항 로드
  const qIds = [...new Set((eqRows || []).map((r: any) => r.question_id))];
  const questionsMap = new Map<string, NormalizedQuestion>();
  if (qIds.length > 0) {
    for (let i = 0; i < qIds.length; i += 200) {
      const chunk = qIds.slice(i, i + 200);
      const { data: qs } = await supabase.from('questions').select('*').in('id', chunk);
      (qs || []).forEach((q: any) => questionsMap.set(q.id, normalizeQuestion(q)));
    }
  }

  // 답안 로드
  const allAnswers: any[] = [];
  for (let i = 0; i < sessionIds.length; i += 100) {
    const chunk = sessionIds.slice(i, i + 100);
    const { data } = await supabase.from('answers').select('*').in('session_id', chunk);
    if (data) allAnswers.push(...data);
  }

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const answersBySession = new Map<string, any[]>();
  allAnswers.forEach((a) => {
    if (!answersBySession.has(a.session_id)) answersBySession.set(a.session_id, []);
    answersBySession.get(a.session_id)!.push(a);
  });

  // 세트 메타 로드
  const allSetIds = [...new Set(
    [...questionsMap.values()].map((q) => q.set_id).filter((x): x is string => !!x)
  )];
  const setMap = new Map<string, any>();
  if (allSetIds.length > 0) {
    const { data: setsData } = await supabase
      .from('question_sets')
      .select('id, title, scenario, attachments, total_score, category, grade, difficulty')
      .in('id', allSetIds);
    (setsData || []).forEach((s: any) => setMap.set(s.id, s));
  }

  // 시험명 폴더는 중복 처리
  const examFolderMap = new Map<string, string>();
  const usedFolders = new Set<string>();
  for (const examId of examIds) {
    const base = cleanName(exams.get(examId)?.title || examId);
    let name = base;
    let n = 2;
    while (usedFolders.has(name)) { name = `${base} (${n++})`; }
    usedFolders.add(name);
    examFolderMap.set(examId, name);
  }

  // ── 시험별로 answers.csv + grading_package 작성 ──
  const answerCsvHeaders = [
    'session_id', 'applicant_name', 'applicant_email', 'applicant_org',
    'submit_time_kst', 'session_score_total', 'session_status',
    'question_order', 'question_type', 'question_content', 'max_score',
    'answer_content', 'slot_values', 'score', 'slot_scores', 'feedback',
  ];

  for (const examId of examIds) {
    const examFolder = examFolderMap.get(examId)!;
    const exam = exams.get(examId);
    const examSessions = sessions.filter((s) => s.exam_id === examId);

    // 시험별 answers.csv
    const csvRows: string[] = [answerCsvHeaders.join(',')];
    for (const s of examSessions) {
      const prof = profiles.get(s.applicant_id) || {};
      const email = emails.get(s.applicant_id) || '';
      const ans = answersBySession.get(s.id) || [];
      const oMap = orderMap.get(examId) || new Map();
      ans.sort((a, b) => (oMap.get(a.question_id) ?? 999) - (oMap.get(b.question_id) ?? 999));
      for (const a of ans) {
        const q = questionsMap.get(a.question_id);
        csvRows.push([
          s.id, prof.name || '', email, prof.organization || '',
          toKst(s.submit_time || null), s.score_total ?? '', s.status ?? '',
          oMap.get(a.question_id) ?? '', q?.type ?? '', q?.content ?? '',
          q?.effective_max_score ?? q?.max_score ?? '',
          a.content ?? '',
          a.slot_values ? JSON.stringify(a.slot_values) : '',
          a.score ?? '',
          a.slot_scores ? JSON.stringify(a.slot_scores) : '',
          a.feedback ?? '',
        ].map(csvEscape).join(','));
      }
    }
    await sink.addFile(`${examFolder}/answers.csv`, '\uFEFF' + csvRows.join('\n'));

    // 채점 패키지
    const examQs = (eqRows || [])
      .filter((r: any) => r.exam_id === examId)
      .sort((a: any, b: any) => (a.order_num ?? 0) - (b.order_num ?? 0))
      .map((r: any) => ({ order_num: r.order_num, q: questionsMap.get(r.question_id) }))
      .filter((r) => r.q);
    if (examQs.length === 0) continue;

    const pkgDir = `${examFolder}/grading_package`;
    const pkg = buildGradingPackageFiles(examId, exam?.title || '', examQs, setMap);
    await sink.addFile(`${pkgDir}/00_GRADING_INSTRUCTIONS.md`, pkg.instructionsMd);
    await sink.addFile(`${pkgDir}/01_rubric.json`, pkg.rubricJson);
    await sink.addFile(`${pkgDir}/02_answer_key.csv`, '\uFEFF' + pkg.answerKeyCsv);

    const tpl = buildScoresTemplate(examSessions, profiles, emails, answersBySession, examQs);
    await sink.addFile(`${pkgDir}/03_scores_template.csv`, '\uFEFF' + tpl);

    // 세트별 폴더
    const bySet = new Map<string, PkgQ[]>();
    for (const r of examQs) {
      const sid = r.q?.set_id;
      if (!sid) continue;
      if (!bySet.has(sid)) bySet.set(sid, []);
      bySet.get(sid)!.push(r);
    }
    let setIdx = 0;
    for (const [setId, setQs] of bySet.entries()) {
      setIdx += 1;
      const setMeta = setMap.get(setId);
      const setTitle = setMeta?.title || `세트 ${setIdx}`;
      const setDir = `${pkgDir}/sets/${String(setIdx).padStart(2, '0')}_${cleanName(setTitle)}`;
      const sub = buildSetPackage(setId, setMeta, setQs, examSessions, profiles, emails, answersBySession);
      await sink.addFile(`${setDir}/README.md`, sub.instructionsMd);
      await sink.addFile(`${setDir}/rubric.json`, sub.rubricJson);
      await sink.addFile(`${setDir}/answer_key.csv`, '\uFEFF' + sub.answerKeyCsv);
      await sink.addFile(`${setDir}/scores_template.csv`, '\uFEFF' + sub.scoresCsv);
      if (setMeta?.scenario) {
        await sink.addFile(`${setDir}/scenario.md`, `# ${setTitle}\n\n${setMeta.scenario}`);
      }
    }
  }

  // ── 첨부파일 수집 ──
  type FileTask = { session: BundleSession; a: any; q: NormalizedQuestion | undefined; slotId: string; path: string };
  const tasks: FileTask[] = [];
  for (const a of allAnswers) {
    const s = sessionById.get(a.session_id);
    if (!s) continue;
    const q = questionsMap.get(a.question_id);
    if (!q) continue;
    const slots = q.submission_slots || [];
    const values = getSlotValues(a, slots);
    for (const slot of slots) {
      if (slot.type !== 'file') continue;
      const val = values[slot.id];
      if (!val || /^https?:\/\//i.test(val)) continue;
      tasks.push({ session: s, a, q, slotId: slot.id, path: val });
    }
  }

  onProgress?.({ phase: '첨부파일 다운로드', current: 0, total: tasks.length });

  const CONCURRENCY = 8;
  let doneCount = 0;
  const failures: string[] = [];

  const worker = async (task: FileTask) => {
    try {
      const { data: signed, error } = await supabase.storage
        .from('answer-files')
        .createSignedUrl(task.path, 3600);
      if (error || !signed?.signedUrl) throw new Error(error?.message || 'signed url 실패');
      const res = await fetch(signed.signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const raw = task.path.split('/').pop() || 'file';
      const original = decodeStoredName(raw);
      const prof = profiles.get(task.session.applicant_id) || {};
      const email = emails.get(task.session.applicant_id) || '';
      const examFolder = examFolderMap.get(task.session.exam_id) || 'exam';
      const order = orderMap.get(task.session.exam_id)?.get(task.q!.id) ?? '?';
      const dir = `${examFolder}/attachments/${cleanName(`${prof.name || 'user'}_${email}`)}`;
      const fileName = `Q${order}_${cleanName(task.slotId)}__${cleanName(original)}`;
      await sink.addFile(`${dir}/${fileName}`, blob);
    } catch (e: any) {
      failures.push(`${task.path}: ${e?.message || e}`);
    } finally {
      doneCount += 1;
      if (doneCount % 5 === 0 || doneCount === tasks.length) {
        onProgress?.({ phase: '첨부파일 다운로드', current: doneCount, total: tasks.length });
      }
    }
  };

  const queue = tasks.slice();
  // directory 모드는 병렬 쓰기 락 문제 방지를 위해 순차 처리, zip 은 병렬.
  const concurrency = saveMode === 'directory' ? 1 : CONCURRENCY;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) return;
      await worker(t);
    }
  });
  await Promise.all(runners);

  if (failures.length > 0) {
    await sink.addFile('_download_errors.txt', failures.join('\n'));
  }

  onProgress?.({ phase: saveMode === 'directory' ? '폴더에 저장 중' : 'ZIP 생성', current: 0, total: 1 });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  await sink.finalize(params.filename || `답안+첨부_${ts}.zip`);
}


/**
 * 특정 시험의 정답지 + 채점 규격을 ZIP으로 다운로드.
 * - answer_key.csv: 사람이 보고 채점할 수 있는 요약
 * - answer_key.json: 자동채점/규격 그대로
 * - question_attachments/: 문항에 첨부된 원본 파일 링크 텍스트
 */
export async function downloadAnswerKey(examId: string, examTitle: string) {
  const { data: eqs } = await supabase
    .from('exam_questions')
    .select('question_id, order_num')
    .eq('exam_id', examId)
    .order('order_num', { ascending: true });
  const list = eqs || [];
  if (list.length === 0) throw new Error('시험에 등록된 문항이 없습니다.');

  const qIds = list.map((r: any) => r.question_id);
  const { data: qs } = await supabase.from('questions').select('*').in('id', qIds);
  const byId = new Map<string, any>((qs || []).map((q: any) => [q.id, q]));

  const ordered = list.map((eq: any, idx: number) => {
    const raw = byId.get(eq.question_id);
    return { order_num: eq.order_num ?? idx + 1, raw, normalized: raw ? normalizeQuestion(raw) : null };
  }).filter((r) => r.raw);

  // JSON: 원본 그대로 (자동채점에 필요한 correct_answer 포함)
  const json = ordered.map((r) => ({
    order_num: r.order_num,
    id: r.raw.id,
    type: r.raw.type,
    category: r.raw.category,
    grade: r.raw.grade,
    difficulty: r.raw.difficulty,
    max_score: r.raw.max_score,
    effective_max_score: r.normalized!.effective_max_score,
    content: r.raw.content,
    correct_answer: r.raw.correct_answer,
    options: r.raw.options,           // is_correct 포함
    submission_slots: r.raw.submission_slots, // correct_answer/auto_grade/tolerance/rubric/accept 등 포함
    attachments: r.raw.attachments,
  }));

  // CSV: 채점자 친화 요약 (슬롯별 행)
  const headers = [
    'order_num', 'type', 'category', 'max_score', 'question_content',
    'correct_answer', 'mc_options',
    'slot_id', 'slot_label', 'slot_type', 'slot_max_score',
    'slot_correct_answer', 'slot_auto_grade', 'slot_tolerance',
    'slot_accept', 'slot_max_size_mb', 'slot_rubric',
  ];
  const rows: string[] = [headers.join(',')];
  for (const r of ordered) {
    const q = r.normalized!;
    const mcOpts = Array.isArray(r.raw.options)
      ? r.raw.options.map((o: any) => `${o.is_correct ? '★' : ' '} ${o.text ?? o.label ?? ''}`).join(' | ')
      : '';
    const slots = q.submission_slots || [];
    if (slots.length === 0) {
      rows.push([
        r.order_num, q.type, q.category, q.effective_max_score || q.max_score,
        q.content, r.raw.correct_answer ?? '', mcOpts,
        '', '', '', '', '', '', '', '', '', '',
      ].map(csvEscape).join(','));
    } else {
      for (const slot of slots) {
        rows.push([
          r.order_num, q.type, q.category, q.effective_max_score || q.max_score,
          q.content, r.raw.correct_answer ?? '', mcOpts,
          slot.id, slot.label, slot.type, slot.max_score,
          slot.correct_answer ?? '', slot.auto_grade ?? 'none', slot.tolerance ?? '',
          slot.accept ?? '', slot.max_size_mb ?? '', slot.rubric ?? '',
        ].map(csvEscape).join(','));
      }
    }
  }

  const zip = new JSZip();
  zip.file('answer_key.csv', '\uFEFF' + rows.join('\n'));
  zip.file('answer_key.json', JSON.stringify({ exam_id: examId, exam_title: examTitle, questions: json }, null, 2));

  // 문항 첨부 파일 목록 (URL 텍스트)
  const attList: string[] = [];
  ordered.forEach((r) => {
    const atts = Array.isArray(r.raw.attachments) ? r.raw.attachments : [];
    atts.forEach((a: any) => {
      attList.push(`Q${r.order_num}\t${a.name || ''}\t${a.url || ''}`);
    });
  });
  if (attList.length > 0) {
    zip.file('question_attachments.tsv', 'question\tname\turl\n' + attList.join('\n'));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(blob, `채점자료_${cleanName(examTitle)}.zip`);
}

// ─────────────────────────────────────────────────────────────
// 채점 패키지 (외부 AI 에이전트용)
// ─────────────────────────────────────────────────────────────
type PkgQ = { order_num: number; q: NormalizedQuestion | undefined };

function buildGradingPackageFiles(examId: string, examTitle: string, examQs: PkgQ[], setMap: Map<string, any>) {
  const rubricJson = JSON.stringify(
    {
      exam_id: examId,
      exam_title: examTitle,
      generated_at: new Date().toISOString(),
      questions: examQs.map((r) => {
        const q = r.q!;
        return {
          order_num: r.order_num,
          question_id: q.id,
          set_id: q.set_id,
          set_order: q.set_order,
          type: q.type,
          category: q.category,
          max_score: q.max_score,
          effective_max_score: q.effective_max_score,
          content: q.content,
          correct_answer: q.correct_answer ?? null,
          options: q.options ?? null,
          submission_slots: (q.submission_slots || []).map((s) => ({
            id: s.id,
            type: s.type,
            label: s.label,
            max_score: s.max_score,
            correct_answer: s.correct_answer ?? null,
            auto_grade: s.auto_grade ?? 'none',
            tolerance: s.tolerance ?? null,
            rubric: s.rubric ?? null,
            accept: s.accept ?? null,
            max_size_mb: s.max_size_mb ?? null,
          })),
          attachments: q.attachments ?? [],
        };
      }),
    },
    null,
    2,
  );

  const headers = [
    'order_num', 'question_id', 'set_id', 'type', 'max_score',
    'slot_id', 'slot_label', 'slot_type', 'slot_max_score',
    'slot_correct_answer', 'slot_auto_grade', 'slot_accept', 'slot_rubric',
    'question_content',
  ];
  const rows: string[] = [headers.join(',')];
  for (const r of examQs) {
    const q = r.q!;
    const slots = q.submission_slots || [];
    if (slots.length === 0) {
      rows.push([r.order_num, q.id, q.set_id ?? '', q.type, q.max_score, '', '', '', '', q.correct_answer ?? '', '', '', '', q.content].map(csvEscape).join(','));
    } else {
      for (const s of slots) {
        rows.push([
          r.order_num, q.id, q.set_id ?? '', q.type, q.max_score,
          s.id, s.label, s.type, s.max_score,
          s.correct_answer ?? '', s.auto_grade ?? 'none', s.accept ?? '', s.rubric ?? '',
          q.content,
        ].map(csvEscape).join(','));
      }
    }
  }

  // 세트 목록 요약
  const setIdsInOrder: string[] = [];
  const seen = new Set<string>();
  for (const r of examQs) {
    const sid = r.q?.set_id;
    if (sid && !seen.has(sid)) { seen.add(sid); setIdsInOrder.push(sid); }
  }
  const setLines = setIdsInOrder.map((sid, i) => {
    const meta = setMap.get(sid);
    const title = meta?.title || `세트 ${i + 1}`;
    const subQs = examQs.filter((r) => r.q?.set_id === sid);
    const totalMax = subQs.reduce((s, r) => s + (r.q?.effective_max_score || 0), 0);
    const folder = `sets/${String(i + 1).padStart(2, '0')}_${cleanName(title)}`;
    return `  - **${title}** (${subQs.length}문항 · ${totalMax}점) → \`${folder}/\``;
  }).join('\n');

  const hasSet = setIdsInOrder.length > 0;
  const instructionsMd = `# 외부 AI 채점 지침 — ${examTitle}

## 개요
- 시험 ID: \`${examId}\`
- 총 문항: ${examQs.length}개
- 세트 문항 여부: ${hasSet ? `있음 (${setIdsInOrder.length}개 세트)` : '없음'}

## 파일 구성
- \`00_GRADING_INSTRUCTIONS.md\` — 본 지침 (에이전트 시스템 프롬프트로 사용)
- \`01_rubric.json\` — 전체 문항×슬롯 정답/rubric/파일규격 (machine-readable)
- \`02_answer_key.csv\` — 사람 친화 정답지 요약
- \`03_scores_template.csv\` — **전체 시험 통합 채점 입력 템플릿** (반환용)
${hasSet ? `- \`sets/\` — 세트별 세부 지침·rubric·부분 템플릿\n${setLines}\n` : ''}- \`../answers.csv\` — 응시자 답안 원본 (이 시험)
- \`../attachments/{응시자}/{Q번호}_{슬롯}__{원본파일}\` — 제출 첨부


## 채점 절차 (에이전트용)
${hasSet ? `1. **세트 문항 우선**: \`sets/{세트폴더}/README.md\` 를 먼저 읽어 세트별 시나리오·평가 기준을 파악한다.
2. 세트 내 각 문항의 슬롯을 \`sets/{세트폴더}/rubric.json\` 기준으로 채점한다.
3. 세트별 \`scores_template.csv\` 대신, **최종 결과는 최상위 \`03_scores_template.csv\` 하나에 통합**해서 반환한다. (세트별 부분 CSV 는 작업 편의용)
4. 단독(비-세트) 문항은 \`01_rubric.json\` 을 사용해 동일 절차로 채점한다.` : `1. \`01_rubric.json\` 로드하여 각 문항의 슬롯 정의를 파악한다.
2. \`../answers.csv\` 와 \`../attachments/\` 로부터 응시자별 답안을 읽는다.
3. 각 슬롯을 채점한다.`}

## 슬롯 타입별 채점 방법
- **type=text / number / url** → \`slot_correct_answer\` + \`slot_rubric\` 기준
- **type=file** → 첨부 파일을 실제 열어 요구사항(코드 정상 실행, 결과 CSV 스키마, 문서 요구항목) 충족 여부 검증
- **auto_grade=exact / numeric** → 정확일치 / 수치 오차 허용 채점

## 출력 형식
- \`03_scores_template.csv\` 각 행에 \`score\` 와 \`feedback\` 을 채운다.
- \`score\` 는 반드시 \`0 <= score <= slot_max_score\` 정수
- \`feedback\` 은 채점 근거 1~3 문장 (한국어)
- 채운 CSV 를 반환 → 채점관리 화면의 **"채점 CSV 업로드"** 로 반영한다.

## 채점 원칙
- rubric 이 있으면 rubric 을 우선한다.
- 근거 없이 만점/영점을 주지 않는다.
- 파일이 미제출이면 0점, feedback 에 "미제출" 표기.
- 애매하면 부분점수 (rubric 배분에 따라).
${hasSet ? '- 세트 내 문항 간 상호 종속(예: 과목1 결과를 과목2 입력으로 사용)은 세트 README 에 명시된 경우에만 고려한다.' : ''}
`;

  return { rubricJson, answerKeyCsv: rows.join('\n'), instructionsMd };
}

/**
 * 세트별 하위 패키지 생성.
 * - README.md: 시나리오 + 세트 채점 지침
 * - rubric.json: 세트 소속 문항만
 * - answer_key.csv: 세트 소속 문항만
 * - scores_template.csv: 이 세트 슬롯만 (작업 편의용, 최종 제출은 상위 통합 CSV)
 */
function buildSetPackage(
  setId: string,
  setMeta: any,
  setQs: PkgQ[],
  examSessions: BundleSession[],
  profiles: Map<string, BundleProfile>,
  emails: Map<string, string>,
  answersBySession: Map<string, any[]>,
) {
  const setTitle = setMeta?.title || `세트 ${setId.slice(0, 6)}`;
  const totalMax = setQs.reduce((s, r) => s + (r.q?.effective_max_score || 0), 0);

  const rubricJson = JSON.stringify(
    {
      set_id: setId,
      set_title: setTitle,
      set_category: setMeta?.category ?? null,
      set_grade: setMeta?.grade ?? null,
      set_difficulty: setMeta?.difficulty ?? null,
      set_total_score: totalMax,
      scenario: setMeta?.scenario ?? '',
      attachments: Array.isArray(setMeta?.attachments) ? setMeta.attachments : [],
      questions: setQs.map((r) => {
        const q = r.q!;
        return {
          order_num: r.order_num,
          set_order: q.set_order,
          question_id: q.id,
          type: q.type,
          category: q.category,
          max_score: q.max_score,
          effective_max_score: q.effective_max_score,
          content: q.content,
          correct_answer: q.correct_answer ?? null,
          options: q.options ?? null,
          submission_slots: (q.submission_slots || []).map((s) => ({
            id: s.id,
            type: s.type,
            label: s.label,
            max_score: s.max_score,
            correct_answer: s.correct_answer ?? null,
            auto_grade: s.auto_grade ?? 'none',
            tolerance: s.tolerance ?? null,
            rubric: s.rubric ?? null,
            accept: s.accept ?? null,
            max_size_mb: s.max_size_mb ?? null,
          })),
          attachments: q.attachments ?? [],
        };
      }),
    },
    null,
    2,
  );

  const headers = [
    'order_num', 'set_order', 'question_id', 'type', 'max_score',
    'slot_id', 'slot_label', 'slot_type', 'slot_max_score',
    'slot_correct_answer', 'slot_auto_grade', 'slot_accept', 'slot_rubric',
    'question_content',
  ];
  const rows: string[] = [headers.join(',')];
  for (const r of setQs) {
    const q = r.q!;
    const slots = q.submission_slots || [];
    if (slots.length === 0) {
      rows.push([r.order_num, q.set_order ?? '', q.id, q.type, q.max_score, '', '', '', '', q.correct_answer ?? '', '', '', '', q.content].map(csvEscape).join(','));
    } else {
      for (const s of slots) {
        rows.push([
          r.order_num, q.set_order ?? '', q.id, q.type, q.max_score,
          s.id, s.label, s.type, s.max_score,
          s.correct_answer ?? '', s.auto_grade ?? 'none', s.accept ?? '', s.rubric ?? '',
          q.content,
        ].map(csvEscape).join(','));
      }
    }
  }

  // 세트별 부분 scores_template
  const scoresCsv = buildScoresTemplate(examSessions, profiles, emails, answersBySession, setQs);

  // 문항 목록 요약 (README 용)
  const questionSummary = setQs.map((r) => {
    const q = r.q!;
    const slotList = (q.submission_slots || []).map((s) =>
      `    - \`${s.id}\` (${s.type}, ${s.max_score}점)${s.correct_answer ? ` — 정답: \`${s.correct_answer}\`` : ''}${s.rubric ? `\n      · rubric: ${s.rubric.replace(/\n/g, ' ')}` : ''}${s.accept ? `\n      · accept: ${s.accept}` : ''}`,
    ).join('\n');
    return `### ${r.order_num}. ${q.type} — ${q.effective_max_score}점\n\n${q.content.split('\n').slice(0, 3).join('\n')}\n\n**슬롯:**\n${slotList}`;
  }).join('\n\n---\n\n');

  const scenarioBlock = setMeta?.scenario
    ? `## 시나리오 / 배경\n\n${setMeta.scenario}\n`
    : '';
  const attList = Array.isArray(setMeta?.attachments) && setMeta.attachments.length > 0
    ? `## 세트 첨부자료\n\n${setMeta.attachments.map((a: any) => `- [${a.name || 'attachment'}](${a.url || ''})`).join('\n')}\n`
    : '';

  const instructionsMd = `# ${setTitle}

- 세트 ID: \`${setId}\`
- 문항 수: ${setQs.length}
- 총 배점: ${totalMax}점
- 카테고리: ${setMeta?.category ?? '-'} / 난이도: ${setMeta?.difficulty ?? '-'}

${scenarioBlock}${attList}
## 세트 채점 지침

1. 이 세트는 하나의 시나리오 위에서 여러 문항이 이어지므로, **문항 간 결과 일관성**을 확인한다.
   - 예: 과목1 에서 산출한 지표가 과목2 의 전처리 입력으로 쓰이는 경우, 값이 이어지지 않아도 각 문항은 독립적으로 rubric 대로 채점한다.
2. 파일 슬롯(\`type=file\`)은 첨부를 실제 열어 다음을 확인한다:
   - 형식 규격 (\`accept\`) 준수
   - 본문 요구항목 충족 (rubric 참조)
   - 코드/스크립트는 정적 검토 + 명백한 실행 오류 여부
3. URL 슬롯(\`type=url\`)은 접속 여부와 요구 기능 구현 여부를 rubric 대로 확인.
4. 텍스트/숫자 슬롯은 \`slot_correct_answer\` 가 있으면 그것을 기준으로, 없으면 rubric 으로 판단.

## 문항 목록

${questionSummary}

## 출력

이 세트만 채점한 결과는 \`scores_template.csv\` 에 임시로 채워도 되지만,
**최종 반환은 상위 폴더의 \`../../03_scores_template.csv\` 하나에 통합**한다.
`;

  return { rubricJson, answerKeyCsv: rows.join('\n'), scoresCsv, instructionsMd };
}


function buildScoresTemplate(
  examSessions: BundleSession[],
  profiles: Map<string, BundleProfile>,
  emails: Map<string, string>,
  answersBySession: Map<string, any[]>,
  examQs: PkgQ[],
): string {
  const headers = [
    'session_id', 'applicant_name', 'applicant_email',
    'question_id', 'order_num', 'slot_id', 'slot_label', 'slot_max_score',
    'submitted_value', 'score', 'feedback',
  ];
  const rows: string[] = [headers.join(',')];

  for (const s of examSessions) {
    const prof = profiles.get(s.applicant_id) || {};
    const email = emails.get(s.applicant_id) || '';
    const ans = answersBySession.get(s.id) || [];
    const ansByQ = new Map(ans.map((a) => [a.question_id, a]));
    for (const r of examQs) {
      const q = r.q!;
      const a = ansByQ.get(q.id);
      const slots = q.submission_slots || [];
      const values = a ? getSlotValues(a, slots) : {};
      for (const slot of slots) {
        const v = values[slot.id] ?? '';
        rows.push([
          s.id, prof.name || '', email,
          q.id, r.order_num, slot.id, slot.label, slot.max_score,
          v, '', '',
        ].map(csvEscape).join(','));
      }
    }
  }
  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────────
// 채점 결과 CSV 업로드 → answers.slot_scores / score / feedback 반영
// ─────────────────────────────────────────────────────────────
export interface ImportScoresResult {
  updated_answers: number;
  updated_sessions: number;
  errors: string[];
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQ = false;
  const stripped = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (inQ) {
      if (c === '"' && stripped[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { field += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export async function importScoresCsv(csvText: string): Promise<ImportScoresResult> {
  const rows = parseCsv(csvText);
  const errors: string[] = [];
  if (rows.length === 0) throw new Error('CSV 에 데이터가 없습니다.');

  const grouped = new Map<string, { session_id: string; question_id: string; slots: Record<string, { score: number; feedback: string }> }>();

  for (const r of rows) {
    const sid = r.session_id;
    const qid = r.question_id;
    const slot = r.slot_id || 'default';
    const scoreStr = r.score;
    if (!sid || !qid) { errors.push(`session_id/question_id 누락: ${JSON.stringify(r)}`); continue; }
    if (scoreStr === '' || scoreStr == null) continue;
    const score = Number(scoreStr);
    if (!Number.isFinite(score) || score < 0) { errors.push(`잘못된 점수(${scoreStr}) — ${sid}/${qid}/${slot}`); continue; }
    const key = `${sid}|${qid}`;
    if (!grouped.has(key)) grouped.set(key, { session_id: sid, question_id: qid, slots: {} });
    grouped.get(key)!.slots[slot] = { score, feedback: r.feedback || '' };
  }

  const sessionIds = [...new Set([...grouped.values()].map((g) => g.session_id))];
  const { data: ansRows } = await supabase
    .from('answers').select('id, session_id, question_id, slot_scores, feedback').in('session_id', sessionIds);
  const ansByKey = new Map<string, any>();
  (ansRows || []).forEach((a: any) => ansByKey.set(`${a.session_id}|${a.question_id}`, a));

  let updatedAnswers = 0;
  for (const g of grouped.values()) {
    const existing = ansByKey.get(`${g.session_id}|${g.question_id}`);
    if (!existing) { errors.push(`answer 없음: ${g.session_id}/${g.question_id}`); continue; }
    const merged = { ...(existing.slot_scores || {}), ...Object.fromEntries(Object.entries(g.slots).map(([k, v]) => [k, v.score])) };
    const total: number = Object.values(merged).reduce<number>((a, b) => a + (Number(b) || 0), 0);
    const feedbackLines = Object.entries(g.slots)
      .filter(([, v]) => v.feedback)
      .map(([sid, v]) => `[${sid}] ${v.feedback}`);
    const feedback = feedbackLines.length > 0 ? `[외부 AI 채점]\n${feedbackLines.join('\n')}` : (existing.feedback || null);
    const { error } = await supabase.from('answers').update({
      slot_scores: merged, score: total, feedback,
    }).eq('id', existing.id);
    if (error) { errors.push(`update 실패: ${existing.id} — ${error.message}`); continue; }
    updatedAnswers += 1;
  }

  const updatedSessionIds = new Set<string>();
  for (const sid of sessionIds) {
    const { data: sess } = await supabase.from('exam_sessions').select('id, exam_id').eq('id', sid).maybeSingle();
    if (!sess) continue;
    const { data: exam } = await supabase.from('exams').select('pass_score').eq('id', sess.exam_id).maybeSingle();
    const { data: eqs } = await supabase.from('exam_questions').select('question_id').eq('exam_id', sess.exam_id);
    const qIds = (eqs || []).map((e: any) => e.question_id);
    const { data: qs } = qIds.length > 0
      ? await supabase.from('questions').select('id, max_score, submission_slots').in('id', qIds)
      : { data: [] as any[] };
    const maxPossible = (qs || []).reduce((sum: number, q: any) => {
      const slots = Array.isArray(q.submission_slots) ? q.submission_slots : [];
      const slotSum = slots.reduce((a: number, s: any) => a + (Number(s.max_score) || 0), 0);
      return sum + (slotSum > 0 ? slotSum : (q.max_score || 0));
    }, 0);
    const { data: allAns } = await supabase.from('answers').select('score').eq('session_id', sid);
    const raw = (allAns || []).reduce((a: number, x: any) => a + (Number(x.score) || 0), 0);
    const normalized = maxPossible > 0 ? Math.round((raw / maxPossible) * 100) : 0;
    const passScore = exam?.pass_score ?? 75;
    const status = normalized >= passScore ? 'passed' : 'failed';
    const { error } = await supabase.from('exam_sessions').update({ score_total: normalized, status }).eq('id', sid);
    if (!error) updatedSessionIds.add(sid);
    else errors.push(`session 업데이트 실패: ${sid} — ${error.message}`);
  }

  return { updated_answers: updatedAnswers, updated_sessions: updatedSessionIds.size, errors };
}
