import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FullscreenLoader } from '@/components/FullscreenLoader';

type State =
  | { kind: 'working' }
  | { kind: 'done'; orgId: string }
  | { kind: 'error'; message: string };

/** 초대 수락. 토큰은 URL 에만 있고 DB 에는 해시만 있으므로
 *  이 화면에서 서버로 넘기는 순간 외에는 어디에도 남기지 않는다. */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, loading, switchOrg, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'working' });
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!token) {
      setState({ kind: 'error', message: '초대 토큰이 없습니다. 메일의 링크를 다시 확인해 주세요.' });
      return;
    }
    if (!user) {
      // 로그인 후 이 화면으로 돌아오게 한다 — 토큰을 그대로 들고 간다
      const back = `/invite/accept?token=${encodeURIComponent(token)}`;
      navigate(`/login?redirect=${encodeURIComponent(back)}`, { replace: true });
      return;
    }
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    (async () => {
      const { data, error } = await supabase.rpc('accept_org_invitation', { _token: token });
      if (error) {
        setState({ kind: 'error', message: error.message });
        return;
      }
      await refreshMemberships();
      const orgId = data as unknown as string;
      if (orgId) switchOrg(orgId);
      setState({ kind: 'done', orgId });
    })();
  }, [loading, navigate, refreshMemberships, switchOrg, token, user]);

  if (loading || state.kind === 'working') {
    return <FullscreenLoader message="초대 확인 중..." />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {state.kind === 'done' ? '조직에 합류했습니다' : '초대를 사용할 수 없습니다'}
          </CardTitle>
          <CardDescription>
            {state.kind === 'done'
              ? '이제 조직의 진단·평가에 참여할 수 있습니다.'
              : state.message}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {state.kind === 'done' ? (
            <Button onClick={() => navigate('/', { replace: true })}>시작하기</Button>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                초대는 14일 후 만료되고, 발행된 이메일 주소로 로그인해야 수락할 수 있습니다.
                초대한 관리자에게 재발송을 요청하세요.
              </p>
              <Button variant="outline" onClick={() => navigate('/', { replace: true })}>
                돌아가기
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
