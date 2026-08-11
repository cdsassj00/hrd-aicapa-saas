import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AsciiMorphBackground } from '@/components/AsciiMorphBackground';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield } from 'lucide-react';
import { UserRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { FullscreenLoader } from '@/components/FullscreenLoader';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { trackAction } from '@/lib/userActions';
import { LEGAL } from '@/lib/brand';

export default function LoginPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const inviteParam = searchParams.get('invite');
  const redirectParam = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [phone, setPhone] = useState('');
  const selectedRole: UserRole = 'applicant';
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [signupError, setSignupError] = useState('');
  const [guestInvite, setGuestInvite] = useState<{ code: string; name: string; email: string; examTitle: string } | null>(null);
  const [guestLoading, setGuestLoading] = useState(false);
  const [inviteResolving, setInviteResolving] = useState(Boolean(inviteParam));
  const [otpStep, setOtpStep] = useState<'info' | 'verify'>('info');
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const { signIn, signUp, user, role, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { settings } = useSiteSettings();

  const routes: Record<UserRole, string> = {
    applicant: '/applicant',
    examiner: '/examiner/monitor',
    org_owner: '/admin/exams',
    org_admin: '/admin/exams',
    viewer: '/admin/certifications',
  };

  const getSafeRedirect = () => {
    if (!redirectParam) return '';
    try {
      const decoded = decodeURIComponent(redirectParam);
      if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
    } catch {
      // Ignore malformed redirect values and fall back to role landing page.
    }
    return '';
  };

  /** 소셜 로그인 공통 진입점.
   *  Google 이든 카카오든 인증 후 Supabase 의 콜백으로 갔다가 우리 앱으로
   *  돌아온다. 그래서 프로바이더별로 다른 건 이름 하나뿐이다. */
  const handleOAuth = async (provider: 'google' | 'kakao', label: string) => {
    const redirect = getSafeRedirect();
    if (redirect) sessionStorage.setItem('post_login_redirect', redirect);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      toast({ title: `${label} 로그인 실패`, description: error.message, variant: 'destructive' });
    }
  };

  // Auto-redirect if already logged in (handles OAuth callback)
  useEffect(() => {
    if (!loading && user) {
      const params = new URLSearchParams(window.location.search);
      const invite = params.get('invite');
      const target = getSafeRedirect() || routes[role] || '/applicant';
      navigate(invite ? `${target}?invite=${invite}` : target, { replace: true });
    }
  }, [loading, user, role, navigate, redirectParam]);

  useEffect(() => {
    if (user || loading) return;
    if (!inviteParam) {
      setInviteResolving(false);
      return;
    }
    (async () => {
      setGuestLoading(true);
      // anon RLS 차단 우회: SECURITY DEFINER 함수로 단건 조회
      const { data: rows } = await supabase
        .rpc('get_invitation_by_code', { p_code: inviteParam.toUpperCase() });
      const inv = Array.isArray(rows) ? rows[0] : null;
      if (inv) {
        const examTitle = inv.exam_title || '시험';
        const isTestMode = inv.is_test_mode === true;
        const hasActiveSession = (inv as any).has_active_session === true;
        // 테스트 모드 OR 본인 active session 있으면 is_used 무시 (재접속 허용)
        if (inv.is_used && !isTestMode && !hasActiveSession) {
          setEmail(inv.email);
          setName(inv.name || '');
          setLoginError('이미 사용된 응시코드입니다. 코드가 이미 사용된 경우 새 초대코드를 받아 다시 접속해주세요.');
        } else {
          setGuestInvite({ code: inv.invite_code, name: inv.name || '', email: inv.email, examTitle });
          setEmail(inv.email);
          setName(inv.name || '');
        }
      }
      setGuestLoading(false);
      setInviteResolving(false);
    })();
  }, [user, loading, inviteParam]);

  // Show loading spinner while auth is restoring session
  if (loading || inviteResolving) return <FullscreenLoader message="세션 확인 중..." />;
  if (user) return <FullscreenLoader message="리다이렉트 중..." />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoading(true);
    try {
      const { error } = await signIn(email.trim(), password);
      if (error) {
        if (error.message?.includes('Invalid login credentials')) {
          setLoginError('이메일 또는 비밀번호가 올바르지 않습니다.');
        } else if (error.message?.includes('Email not confirmed')) {
          setLoginError('이메일 인증이 완료되지 않았습니다. 메일함을 확인해주세요.');
        } else {
          setLoginError(error.message || '로그인에 실패했습니다.');
        }
        setIsLoading(false);
        return;
      }
      // [7] Track login action
      trackAction('login', { method: 'password' });
      // Auth succeeded — useEffect will handle navigation once user/role are set
      setIsLoading(false);
    } catch {
      setLoginError('로그인 중 오류가 발생했습니다.');
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError('');
    if (!name || !email || !password) {
      setSignupError('이름, 이메일, 비밀번호는 필수입니다.');
      return;
    }
    setIsLoading(true);
    // 역할은 조직 멤버십으로 정해진다 — 가입 시점에는 고르지 않는다.
    // 부서·직급도 조직별 정보라 org_members 로 옮겼다(0004).
    const { error } = await signUp(email, password, { name, phone });
    setIsLoading(false);
    if (error) {
      setSignupError(error.message || '회원가입에 실패했습니다.');
    } else {
      toast({ title: '회원가입 완료', description: '로그인되었습니다.' });
      setTimeout(() => navigate(routes[selectedRole]), 500);
    }
  };

  const handleSendGuestOtp = async () => {
    if (!guestInvite) return;
    setOtpSending(true);
    setSignupError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-guest-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ email: guestInvite.email, invite_code: guestInvite.code }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSignupError(data.error || '인증코드 발송 실패');
      } else {
        setOtpStep('verify');
        toast({ title: '인증코드가 이메일로 발송되었습니다', description: '5분 이내에 입력해 주세요.' });
      }
    } catch {
      setSignupError('인증코드 발송 중 오류가 발생했습니다.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyGuestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestInvite || !otpCode) return;
    setIsLoading(true);
    setSignupError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-guest-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ email: guestInvite.email, code: otpCode, invite_code: guestInvite.code, name: name || guestInvite.name }),
      });
      const data = await res.json();
      if (!data.success) {
        setSignupError(data.error || '인증 실패');
        setIsLoading(false);
        return;
      }
      // Set session with returned tokens
      await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      toast({ title: '인증 완료! 시험으로 이동합니다.' });
      navigate(`/applicant/waiting-room/${data.exam_session_id}`);
    } catch {
      setSignupError('인증 처리 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <AsciiMorphBackground />
      <Card className="w-full max-w-[420px] shadow-2xl relative z-10 bg-card/90 backdrop-blur-md border-border/50">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-[18px]">{settings.title}</CardTitle>
          <p className="text-[12px] text-muted-foreground mt-1">{settings.subtitle}</p>
        </CardHeader>
        <CardContent>
          {/* Guest invite flow */}
          {guestInvite && !guestLoading ? (
            <div className="space-y-4">
              <div className="text-center space-y-1 pb-2 border-b">
                <Badge className="text-[11px]">{guestInvite.examTitle}</Badge>
                <p className="text-[13px] text-muted-foreground">초대 링크를 통해 접속하셨습니다</p>
                <p className="text-[12px] text-muted-foreground">
                  {otpStep === 'info' ? '이메일 인증 후 바로 시험에 참여할 수 있습니다' : '이메일로 전송된 6자리 인증코드를 입력하세요'}
                </p>
              </div>

              {otpStep === 'info' ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-[12px]">이메일</Label>
                    <Input value={guestInvite.email} disabled className="h-8 text-[12px] bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[12px]">이름</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="이름을 입력하세요" className="h-8 text-[12px]" />
                  </div>
                  {signupError && <p className="text-[13px] text-destructive font-medium">{signupError}</p>}
                  <Button type="button" className="w-full" disabled={otpSending} onClick={handleSendGuestOtp}>
                    {otpSending ? '발송 중...' : '📧 인증코드 발송'}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleVerifyGuestOtp} className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-[12px]">이메일</Label>
                    <Input value={guestInvite.email} disabled className="h-8 text-[12px] bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[12px]">인증코드 (6자리)</Label>
                    <Input
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="h-10 text-center text-lg font-mono tracking-widest"
                      maxLength={6}
                      autoFocus
                    />
                  </div>
                  {signupError && <p className="text-[13px] text-destructive font-medium">{signupError}</p>}
                  <Button type="submit" className="w-full" disabled={isLoading || otpCode.length !== 6}>
                    {isLoading ? '인증 중...' : '✅ 인증 완료 & 시험 입장'}
                  </Button>
                  <button type="button" className="w-full text-[11px] text-muted-foreground hover:text-primary" onClick={() => { setOtpStep('info'); setOtpCode(''); setSignupError(''); }}>
                    인증코드 다시 받기
                  </button>
                </form>
              )}

              <p className="text-center text-[11px] text-muted-foreground">
                이미 계정이 있나요?{' '}
                <button type="button" className="text-primary underline" onClick={() => setGuestInvite(null)}>로그인</button>
              </p>
            </div>
          ) : (
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="login">로그인</TabsTrigger>
              <TabsTrigger value="signup">회원가입</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[12px]">이메일</Label>
                  <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일을 입력하세요" type="email" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[12px]">비밀번호</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호를 입력하세요" />
                </div>
                {loginError && (
                  <p className="text-[13px] text-destructive font-medium">{loginError}</p>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? '로그인 중...' : '로그인'}
                </Button>
                <button
                  type="button"
                  className="w-full text-[12px] text-muted-foreground hover:text-primary transition-colors"
                  onClick={async () => {
                    if (!email.trim()) {
                      setLoginError('비밀번호를 재설정할 이메일을 먼저 입력해주세요.');
                      return;
                    }
                    setIsLoading(true);
                    setLoginError('');
                    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                      redirectTo: `${window.location.origin}/reset-password`,
                    });
                    setIsLoading(false);
                    if (error) {
                      setLoginError(error.message || '비밀번호 재설정 이메일 발송에 실패했습니다.');
                    } else {
                      toast({ title: '비밀번호 재설정 이메일 발송 완료', description: '이메일을 확인해주세요.' });
                    }
                  }}
                >
                  비밀번호를 잊으셨나요?
                </button>
                <div className="relative my-2">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-[11px] text-muted-foreground">또는</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={isLoading}
                  onClick={() => handleOAuth('google', 'Google')}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Google로 로그인
                </Button>
                {/* 카카오 브랜드 가이드: 배경 #FEE500, 심볼·텍스트는 85% 불투명 검정 */}
                <Button
                  type="button"
                  className="w-full gap-2 bg-[#FEE500] text-[rgba(0,0,0,0.85)] hover:bg-[#FADA0A]"
                  disabled={isLoading}
                  onClick={() => handleOAuth('kakao', '카카오')}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 3C6.99 3 3 6.2 3 10.14c0 2.52 1.68 4.73 4.2 6L6.3 19.5c-.09.33.27.59.55.4l3.98-2.63c.38.04.77.06 1.17.06 5.01 0 9-3.2 9-7.19S17.01 3 12 3z"
                    />
                  </svg>
                  카카오로 로그인
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-[12px]">이메일 *</Label>
                  <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일" type="email" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[12px]">비밀번호 *</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="6자 이상" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[12px]">이름 *</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="이름" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[12px]">소속기관</Label>
                    <Input value={organization} onChange={e => setOrganization(e.target.value)} placeholder="기관명" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[12px]">부서</Label>
                    <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="부서명" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[12px]">직위</Label>
                    <Input value={position} onChange={e => setPosition(e.target.value)} placeholder="직위" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[12px]">연락처</Label>
                    <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-0000-0000" />
                  </div>
                </div>
                {signupError && (
                  <p className="text-[13px] text-destructive font-medium">{signupError}</p>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? '가입 중...' : '회원가입'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          )}
        </CardContent>
      </Card>
      <footer className="fixed bottom-0 left-0 right-0 py-5 pb-6 text-center z-10">
        <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground/70">
          {LEGAL.privacyUrl && (
            <>
              <a href={LEGAL.privacyUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">개인정보처리방침</a>
              <span>·</span>
            </>
          )}
          {LEGAL.termsUrl && (
            <>
              <a href={LEGAL.termsUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">이용약관</a>
              <span>·</span>
            </>
          )}
          {LEGAL.operator && (
            <>
              <span>{LEGAL.operator}</span>
              <span>·</span>
            </>
          )}
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
