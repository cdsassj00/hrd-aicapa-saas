import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, Moon, Shield, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useTheme } from '@/hooks/useTheme';

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
    <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-foreground" />
        <h1 className="text-[15px] font-bold tracking-tight">{settings.title}</h1>
      </div>
      <div className="flex items-center gap-4">
        {orgs.length > 1 && (
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted-foreground">조직:</span>
            <Select value={activeOrgId ?? undefined} onValueChange={handleOrgChange}>
              <SelectTrigger className="h-8 w-[180px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {orgs.map(o => (
                  <SelectItem key={o.orgId} value={o.orgId}>{o.orgName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="h-4 w-px bg-border" />
        <span className="text-[12px] text-muted-foreground">
          {user?.name || '사용자'}
          {activeOrg ? ` · ${activeOrg.orgName}` : ''}
          {role ? ` · ${roleLabels[role]}` : ''}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggle}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSignOut} aria-label="로그아웃">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
