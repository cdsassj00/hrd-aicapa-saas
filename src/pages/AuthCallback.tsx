import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { UserRole } from '@/types';

const routes: Record<UserRole, string> = {
  applicant: '/applicant',
  examiner: '/examiner/monitor',
  org_owner: '/admin/exams',
  org_admin: '/admin/exams',
  viewer: '/admin/certifications',
};

export default function AuthCallback() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const processed = useRef(false);

  // Process OAuth callback tokens from URL
  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const handleOAuthCallback = async () => {
      // Check for code in query params (PKCE flow)
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
        } catch (e) {
          console.error('exchangeCodeForSession error:', e);
        }
        return; // onAuthStateChange in AuthContext will handle the rest
      }

      // Check for tokens in hash fragment (implicit flow)
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        // Supabase auto-detects hash tokens via onAuthStateChange
        return;
      }
    };

    handleOAuthCallback();
  }, []);

  useEffect(() => {
    if (!loading && user) {
      const redirect = sessionStorage.getItem('post_login_redirect');
      if (redirect) sessionStorage.removeItem('post_login_redirect');
      navigate(redirect || routes[role] || '/applicant', { replace: true });
    } else if (!loading && !user) {
      // Wait a bit longer for OAuth processing before giving up
      const timeout = setTimeout(() => {
        navigate('/login', { replace: true });
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [loading, user, role, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">로그인 처리 중...</p>
      </div>
    </div>
  );
}
