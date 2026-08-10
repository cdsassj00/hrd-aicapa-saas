import * as XLSX from 'xlsx';

export interface ParsedAttachment {
  name: string;
  url: string;
  path?: string;
}

export interface ParsedQuestion {
  code: string | null;
  category: string;
  grade: string | null;
  difficulty: string;
  type: string;
  content: string;
  max_score: number;
  tags: string[];
  allow_file_upload: boolean;
  options: { id: string; text: string; is_correct: boolean }[] | null;
  correct_answer: string | null;
  order_num: number;
  attachments: ParsedAttachment[];
}


const VALID_CATEGORIES = ['생성형AI활용', '데이터분석', '서비스구현'];
const VALID_GRADES = ['green', 'blue', 'black', '전문인재'];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
const VALID_TYPES = ['essay', 'short_answer', 'multiple_choice', 'file_upload', 'work_based'];

const DIFFICULTY_MAP: Record<string, string> = {
  '상': 'hard', '중': 'medium', '하': 'easy',
  hard: 'hard', medium: 'medium', easy: 'easy',
};

const TYPE_MAP: Record<string, string> = {
  '서술형': 'essay', '단답형': 'short_answer', '객관식': 'multiple_choice',
  '실기형': 'file_upload', '작업형': 'work_based',
  // English aliases
  essay: 'essay', short_answer: 'short_answer', multiple_choice: 'multiple_choice',
  file_upload: 'file_upload', work_based: 'work_based',
  // Legacy aliases (auto-correct)
  practical: 'file_upload', task: 'work_based',
};

const GRADE_MAP: Record<string, string> = {
  '그린': 'green', '블루': 'blue', '블랙': 'black', '전문인재': '전문인재',
  green: 'green', blue: 'blue', black: 'black',
};

export function generateTemplate(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const headers = [
    '문제코드', '카테고리*', '등급', '난이도*', '유형*', '문제내용*', '배점',
    '태그', '파일업로드허용', '보기1', '보기2', '보기3', '보기4', '보기5', '정답',
    '첨부파일URL',
  ];

  const sample = [
    ['Q-G-001', '생성형AI활용', '그린', '중', '서술형', 'AI 모델의 학습 과정을 설명하시오.', 10, 'AI,학습', '', '', '', '', '', '', '', ''],
    ['Q-B-001', '데이터분석', '블루', '하', '객관식', '다음 중 데이터 전처리 방법이 아닌 것은?', 5, '데이터,전처리', '', '정규화', '표준화', '이상치 제거', '모델 학습', '', '4', ''],
    ['', '서비스구현', '', '상', '단답형', 'REST API에서 리소스를 삭제할 때 사용하는 HTTP 메서드는?', 5, 'API,REST', '', '', '', '', '', '', 'DELETE', ''],
    ['Q-K-001', '생성형AI활용', '블랙', '중', '실기형', '주어진 데이터셋을 분석하여 보고서를 작성하시오.', 20, '실기,분석', 'O', '', '', '', '', '', '', 'https://example.com/dataset.csv'],
    ['Q-K-002', '서비스구현', '블랙', '상', '작업형', '제공된 스펙에 따라 REST API 엔드포인트를 구현하고, 결과 파일(zip)을 업로드하시오.', 30, '작업형,API,실습', 'O', '', '', '', '', '', '', 'https://example.com/spec.pdf, https://example.com/starter.zip'],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);

  // Column widths
  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 40 }, { wch: 6 },
    { wch: 15 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 8 },
    { wch: 40 },
  ];


  XLSX.utils.book_append_sheet(wb, ws, '문제은행');

  // 안내 시트 (작업형/실기형 첨부 안내)
  const guide = [
    ['문제은행 일괄 업로드 가이드'],
    [''],
    ['■ 문제코드: 비워두면 매번 신규 등록. 코드를 적으면 같은 코드의 기존 문제를 본문/배점/태그/보기/첨부 등 모든 필드 덮어쓰기(시험 연결과 응시 기록은 보존).'],

    ['■ 유형(한글/영문 모두 허용): 서술형 essay / 단답형 short_answer / 객관식 multiple_choice / 실기형 file_upload / 작업형 work_based'],
    ['■ 파일업로드허용: O 또는 빈칸. 실기형/작업형은 보통 O.'],
    ['■ 첨부파일URL: 문제에 제공할 자료(스펙 문서, 데이터셋, 스타터 코드 등) 공개 URL. 쉼표(,)로 여러 개 입력 가능.'],
    ['  - 엑셀에는 바이너리 파일을 직접 넣을 수 없습니다. 미리 어딘가에 업로드하고 URL을 넣으세요.'],
    ['  - URL이 없으면 일괄 업로드 후 각 문제 편집창에서 "파일 추가"로 첨부할 수 있습니다.'],
    ['■ 객관식 정답: 1~5 (정답 보기 번호).'],
    ['■ 단답형 정답: 문자열(쉼표로 복수 정답 가능).'],
    ['■ 태그: 쉼표로 구분. 예) 2026상반기,그린-1차'],
  ];
  const gws = XLSX.utils.aoa_to_sheet(guide);
  gws['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, gws, '가이드');

  return wb;
}

export function downloadTemplate() {
  const wb = generateTemplate();
  XLSX.writeFile(wb, '문제은행_템플릿.xlsx');
}

export function parseFile(file: File): Promise<ParsedQuestion[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (rows.length < 2) {
          reject(new Error('데이터가 없습니다. 헤더 아래에 문제를 입력해 주세요.'));
          return;
        }

        // Header-based column mapping (supports new template with 문제코드 + old template without it)
        const header = (rows[0] || []).map(c => String(c || '').trim());
        const findIdx = (...names: string[]) => {
          for (const n of names) {
            const i = header.findIndex(h => h === n || h === `${n}*`);
            if (i >= 0) return i;
          }
          return -1;
        };
        const hasHeader = header.some(h => h.includes('카테고리') || h.includes('문제내용'));
        const idx = hasHeader ? {
          code: findIdx('문제코드'),
          cat: findIdx('카테고리'),
          grade: findIdx('등급'),
          diff: findIdx('난이도'),
          type: findIdx('유형'),
          content: findIdx('문제내용'),
          score: findIdx('배점'),
          tags: findIdx('태그'),
          fileUp: findIdx('파일업로드허용'),
          opt: [findIdx('보기1'), findIdx('보기2'), findIdx('보기3'), findIdx('보기4'), findIdx('보기5')],
          ans: findIdx('정답'),
          att: findIdx('첨부파일URL'),
        } : {
          // Legacy positional (no 문제코드 column)
          code: -1, cat: 0, grade: 1, diff: 2, type: 3, content: 4, score: 5,
          tags: 6, fileUp: 7, opt: [8, 9, 10, 11, 12], ans: 13, att: 14,
        };
        const getCell = (row: any[], i: number) => i >= 0 ? row[i] : undefined;

        const questions: ParsedQuestion[] = [];
        const errors: string[] = [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(c => !c)) continue; // skip empty rows
          // Skip guidance row (legacy templates that still have hint row)
          if (i === 1 && typeof row[0] === 'string' && row[0].includes('/')) continue;

          const rowNum = i + 1;
          const rawCode = String(getCell(row, idx.code) || '').trim();
          const rawCat = String(getCell(row, idx.cat) || '').trim();
          const rawGrade = String(getCell(row, idx.grade) || '').trim();
          const rawDiff = String(getCell(row, idx.diff) || '').trim();
          const rawType = String(getCell(row, idx.type) || '').trim();
          let content = String(getCell(row, idx.content) || '').trim();
          const maxScore = Number(getCell(row, idx.score)) || 10;
          const tagsStr = String(getCell(row, idx.tags) || '').trim();
          const fileUpload = String(getCell(row, idx.fileUp) || '').trim();
          const attachmentsStr = String(getCell(row, idx.att) || '').trim();
          const attachments: ParsedAttachment[] = attachmentsStr
            ? attachmentsStr.split(',').map(s => s.trim()).filter(Boolean).map(url => {
                let name = url;
                try {
                  const u = new URL(url);
                  name = decodeURIComponent(u.pathname.split('/').pop() || url);
                } catch {}
                return { name, url };
              })
            : [];

          if (!rawCat || !VALID_CATEGORIES.includes(rawCat)) {
            errors.push(`${rowNum}행: 카테고리가 올바르지 않습니다 (${rawCat})`);
            continue;
          }
          if (!content) {
            errors.push(`${rowNum}행: 문제 내용이 비어 있습니다`);
            continue;
          }

          const difficulty = DIFFICULTY_MAP[rawDiff];
          if (!difficulty) {
            errors.push(`${rowNum}행: 난이도가 올바르지 않습니다 (${rawDiff})`);
            continue;
          }

          const type = TYPE_MAP[rawType];
          if (!type) {
            errors.push(`${rowNum}행: 유형이 올바르지 않습니다 (${rawType})`);
            continue;
          }

          const grade = rawGrade ? (GRADE_MAP[rawGrade] || null) : null;
          if (rawGrade && !grade) {
            errors.push(`${rowNum}행: 등급이 올바르지 않습니다 (${rawGrade})`);
            continue;
          }

          let options: { id: string; text: string; is_correct: boolean }[] | null = null;
          let correct_answer: string | null = String(getCell(row, idx.ans) || '').trim() || null;

          if (type === 'multiple_choice') {
            const correctNum = correct_answer ? parseInt(correct_answer) : -1;
            const opts: { id: string; text: string; is_correct: boolean }[] = [];
            for (let j = 0; j < 5; j++) {
              const text = String(getCell(row, idx.opt[j]) || '').trim();
              if (text) opts.push({ id: crypto.randomUUID(), text, is_correct: (j + 1) === correctNum });
            }

            // Fallback: content에 A) B) C) D) 또는 A. B. C. D. 패턴이 있으면 추출
            if (opts.length < 2) {
              const abcdPattern = /^([A-Da-d])[).]\s*(.+)$/;
              const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
              const extracted: { label: string; text: string }[] = [];
              for (const line of lines) {
                const m = line.match(abcdPattern);
                if (m) extracted.push({ label: m[1].toUpperCase(), text: m[2].trim() });
              }
              if (extracted.length >= 2) {
                const correctLabel = correct_answer?.toUpperCase() || '';
                extracted.forEach(ex => {
                  opts.push({ id: crypto.randomUUID(), text: ex.text, is_correct: ex.label === correctLabel });
                });
                // content에서 보기 제거하여 문제 본문만 남김
                const cleanedLines = lines.filter(l => !abcdPattern.test(l));
                content = cleanedLines.join('\n').trim();
              }
            }

            if (opts.length < 2) {
              errors.push(`${rowNum}행: 객관식 문제는 보기가 최소 2개 필요합니다`);
              continue;
            }
            options = opts;
          }

          questions.push({
            code: rawCode || null,
            category: rawCat,
            grade,
            difficulty,
            type,
            content,
            max_score: maxScore,
            tags: tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [],
            allow_file_upload: fileUpload === 'O' || fileUpload === 'o',
            options,
            correct_answer,
            order_num: 1,
            attachments,
          });

        }

        if (errors.length > 0 && questions.length === 0) {
          reject(new Error(`모든 행에 오류가 있습니다:\n${errors.join('\n')}`));
          return;
        }

        if (errors.length > 0) {
          // Partial success — attach errors as a property
          const result = questions as any;
          result._warnings = errors;
        }

        resolve(questions);
      } catch (err: any) {
        reject(new Error(`파일 파싱 실패: ${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsArrayBuffer(file);
  });
}
