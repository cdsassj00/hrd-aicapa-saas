import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullscreenLoader } from '@/components/FullscreenLoader';

/** 플랫폼 운영자(is_platform_admin) 전용 가드.
 *  플랫폼 운영자는 특정 조직 멤버가 아닐 수 있으므로 needsOnboarding 검사를 타지 않는다. */
export function PlatformRoute({ children }: { children: React.ReactNode }) {
  const { user, isPlatformAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullscreenLoader message="권한 확인 중..." />;
  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
