import type { ReactNode } from 'react';

/**
 * 관리 화면 공통 머리말 — 구역 이름 · 제목 · 설명 · 오른쪽 행동 버튼.
 * 모든 관리자 화면이 같은 위계(제목 크기·여백·구분선)를 쓰도록 한 곳에 둔다.
 */
export function PageHeader({ section, title, description, actions, children }: {
  section?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** 제목 아래 탭 등 */
  children?: ReactNode;
}) {
  return (
    <header className="border-b pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {section && <div className="text-[12px] font-medium text-muted-foreground">{section}</div>}
          <h1 className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}
