import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useTheme } from '@/hooks/useTheme';
import { BrandMark } from '@/components/BrandMark';
import { SidebarTrigger } from '@/components/ui/sidebar';

const roleLabels: Record<UserRole, string> = {
  org_owner: '소유자',
  org_admin: '관리자',
  examiner: '감독관',
  applicant: '응시자',
  viewer: '조회자',
};

export function TopBar() {
  const { user, role, activeOrg, activeOrgId, memberships, switchOrg, signOut } = useAuth();
  const navigate = useNavigate();
  const { settings } = useSiteSettings();
  const { theme, toggle } = useTheme();

  // 조직 목록은 중복 제거 — 한 조직에서 복수 역할을 가지면 행이 여러 개다
  const orgs = Array.from(
    new Map(memberships.map(m => [m.orgId, m])).values()
  );

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  /** 조직 전환은 UI 필터일 뿐 권한 경계가 아니다 —
   *  실제 접근 판정은 매 쿼리마다 DB 의 RLS 가 한다. */
  const handleOrgChange = (orgId: string) => {
    switchOrg(orgId);
    navigate('/');
  };

  return (
    <header className="h-16 border-b border-border/60 bg-background/80 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-2.5">
        <SidebarTrigger className="h-9 w-9 rounded-full -ml-1" />
        <BrandMark size={26} />
        <h1 className="text-[15px] font-semibold tracking-[-0.02em]">{settings.title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {orgs.length > 1 && (
          <Select value={activeOrgId ?? undefined} onValueChange={handleOrgChange}>
            <SelectTrigger className="h-9 w-[184px] text-[12.5px] rounded-full border-border/70">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {orgs.map(o => (
                <SelectItem key={o.orgId} value={o.orgId}>{o.orgName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="hidden sm:flex flex-col items-end leading-tight mr-1">
          <span className="text-[12.5px] font-medium tracking-[-0.01em]">{user?.name || '사용자'}</span>
          <span className="text-[11px] text-muted-foreground">
            {activeOrg ? activeOrg.orgName : ''}
            {activeOrg && role ? ' · ' : ''}
            {role ? roleLabels[role] : ''}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={toggle}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={handleSignOut} aria-label="로그아웃">
          <LogOut className="h-[18px] w-[18px]" />
        </Button>
      </div>
    </header>
  );
}
