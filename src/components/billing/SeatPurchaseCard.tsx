import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { openPayment, TOSS_PAYMENT_CLIENT_KEY } from '@/lib/tossSdk';
import { Ticket, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

// 단가 — supabase/functions/_shared/tossBilling.ts SEAT_PRODUCT, 랜딩 #pricing, refund.html 과
// 같은 값이어야 한다(카드사 심사가 페이지 금액과 결제 금액을 대조). 실제 금액은 서버가 정한다.
const UNIT_SUPPLY = 25_000;
const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const totalOf = (seats: number) => Math.round(UNIT_SUPPLY * seats * 1.1);
// seat_ledger·seat_orders(0044)는 생성 타입에 아직 없다.
const db = supabase as unknown as SupabaseClient;

const REASON: Record<string, string> = { purchase: '구매', consume: '응시', grant: '지급', refund: '환불', adjust: '조정' };

type Result = { kind: 'success' | 'error'; text: string } | null;

/** 응시권(1명 = 1회 응시) 선불 구매. 정기결제 심사 전에도 일반 결제로 바로 판다. */
export default function SeatPurchaseCard() {
  const { user, activeOrgId, activeOrg } = useAuth();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [seats, setSeats] = useState(10);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const handled = useRef(false);

  const { data: balance } = useQuery({
    queryKey: ['seat-balance', activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data } = await db.rpc('org_seat_balance', { _org_id: activeOrgId });
      return (data as number | null) ?? 0;
    },
  });

  const { data: ledger = [] } = useQuery({
    queryKey: ['seat-ledger', activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data } = await db
        .from('seat_ledger')
        .select('id, delta, reason, note, created_at')
        .eq('org_id', activeOrgId!)
        .order('created_at', { ascending: false })
        .limit(10);
      return (data ?? []) as Array<{ id: string; delta: number; reason: string; note: string | null; created_at: string }>;
    },
  });

  // 결제창에서 돌아온 경우: ?seat=success&paymentKey&orderId&amount / ?seat=fail&message
  useEffect(() => {
    const r = params.get('seat');
    if (!r || handled.current) return;
    handled.current = true;
    const clear = () => setParams({}, { replace: true });
    if (r === 'fail') {
      setResult({ kind: 'error', text: params.get('message') || '결제가 취소되었거나 실패했습니다.' });
      clear();
      return;
    }
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = Number(params.get('amount'));
    if (!paymentKey || !orderId || !amount) {
      setResult({ kind: 'error', text: '결제 정보가 올바르지 않습니다.' });
      clear();
      return;
    }
    setBusy(true);
    supabase.functions
      .invoke('seat-checkout', { body: { action: 'confirm', paymentKey, orderId, amount } })
      .then(({ data, error }) => {
        if (error || !data?.ok) {
          setResult({ kind: 'error', text: data?.error || error?.message || '결제 승인에 실패했습니다.' });
          return;
        }
        setResult({ kind: 'success', text: `응시권 ${data.seats}명분(${won(data.amount)}) 결제가 완료되었습니다.` });
        qc.invalidateQueries({ queryKey: ['seat-balance'] });
        qc.invalidateQueries({ queryKey: ['seat-ledger'] });
      })
      .finally(() => { setBusy(false); clear(); });
  }, [params, setParams, qc]);

  const buy = async () => {
    if (!activeOrgId) return;
    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('seat-checkout', {
        body: { action: 'create', orgId: activeOrgId, seats },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || '주문을 만들지 못했습니다.');
      const base = `${window.location.origin}/admin/billing`;
      await openPayment({
        amount: { currency: 'KRW', value: data.amount },
        orderId: data.orderId,
        orderName: data.orderName,
        successUrl: `${base}?seat=success`,
        failUrl: `${base}?seat=fail`,
        customerEmail: user?.email ?? undefined,
        customerName: activeOrg?.orgName ?? undefined,
      });
    } catch (e) {
      // 결제창을 닫은 경우도 여기로 온다.
      setResult({ kind: 'error', text: e instanceof Error ? e.message : '결제창을 열지 못했습니다.' });
      setBusy(false);
    }
  };

  const valid = Number.isInteger(seats) && seats >= 1 && seats <= 1000;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><Ticket className="h-5 w-5" />응시권</CardTitle>
          <span className="text-sm">남은 응시권 <b className="text-lg">{balance ?? '-'}</b>명분</span>
        </div>
        <CardDescription>
          응시자 1명이 시험 1회를 볼 때마다 1명분이 차감됩니다. 필요한 만큼 미리 구매하세요(1회 결제, 자동결제 아님).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {result && (
          <Alert variant={result.kind === 'error' ? 'destructive' : 'default'}>
            {result.kind === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertTitle>{result.kind === 'error' ? '결제 실패' : '결제 완료'}</AlertTitle>
            <AlertDescription>{result.text}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">수량(명)</div>
            <Input type="number" min={1} max={1000} value={seats} onChange={(e) => setSeats(Math.floor(Number(e.target.value)))} className="w-28" />
          </div>
          <div className="text-sm">
            1인당 {won(UNIT_SUPPLY)} (부가세 별도) × {valid ? seats : '-'}명 ={' '}
            <b className="text-lg">{valid ? won(totalOf(seats)) : '-'}</b> <span className="text-muted-foreground">(부가세 포함)</span>
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
          <span>
            <a href="https://ai-hrd.com/terms.html" target="_blank" rel="noopener" className="underline">이용약관</a> 및{' '}
            <a href="https://ai-hrd.com/refund.html" target="_blank" rel="noopener" className="underline">결제·환불정책</a>을 확인했습니다.
          </span>
        </label>
        <Button onClick={buy} disabled={!agreed || !valid || busy || !TOSS_PAYMENT_CLIENT_KEY}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ticket className="h-4 w-4 mr-2" />}
          {valid ? `${won(totalOf(seats))} 결제하기` : '수량을 확인해 주세요'}
        </Button>
        {!TOSS_PAYMENT_CLIENT_KEY && (
          <p className="text-xs text-muted-foreground">결제 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.</p>
        )}
        {ledger.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">일시</th><th>내용</th><th className="text-right">수량</th></tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="py-1">{new Date(l.created_at).toLocaleString('ko-KR')}</td>
                  <td>{REASON[l.reason] ?? l.reason}{l.note ? ` · ${l.note}` : ''}</td>
                  <td className={`text-right ${l.delta > 0 ? 'text-green-600' : ''}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
