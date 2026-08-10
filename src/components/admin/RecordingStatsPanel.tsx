import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Period = 1 | 7 | 30;

interface SessRow {
  id: string;
  start_time: string | null;
  chunks: number;
  events: number;
}

const STAGE_LABEL: Record<string, string> = {
  init: '초기화',
  media_request: '미디어 요청',
  recorder_start: '레코더 시작',
  recorder_stop: '레코더 중지',
  chunk_emitted: '청크 생성',
  presign: '권한 검증',
  upload: '업로드',
  db_insert: 'DB 저장',
  session_end: '세션 종료',
};

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

export default function RecordingStatsPanel() {
  const [period, setPeriod] = useState<Period>(7);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<SessRow[]>([]);
  const [stageStats, setStageStats] = useState<{ stage: string; status: string; count: number }[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - period * 86400_000).toISOString();
      const { data: sess } = await supabase
        .from('exam_sessions')
        .select('id, start_time')
        .gte('start_time', since)
        .limit(2000);
      const ids = (sess || []).map(s => s.id);
      if (!ids.length) { setSessions([]); setStageStats([]); return; }

      // chunks per session
      const { data: chunkRows } = await supabase
        .from('recording_chunks')
        .select('session_id')
        .in('session_id', ids);
      const chunkMap = new Map<string, number>();
      (chunkRows || []).forEach(r => chunkMap.set(r.session_id, (chunkMap.get(r.session_id) || 0) + 1));

      // events per session
      const { data: evRows } = await supabase
        .from('monitoring_events')
        .select('session_id')
        .in('session_id', ids);
      const evMap = new Map<string, number>();
      (evRows || []).forEach(r => evMap.set(r.session_id, (evMap.get(r.session_id) || 0) + 1));

      const rows: SessRow[] = (sess || []).map(s => ({
        id: s.id,
        start_time: s.start_time,
        chunks: chunkMap.get(s.id) || 0,
        events: evMap.get(s.id) || 0,
      }));
      setSessions(rows);

      // diagnostics stage breakdown
      const { data: diagRows } = await (supabase as any)
        .from('recording_diagnostics')
        .select('stage, status, session_id')
        .gte('at', since)
        .in('session_id', ids);
      const counter = new Map<string, number>();
      (diagRows || []).forEach((d: any) => {
        const k = `${d.stage}::${d.status}`;
        counter.set(k, (counter.get(k) || 0) + 1);
      });
      setStageStats(
        Array.from(counter.entries()).map(([k, count]) => {
          const [stage, status] = k.split('::');
          return { stage, status, count };
        }).sort((a, b) => b.count - a.count),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [period]);

  const stats = useMemo(() => {
    const total = sessions.length;
    const recorded = sessions.filter(s => s.chunks > 0).length;
    const missing = total - recorded;
    const avgChunks = recorded ? sessions.filter(s => s.chunks > 0).reduce((a, b) => a + b.chunks, 0) / recorded : 0;
    const avgEvents = total ? sessions.reduce((a, b) => a + b.events, 0) / total : 0;
    const corr = pearson(sessions.map(s => s.chunks), sessions.map(s => s.events));
    return { total, recorded, missing, missingPct: total ? (missing / total) * 100 : 0, avgChunks, avgEvents, corr };
  }, [sessions]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          <span className="font-semibold text-sm">녹화 진단 대시보드</span>
        </div>
        <div className="flex items-center gap-1">
          {[1, 7, 30].map(p => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'outline'}
              onClick={() => setPeriod(p as Period)}
            >
              최근 {p}일
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            새로고침
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <Stat label="응시 세션" value={`${stats.total}`} />
        <Stat label="녹화된 세션" value={`${stats.recorded}`} variant="ok" />
        <Stat label="녹화 누락" value={`${stats.missing} (${stats.missingPct.toFixed(1)}%)`} variant={stats.missing > 0 ? 'warn' : 'ok'} />
        <Stat label="평균 청크/세션" value={stats.avgChunks.toFixed(1)} />
        <Stat
          label="이벤트↔청크 상관"
          value={stats.corr === null ? '-' : stats.corr.toFixed(2)}
          hint={stats.corr === null ? '데이터 부족' : Math.abs(stats.corr) < 0.2 ? '무관 (정상)' : '상관 있음 (의심)'}
          variant={stats.corr === null ? undefined : Math.abs(stats.corr) < 0.2 ? 'ok' : 'warn'}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">진단 단계별 발생 횟수</div>
          <div className="max-h-48 overflow-auto border rounded">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 sticky top-0">
                <tr><th className="p-1.5 text-left">단계</th><th className="p-1.5 text-left">결과</th><th className="p-1.5 text-right">건수</th></tr>
              </thead>
              <tbody>
                {stageStats.length ? stageStats.map(s => (
                  <tr key={`${s.stage}-${s.status}`} className="border-t">
                    <td className="p-1.5">{STAGE_LABEL[s.stage] || s.stage}</td>
                    <td className="p-1.5">
                      <Badge variant={s.status === 'error' ? 'destructive' : s.status === 'warn' ? 'outline' : 'secondary'} className="text-[10px]">{s.status}</Badge>
                    </td>
                    <td className="p-1.5 text-right font-mono">{s.count}</td>
                  </tr>
                )) : <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">데이터 없음</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="text-[11px] text-muted-foreground mb-1">녹화 누락 세션 ({sessions.filter(s => s.chunks === 0).length}건)</div>
          <div className="max-h-48 overflow-auto border rounded">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 sticky top-0">
                <tr><th className="p-1.5 text-left">세션</th><th className="p-1.5 text-left">시작</th><th className="p-1.5 text-right">이벤트</th></tr>
              </thead>
              <tbody>
                {sessions.filter(s => s.chunks === 0).slice(0, 50).map(s => (
                  <tr key={s.id} className="border-t">
                    <td className="p-1.5 font-mono">{s.id.slice(0, 8)}…</td>
                    <td className="p-1.5">{s.start_time ? new Date(s.start_time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}</td>
                    <td className="p-1.5 text-right font-mono">{s.events}</td>
                  </tr>
                ))}
                {!sessions.filter(s => s.chunks === 0).length && (
                  <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">누락 없음 ✓</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, hint, variant }: { label: string; value: string; hint?: string; variant?: 'ok' | 'warn' }) {
  return (
    <div className={cn(
      'rounded border p-2',
      variant === 'ok' && 'border-emerald-500/30 bg-emerald-500/5',
      variant === 'warn' && 'border-destructive/30 bg-destructive/5',
    )}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
