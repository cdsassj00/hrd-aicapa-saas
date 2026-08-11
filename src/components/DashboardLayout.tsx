import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { TopBar } from '@/components/TopBar';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullscreenLoader } from '@/components/FullscreenLoader';
import { LEGAL } from '@/lib/brand';

export function DashboardLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Feature 7: Hide sidebar and topbar during exam & waiting room
  const isInExam = location.pathname.startsWith('/applicant/exam/') || location.pathname.startsWith('/applicant/waiting-room/');

  if (loading) return <FullscreenLoader message="로딩 중..." />;

  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  if (isInExam) {
    return (
      <div className="min-h-screen flex flex-col w-full">
        <main className="flex-1 overflow-auto p-6 bg-secondary/30">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <div className="flex items-center h-10 px-4 border-b bg-muted/30">
            <SidebarTrigger className="h-7 w-7" />
          </div>
          <main className="flex-1 overflow-auto p-6 bg-secondary/30">
            <Outlet />
          </main>
          <footer className="py-2 px-6 text-center border-t bg-muted/20">
            <span className="text-[10px] text-muted-foreground">
              {LEGAL.privacyUrl && (
                <>
                  <a href={LEGAL.privacyUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">개인정보처리방침</a>
                  {' · '}
                </>
              )}
              {LEGAL.termsUrl && (
                <>
                  <a href={LEGAL.termsUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">이용약관</a>
                  {' · '}
                </>
              )}
              {LEGAL.operator && `${LEGAL.operator} · `}© {new Date().getFullYear()}
            </span>
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}
