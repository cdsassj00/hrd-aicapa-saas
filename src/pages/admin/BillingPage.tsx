import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { openBillingAuth, TOSS_CLIENT_KEY } from '@/lib/tossSdk';
import { CreditCard, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import SeatPurchaseCard from '@/components/billing/SeatPurchaseCard';

// 판매 단위 — supabase/functions/_shared/tossBilling.ts 의 PRO_PLAN, 랜딩 #pricing,
// refund.html 과 같은 값이어야 한다(카드사 심사가 페이지 금액과 결제 금액을 대조).
const PRO = {
  name: 'Pro 월 구독',
  supply: 290_000,
  total: 319_000,
  includes: ['응시 10명 포함 (초과 응시는 1인당 25,000원, 세금계산서 별도 청구)', 'AI 문항 생성', '실시간 감독 · 화면 녹화', '6축 역량 프로파일 리포트', '이메일 지원'],
};
const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const PENDING_KEY = 'billing:pending';
// subscriptions·billing_payments(0019·0028)는 생성 타입(types.ts)에 아직 없다 — 타입 재생성 전까지 비타입 쿼리.
const db = supabase as unknown as SupabaseClient;

interface Pending { orgId: string; customerKey: string }

function savePending(p: Pending) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* 저장 불가해도 진행 */ }
}
function takePending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch { return null; }
}

type Result = { kind: 'success'; text: string } | { kind: 'error'; text: string } | null;

export default function BillingPage() {
  const { user, activeOrgId, activeOrg } = useAuth();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const handled = useRef(false);

  const { data: sub } = useQuery({
    queryKey: ['subscription', activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data } = await db
        .from('subscriptions')
        .select('status, current_period_end')
        .eq('org_id', activeOrgId!)
        .maybeSingle();
      return data as { status: string; current_period_end: string | null } | null;
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['billing-payments', activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data } = await db
        .from('billing_payments')
        .select('id, order_name, amount, status, card_number, approved_at, created_at, failure_message')
        .eq('org_id', activeOrgId!)
        .order('created_at', { ascending: false })
        .limit(12);
      return (data ?? []) as Array<{ id: string; order_name: string; amount: number; status: string; card_number: string | null; approved_at: string | null; created_at: string; failure_message: string | null }>;
    },
  });

  // 결제창에서 돌아온 경우: ?result=success&authKey&customerKey / ?result=fail&code&message
  useEffect(() => {
    const r = params.get('result');
    if (!r || handled.current) return;
    handled.current = true;
    const clear = () => setParams({}, { replace: true });

    if (r === 'fail') {
      takePending();
      setResult({ kind: 'error', text: params.get('message') || '카드 등록이 취소되었거나 실패했습니다.' });
      clear();
      return;
    }

    const authKey = params.get('authKey');
    const customerKey = params.get('customerKey');
    const pending = takePending();
    const orgId = pending?.orgId ?? activeOrgId;
    if (!authKey || !customerKey || !orgId) {
      setResult({ kind: 'error', text: '결제 정보가 올바르지 않습니다. 다시 시도해 주세요.' });
      clear();
      return;
    }

    setBusy(true);
    supabase.functions
      .invoke('billing-subscribe', { body: { orgId, authKey, customerKey } })
      .then(({ data, error }) => {
        if (error || !data?.ok) {
          setResult({ kind: 'error', text: data?.error || error?.message || '결제에 실패했습니다.' });
          return;
        }
        const until = data.periodEnd ? new Date(data.periodEnd).toLocaleDateString('ko-KR') : '';
        setResult({
          kind: 'success',
          text: data.charged
            ? `${won(data.amount)} 결제가 완료되었습니다. 이용기간: ${until}까지 (매월 자동 갱신)`
            : `결제 카드가 변경되었습니다. 현재 이용기간은 ${until}까지입니다.`,
        });
        qc.invalidateQueries({ queryKey: ['subscription', orgId] });
        qc.invalidateQueries({ queryKey: ['billing-payments', orgId] });
      })
      .finally(() => {
        setBusy(false);
        clear();
      });
  }, [params, setParams, activeOrgId, qc]);

  const start = async () => {
    if (!activeOrgId) return;
    setBusy(true);
    setResult(null);
    const customerKey = crypto.randomUUID();
    savePending({ orgId: activeOrgId, customerKey });
    const base = `${window.location.origin}/admin/billing`;
    try {
      await openBillingAuth(customerKey, {
        successUrl: `${base}?result=success`,
        failUrl: `${base}?result=fail`,
        customerEmail: user?.email ?? undefined,
        customerName: activeOrg?.orgName ?? undefined,
      });
    } catch (e) {
      // 사용자가 결제창을 닫은 경우도 여기로 온다.
      takePending();
      setResult({ kind: 'error', text: e instanceof Error ? e.message : '결제창을 열지 못했습니다.' });
      setBusy(false);
    }
  };

  const active = sub?.status === 'active' && sub.current_period_end && new Date(sub.current_period_end) > new Date();

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <CreditCard className="h-6 w-6" />
        <h1 className="text-2xl font-bold">구독 · 결제</h1>
      </div>

      {result && (
        <Alert variant={result.kind === 'error' ? 'destructive' : 'default'}>
          {result.kind === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <AlertTitle>{result.kind === 'error' ? '결제 실패' : '결제 완료'}</AlertTitle>
          <AlertDescription>{result.text}</AlertDescription>
        </Alert>
      )}

      <SeatPurchaseCard />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{PRO.name}</CardTitle>
            {active ? <Badge>이용 중</Badge> : <Badge variant="outline">미구독</Badge>}
          </div>
          <CardDescription>
            1개월 단위 정기결제(자동 갱신) · 제공기간: 결제일로부터 1개월 · 다음 결제일 전 언제든 해지
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-3xl font-bold">{won(PRO.supply)}<span className="text-base font-normal text-muted-foreground"> / 월 (부가세 별도)</span></div>
            <div className="text-sm text-muted-foreground">실제 결제 금액: <b className="text-foreground">{won(PRO.total)}</b> (부가세 10% 포함) · 매월 같은 날 등록 카드로 자동 결제</div>
          </div>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {PRO.includes.map((t) => <li key={t}>{t}</li>)}
          </ul>
          {active && (
            <p className="text-sm">현재 이용기간: <b>{new Date(sub!.current_period_end!).toLocaleDateString('ko-KR')}</b>까지 · 다음 결제일에 자동 갱신됩니다.</p>
          )}

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
            <span>
              매월 {won(PRO.total)}이 등록한 카드로 자동 결제되는 것에 동의하며,{' '}
              <a href="https://ai-hrd.com/terms.html" target="_blank" rel="noopener" className="underline">이용약관</a> 및{' '}
              <a href="https://ai-hrd.com/refund.html" target="_blank" rel="noopener" className="underline">결제·환불정책</a>을 확인했습니다.
            </span>
          </label>

          <Button onClick={start} disabled={!agreed || busy || !TOSS_CLIENT_KEY} className="w-full sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
            {active ? '결제 카드 변경' : `카드 등록하고 ${won(PRO.total)} 결제하기`}
          </Button>
          {!TOSS_CLIENT_KEY && (
            <p className="text-xs text-muted-foreground">결제 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.</p>
          )}
          <p className="text-xs text-muted-foreground">
            결제는 토스페이먼츠를 통해 처리되며, 카드 정보는 당사 서버에 저장되지 않습니다. 해지·환불 문의: sjshin@cdsa.kr · 010-7107-2047
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">결제 내역</CardTitle></CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">결제 내역이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">일시</th><th>상품</th><th>금액</th><th>카드</th><th>상태</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1">{new Date(p.approved_at ?? p.created_at).toLocaleString('ko-KR')}</td>
                    <td>{p.order_name}</td>
                    <td>{won(p.amount)}</td>
                    <td>{p.card_number ?? '-'}</td>
                    <td title={p.failure_message ?? ''}>{p.status === 'DONE' ? '완료' : p.status === 'FAILED' ? '실패' : p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
