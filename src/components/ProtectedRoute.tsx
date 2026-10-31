import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { FullscreenLoader } from '@/components/FullscreenLoader';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, role, loading, needsOnboarding, isPlatformAdmin } = useAuth();
  const location = useLocation();

  if (loading) return <FullscreenLoader message="권한 확인 중..." />;

  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  // 소속 조직이 없으면 어떤 화면도 데이터를 못 읽는다(RLS 가 전부 막는다).
  // 권한 부족으로 튕기기 전에 온보딩으로 보낸다.
  // 단, 초대 링크(/applicant?invite=코드)로 온 사람은 통과시킨다. 그 코드가 곧
  // 조직 합류 수단이다 — 응시 신청(redeem_exam_invitation)이 조직 멤버십을 만든다.
  // 여기서 온보딩으로 보내면 코드가 사라지고, 초대받은 수강생이 "조직 없음 →
  // 승인 요청" 화면(관리자 후보용)에 갇힌다(E2E 로 확인).
  const hasInvite = location.pathname === '/applicant' && new URLSearchParams(location.search).has('invite');
  if (needsOnboarding && !hasInvite) return <Navigate to={isPlatformAdmin ? '/platform' : '/onboarding'} replace />;

  if (!allowedRoles.includes(role)) {
    const routes: Record<UserRole, string> = {
      applicant: '/applicant',
      examiner: '/examiner/monitor',
      org_owner: '/admin',
      org_admin: '/admin',
      viewer: '/admin/certifications',
    };
    return <Navigate to={routes[role]} replace />;
  }

  return <>{children}</>;
}
