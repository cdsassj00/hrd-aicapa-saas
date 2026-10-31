import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Row { session_id: string; name: string; status: string; attempts: number; verified_at: string | null }

/** 현장 시험: 입실 코드 표시·재발급 + 응시자별 입실 현황, 잠금 해제·직접 확인 (0047). */
export default function OnsiteExamPanel({ examId }: { examId: string }) {
  const { toast } = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const db = supabase as any;
    const [{ data: c }, { data: sess }, { data: ck }] = await Promise.all([
      db.from('exam_onsite_codes').select('code').eq('exam_id', examId).maybeSingle(),
      supabase.from('exam_sessions').select('id, applicant_id, status').eq('exam_id', examId).order('created_at'),
      db.from('exam_onsite_checkins').select('session_id, attempts, verified_at').eq('exam_id', examId),
    ]);
    setCode(c?.code ?? null);
    const ids = [...new Set((sess ?? []).map(s => s.applicant_id))];
    const { data: profs } = ids.length ? await supabase.from('profiles').select('id, name').in('id', ids) : { data: [] as any[] };
    const nameOf = new Map((profs ?? []).map((p: any) => [p.id, p.name]));
    const ckOf = new Map((ck ?? []).map((r: any) => [r.session_id, r]));
    setRows((sess ?? []).map(s => {
      const r: any = ckOf.get(s.id);
      return { session_id: s.id, name: nameOf.get(s.applicant_id) || '(이름 없음)', status: s.status, attempts: r?.attempts ?? 0, verified_at: r?.verified_at ?? null };
    }));
  }, [examId]);

  useEffect(() => { load(); }, [load]);

  const rotate = async () => {
    if (code && !confirm('입실 코드를 새로 발급할까요? 아직 입실하지 않은 응시자는 새 코드를 입력해야 합니다.')) return;
    const { data, error } = await supabase.rpc('rotate_onsite_code', { _exam_id: examId });
    if (error) { toast({ title: '발급 실패', description: error.message, variant: 'destructive' }); return; }
    setCode(data as string);
  };

  const checkin = async (sessionId: string) => {
    const { error } = await supabase.rpc('staff_onsite_checkin', { _session_id: sessionId, _verify: true });
    if (error) { toast({ title: '처리 실패', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  return (
    <div className="space-y-2" data-testid="onsite-panel">
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-muted-foreground">입실 코드</span>
        <span className="font-mono text-xl font-bold tracking-[0.3em]" data-testid="onsite-code">{code ?? '------'}</span>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[12px]" onClick={rotate}>
          {code ? '재발급' : '발급'}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 ml-auto" onClick={load} aria-label="새로고침">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">시험장에서 신분증을 확인한 뒤 이 코드를 칠판에 쓰거나 불러 주세요.</p>
      {rows.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded border">
          <table className="w-full text-[12px]">
            <tbody>
              {rows.map(r => (
                <tr key={r.session_id} className="border-b last:border-0">
                  <td className="px-2 py-1">{r.name}</td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {r.verified_at ? '입실 확인' : r.attempts >= 10 ? '잠김' : r.attempts > 0 ? `오입력 ${r.attempts}회` : '대기'}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {!r.verified_at && (
                      <Button type="button" size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => checkin(r.session_id)}>
                        {r.attempts >= 10 ? '잠금 해제·입실 처리' : '직접 입실 처리'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
