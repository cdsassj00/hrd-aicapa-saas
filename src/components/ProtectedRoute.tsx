import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { FullscreenLoader } from '@/components/FullscreenLoader';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, role, loading, needsOnboarding } = useAuth();
  const location = useLocation();

  if (loading) return <FullscreenLoader message="권한 확인 중..." />;

  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  // 소속 조직이 없으면 어떤 화면도 데이터를 못 읽는다(RLS 가 전부 막는다).
  // 권한 부족으로 튕기기 전에 온보딩으로 보낸다.
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;

  if (!allowedRoles.includes(role)) {
    const routes: Record<UserRole, string> = {
      applicant: '/applicant',
      examiner: '/examiner/monitor',
      org_owner: '/admin/exams',
      org_admin: '/admin/exams',
      viewer: '/admin/certifications',
    };
    return <Navigate to={routes[role]} replace />;
  }

  return <>{children}</>;
}
