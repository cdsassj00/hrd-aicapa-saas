/**
 * 이 제품의 정체성. 원본(champion-monito / aicapa.kr)에서 딸려온 브랜딩을
 * 전부 걷어내고 여기 한 곳으로 모았습니다.
 *
 * 제품명·도메인이 확정되면 **이 파일만** 고치면 됩니다.
 * 단, 아래 두 곳은 TS 모듈을 못 읽으므로 같이 고쳐야 합니다:
 *   - `index.html`        (title / meta / 테마 FOUC 스크립트의 STORAGE_PREFIX)
 *   - `public/landing.html` (랜딩 페이지는 정적 HTML)
 */

/** 제품명. 아직 미확정이라 브랜드가 아닌 서술어를 씁니다. */
export const PRODUCT_NAME = 'AI 역량평가';

/** 한 줄 설명. 채용 전형과 재직자 진단 양쪽에 쓰입니다. */
export const PRODUCT_TAGLINE = '기업 채용·재직자 진단을 위한 AI 활용 역량평가';

/**
 * localStorage 키 접두어. 원본은 `aicapa.` 였습니다.
 * `index.html` 의 인라인 테마 스크립트와 반드시 같은 값이어야 합니다.
 */
export const STORAGE_PREFIX = 'aiassess';

export const storageKey = (name: string) => `${STORAGE_PREFIX}.${name}`;

/**
 * 조직 서브도메인 뒤에 붙는 도메인. 예: `acme` + `.example.com`
 * 도메인 미확정 상태에서는 빈 문자열이고, UI 는 접미어를 숨깁니다.
 * 원본 도메인을 임시로라도 넣으면 안 됩니다 — 잘못된 주소를 안내하게 됩니다.
 */
export const ORG_DOMAIN_SUFFIX = import.meta.env.VITE_ORG_DOMAIN_SUFFIX?.trim() ?? '';

/**
 * 법적 고지. 운영 주체는 원본과 같은 **한국데이터사이언티스트협회(CDSA)** 입니다.
 * 제품이 둘로 갈린 것이지 사업자가 갈린 것이 아니므로 표기를 유지합니다.
 *
 * 다만 개인정보처리방침 본문은 확인이 필요합니다. 이 서비스는 원본과 달리
 * 고객사 지원자·재직자의 데이터를 처리하고, 원격 감독 녹화까지 수집합니다.
 * 방침에 그 처리 목적·보관 기간·수탁자(R2·Daily·Rekognition 등)가 들어가
 * 있지 않으면 링크만으로는 고지 의무가 충족되지 않습니다.
 *
 * 빈 문자열이면 해당 항목은 렌더링하지 않습니다.
 */
export const LEGAL = {
  privacyUrl: 'https://cdsa.kr/privacy',
  termsUrl: 'https://cdsa.kr/terms',
  operator: '한국데이터사이언티스트협회(CDSA)',
  operatorUrl: 'https://cdsa.kr',
} as const;
