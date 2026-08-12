/**
 * 제품 브랜드 마크 — 파비콘(public/favicon.svg)과 같은 글리프.
 * 오름차순 바 3개 = 역량 등급 계단. 인라인 SVG 라 자산 로드가 없다.
 * currentColor 를 타지 않고 고정색을 쓴다(랜딩과 동일한 블루 액센트).
 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="AI 역량평가"
    >
      <rect width="64" height="64" rx="14" className="fill-foreground" />
      <rect x="14" y="34" width="9" height="16" rx="2.5" className="fill-background/40" />
      <rect x="27.5" y="26" width="9" height="24" rx="2.5" fill="#0a84ff" />
      <rect x="41" y="16" width="9" height="34" rx="2.5" className="fill-background" />
    </svg>
  );
}
