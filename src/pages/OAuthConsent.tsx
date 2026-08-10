import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FullscreenLoader } from "@/components/FullscreenLoader";

// Typed wrapper around the beta supabase.auth.oauth namespace.
const oauth = (supabase.auth as unknown as {
  oauth: {
    getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
    approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
    denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  };
}).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("authorization_id 파라미터가 없습니다.");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?redirect=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("인증 서버에서 리다이렉트 URL을 반환하지 않았습니다.");
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>연결 요청을 불러올 수 없습니다</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      </main>
    );
  }
  if (!details) return <FullscreenLoader message="연결 요청 확인 중..." />;

  const clientName = details.client?.name ?? "외부 앱";
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>{clientName}을(를) 내 계정에 연결하시겠습니까?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            승인하면 {clientName}이(가) 사용자님의 AI CAPA 계정 권한으로
            응시 세션·인증서 등 본인 데이터를 조회할 수 있습니다.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" disabled={busy} onClick={() => decide(false)}>거부</Button>
            <Button disabled={busy} onClick={() => decide(true)}>승인</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
