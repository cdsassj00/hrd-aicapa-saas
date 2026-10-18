#!/usr/bin/env node
/**
 * supabase/fixtures/fixtures.py 를 엣지 함수가 쓸 TS 상수로 감싼다.
 *
 * 왜 생성 단계를 두는가: 파이썬 원본에는 마크다운 인라인 코드의 백틱과 따옴표가
 * 섞여 있어 TS 템플릿 리터럴에 그대로 넣을 수 없다. JSON.stringify 로 감싸면
 * 어떤 문자가 들어와도 깨지지 않고, 원본은 python3 으로 바로 돌려 검증할 수 있다.
 *
 *   node scripts/gen-fixture-module.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'supabase/fixtures/fixtures.py';
const OUT = 'supabase/functions/_shared/fixtureScript.ts';

const py = readFileSync(SRC, 'utf8');

// 셸 heredoc 구분자와 충돌하면 샌드박스 전송이 깨진다. 생성 단계에서 막는다.
if (py.includes('HRD_FIXTURE_EOF')) {
  throw new Error(`${SRC}: heredoc 구분자(HRD_FIXTURE_EOF)가 본문에 있습니다`);
}

writeFileSync(
  OUT,
  `// 생성 파일 — 직접 고치지 마십시오.\n` +
    `// 원본: ${SRC}\n` +
    `// 다시 만들기: node scripts/gen-fixture-module.mjs\n` +
    `export const FIXTURE_SCRIPT = ${JSON.stringify(py)};\n`,
);
console.log(`${OUT} (${py.length} bytes of python)`);
