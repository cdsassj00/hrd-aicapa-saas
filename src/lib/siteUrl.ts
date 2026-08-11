/**
 * 초대 링크·메일 본문에 들어갈 이 서비스의 공개 주소.
 *
 * 원본 코드는 `import.meta.env.PROD ? 'https://aicapa.kr' : origin` 이었습니다.
 * 그 값은 원본(NIA 납품 시스템)의 운영 도메인이라, 이 제품을 배포하면
 * 초대받은 사람이 **다른 서비스로** 이동합니다. 하드코딩을 제거합니다.
 *
 * 우선순위:
 *   1. `VITE_SITE_URL` — 커스텀 도메인이 정해지면 빌드 변수로 주입
 *   2. `window.location.origin` — 미설정 시 지금 접속한 주소. 항상 자기 자신을
 *      가리키므로 잘못된 곳으로 보낼 위험이 없습니다.
 */
export function siteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return window.location.origin.replace(/\/+$/, '');
}

/** `siteUrl()` 뒤에 경로를 붙입니다. `path` 는 `/` 로 시작해야 합니다. */
export function siteLink(path: string): string {
  return `${siteUrl()}${path}`;
}
