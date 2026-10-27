// 문항 실습 데이터(픽스처) — 샌드박스 문항용.
//
// 수행형 문항 상당수는 "파일이 주어집니다"를 전제한다. 그 파일이 없으면 문항을
// 풀 수가 없다. 샌드박스 문항은 Storage 를 거치지 않고 샌드박스 안에서 바로
// 생성한다. 이유 세 가지.
//   · 운영 손이 안 간다 — 업로드 단계가 없다.
//   · 2MB 짜리 로그 파일을 레포에 넣지 않는다.
//   · 시드를 바꾸면 회차마다 다른 데이터가 나온다 — 문제 유출 방어선이 된다.
//     (기본은 문항 코드로 고정한다. 같은 회차 안에서는 모두 같은 데이터를 받아야
//      공정하고, 채점 기준도 데이터에 묶여 있다.)
//
// 심어 둔 결함(중복·결측·형식 오류·분석 오류)은 채점 기준이므로 생성 스크립트
// 안에만 있고 응시자에게는 설명되지 않는다. 응시자는 파일을 보고 직접 찾아야 한다.

import { WORK_DIR, type ExamSandbox } from "./sandbox.ts";

/**
 * 생성 스크립트를 가져오는 포트.
 *
 * 스크립트를 함수 번들에 굽지 않고 DB(agent_scripts)에서 읽는다. 이유 둘.
 *   · 픽스처를 고칠 때 함수를 다시 배포하지 않아도 된다.
 *   · 14KB 짜리 파이썬을 번들에 넣으면 배포 페이로드가 그만큼 커진다.
 */
export type ScriptLoader = (name: string) => Promise<string | null>;

/** 픽스처가 있는 문항 코드. 없는 문항은 빈 작업 폴더로 시작한다 */
export const FIXTURE_CODES = ["CAPA-01", "CAPC-01", "CAPC-02", "CAPD-02", "CAPE-02"] as const;

export function hasFixture(code: string | null | undefined): boolean {
  return !!code && (FIXTURE_CODES as readonly string[]).includes(code);
}


/**
 * 샌드박스 작업 폴더에 문항 픽스처를 만든다.
 *
 * 생성 스크립트는 작업 폴더 밖(/tmp)에 두고 지운다 — 응시자가 생성기를 읽으면
 * 심어 둔 결함 위치가 그대로 보이고, 그건 채점 기준을 넘겨주는 것이다.
 */
export async function writeFixtures(
  sandbox: ExamSandbox,
  code: string,
  loadScript: ScriptLoader,
  seed?: number,
): Promise<{ ok: boolean; log: string }> {
  if (!hasFixture(code)) return { ok: true, log: "픽스처 없음" };

  const script = await loadScript("fixtures.py");
  if (!script) return { ok: false, log: "생성 스크립트(fixtures.py)를 찾지 못했습니다" };

  // 문항 코드를 시드로 쓴다. 같은 회차의 모든 응시자가 같은 데이터를 받아야
  // 공정하고, 채점 기준도 이 데이터에 묶여 있다.
  const s = seed ?? Array.from(code).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7);

  // 생성기는 WORK_DIR 밖에 둔다. resolveWorkPath 를 쓰지 않는 유일한 자리이며,
  // 경로는 응시자 입력이 아니라 상수다.
  await sandbox.runCommand(
    `mkdir -p /tmp/gen && cat > /tmp/gen/fixtures.py <<'HRD_FIXTURE_EOF'\n${script}\nHRD_FIXTURE_EOF`,
  );
  const r = await sandbox.runCommand(
    `python3 /tmp/gen/fixtures.py ${code} ${s} ${WORK_DIR} && rm -rf /tmp/gen`,
  );
  return {
    ok: r.exitCode === 0,
    log: [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 2000),
  };
}
