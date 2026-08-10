import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AsciiMorphBackground } from '@/components/AsciiMorphBackground';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRecovery, setIsRecovery] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY event from the auth state change
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });

    // Also check hash for type=recovery (Supabase redirects with hash fragment)
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setIsLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (updateError) {
      setError(updateError.message || '비밀번호 변경에 실패했습니다.');
      return;
    }

    toast({ title: '비밀번호가 변경되었습니다', description: '새 비밀번호로 로그인됩니다.' });
    navigate('/login', { replace: true });
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
        <AsciiMorphBackground />
        <Card className="w-full max-w-[420px] shadow-2xl relative z-10 bg-card/90 backdrop-blur-md border-border/50">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground text-sm">비밀번호 재설정 링크를 확인하는 중...</p>
            <Button variant="outline" onClick={() => navigate('/login')}>로그인으로 돌아가기</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <AsciiMorphBackground />
      <Card className="w-full max-w-[420px] shadow-2xl relative z-10 bg-card/90 backdrop-blur-md border-border/50">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
              <KeyRound className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-[18px]">새 비밀번호 설정</CardTitle>
          <p className="text-[12px] text-muted-foreground mt-1">새로운 비밀번호를 입력해주세요</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[12px]">새 비밀번호</Label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="6자 이상 입력"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px]">비밀번호 확인</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="비밀번호를 다시 입력"
              />
            </div>
            {error && <p className="text-[13px] text-destructive font-medium">{error}</p>}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
