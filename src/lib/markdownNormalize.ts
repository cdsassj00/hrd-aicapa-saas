/**
 * 입력자가 누구든(기관별 작성 스타일 차이) 응시화면에서 일관된 마크다운으로 보이도록
 * 안전 범위의 정규화만 수행한다. 의미/표현을 바꾸는 변환은 하지 않는다.
 */
export function normalizeMarkdown(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);

  // 1) BOM & 줄바꿈 통일
  s = s.replace(/^\uFEFF/, '');
  s = s.replace(/\r\n?/g, '\n');

  // 2) 행끝 공백 제거
  s = s.split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n');

  // 3) 시스템이 별도 영역에 표시하는 메타블록 줄 제거
  //    예) "> 시험종류: 실전 | 등급: 그린 | 제한시간: 40분 | 사용 도구: ..."
  s = s
    .split('\n')
    .filter(line => !/^\s*>\s*(시험종류|등급|제한시간|사용\s*도구|소요시간|배점)\s*[:：]/.test(line))
    .join('\n');

  // 4) 헤딩 앞뒤 빈 줄 보장 ( ## / ### / # )
  s = s.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');
  s = s.replace(/(^|\n)(#{1,6}[^\n]*)\n(?!\n)/g, '$1$2\n\n');

  // 5) 기관별 JSON에서 표 행이 한 줄로 붙어 들어오는 경우를 GFM 표로 복구
  s = normalizeInlineTables(s);

  // 6) 표 앞뒤 빈 줄 보장 (연속된 표 블록은 유지)
  s = ensureTableBlockSpacing(s);


  // 7) 리스트 앞 빈 줄 보장
  s = s.replace(/([^\n])\n(\s*(?:[-*+]\s|\d+\.\s))/g, '$1\n\n$2');

  // 8) 빈 줄 3개 이상 → 2개
  s = s.replace(/\n{3,}/g, '\n\n');

  // 9) 전체 trim
  s = s.replace(/^\n+/, '').replace(/\n+$/, '');

  return s;
}

function normalizeInlineTables(source: string): string {
  // 예: |---|---| | data | ... 처럼 구분선과 첫 행이 붙은 경우 분리
  const separated = source.replace(
    /(\|[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|)[ \t]+(?=\|)/g,
    '$1\n'
  );

  const lines = separated.split('\n');
  const out: string[] = [];
  let activeColumnCount: number | null = null;

  for (const line of lines) {
    const columnCount = getSeparatorColumnCount(line);
    if (columnCount) {
      out.push(line);
      activeColumnCount = columnCount;
      continue;
    }

    if (!line.trim() || /^\s*#{1,6}\s/.test(line)) {
      activeColumnCount = null;
      out.push(line);
      continue;
    }

    if (activeColumnCount && line.includes('|')) {
      out.push(...splitInlineTableRows(line, activeColumnCount));
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function getSeparatorColumnCount(line: string): number | null {
  const trimmed = line.trim();
  if (!/^\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?$/.test(trimmed)) {
    return null;
  }

  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());

  return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell)) ? cells.length : null;
}

function ensureTableBlockSpacing(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];

  lines.forEach((line, index) => {
    const isTable = isTableLine(line);
    const previous = out[out.length - 1];
    const next = lines[index + 1];

    if (isTable && previous?.trim() && !isTableLine(previous)) {
      out.push('');
    }

    out.push(line);

    if (isTable && next !== undefined && next.trim() && !isTableLine(next)) {
      out.push('');
    }
  });

  return out.join('\n');
}

function isTableLine(line: string | undefined): boolean {
  return !!line && /^\s*\|.*\|\s*$/.test(line);
}

function splitInlineTableRows(line: string, columnCount: number): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [line];

  const rawCells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());

  const rows: string[][] = [];
  let current: string[] = [];

  for (const cell of rawCells) {
    // 한 줄에 여러 행이 붙으면 행 경계가 빈 셀처럼 들어온다: "... | | 다음행 ..."
    if (cell === '' && current.length === columnCount) {
      rows.push(current);
      current = [];
      continue;
    }

    current.push(cell);
    if (current.length > columnCount) return [line];
  }

  if (current.length === columnCount) {
    rows.push(current);
  }

  if (rows.length <= 1) return [line];
  return rows.map(row => `| ${row.join(' | ')} |`);
}
