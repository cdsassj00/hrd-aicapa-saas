import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SUPER_ADMIN_ID } from '@/lib/constants';
import { useNavigate } from 'react-router-dom';
import { useSiteSettings } from '@/hooks/useSiteSettings';

const roleLabels: Record<UserRole, string> = {
  applicant: '응시자',
  examiner: '감독관',
  admin: '관리자',
  viewer: '조회자',
};

export function TopBar() {
  const { user, role, setRole, signOut } = useAuth();
  const navigate = useNavigate();
  const { settings } = useSiteSettings();
  const isSuperAdmin = user?.id === SUPER_ADMIN_ID;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    const routes: Record<UserRole, string> = {
      applicant: '/applicant',
      examiner: '/examiner/monitor',
      admin: '/admin/exams',
      viewer: '/admin/certifications',
    };
    navigate(routes[newRole]);
  };

  return (
    <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-foreground" />
        <h1 className="text-[15px] font-bold tracking-tight">{settings.title}</h1>
      </div>
      <div className="flex items-center gap-4">
        {isSuperAdmin && (
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted-foreground">역할 전환:</span>
            <Select value={role} onValueChange={v => handleRoleChange(v as UserRole)}>
              <SelectTrigger className="h-8 w-[120px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">관리자</SelectItem>
                <SelectItem value="examiner">감독관</SelectItem>
                <SelectItem value="applicant">응시자</SelectItem>
                <SelectItem value="viewer">조회자</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="h-4 w-px bg-border" />
        <span className="text-[12px] text-muted-foreground">
          {user?.name || '사용자'} {user?.organization ? `(${user.organization})` : ''}
        </span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
