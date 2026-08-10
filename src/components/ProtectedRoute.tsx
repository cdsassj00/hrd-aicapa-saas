import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { FullscreenLoader } from '@/components/FullscreenLoader';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullscreenLoader message="권한 확인 중..." />;

  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  if (!allowedRoles.includes(role)) {
    const routes: Record<UserRole, string> = {
      applicant: '/applicant',
      examiner: '/examiner/monitor',
      admin: '/admin/exams',
      viewer: '/admin/certifications',
    };
    return <Navigate to={routes[role]} replace />;
  }

  return <>{children}</>;
}
