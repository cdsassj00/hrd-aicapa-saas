import { Link } from 'react-router-dom';
import { Eye, LayoutDashboard } from 'lucide-react';

/** 응시자 / 관리자 미리보기 사이를 오가는 세그먼트 스위치. */
export function DemoSwitch({ current }: { current: 'applicant' | 'admin' }) {
  const base = 'flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition';
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-background p-1">
      <Link
        to="/demo"
        className={`${base} ${current === 'applicant' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <Eye className="h-4 w-4" /> 응시자 화면
      </Link>
      <Link
        to="/demo/admin"
        className={`${base} ${current === 'admin' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <LayoutDashboard className="h-4 w-4" /> 관리자 화면
      </Link>
    </div>
  );
}
