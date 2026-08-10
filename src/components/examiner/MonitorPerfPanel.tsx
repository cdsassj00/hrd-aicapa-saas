import { useEffect, useState } from 'react';
import { Activity, Database, Radio, Timer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MonitorPerfMetrics } from '@/hooks/useMonitorPerfMetrics';

interface Props {
  metrics: MonitorPerfMetrics;
  sessionsCached: number;
  onReset?: () => void;
}

/**
 * 감독관 모니터링 성능 지표 패널 (우하단 고정)
 * - localStorage 'monitor-perf-visible' 로 표시/숨김 토글
 */
export default function MonitorPerfPanel({ metrics, sessionsCached, onReset }: Props) {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('monitor-perf-visible') === '1';
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + P 로 토글
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setVisible(v => {
          const next = !v;
          try { localStorage.setItem('monitor-perf-visible', next ? '1' : '0'); } catch { /* ignore */ }
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!visible) {
    return (
      <button
        aria-label="성능 지표 보기"
        className="fixed bottom-3 right-3 z-40 rounded-full bg-foreground/80 text-background p-2 shadow-lg hover:bg-foreground transition-colors"
        onClick={() => {
          setVisible(true);
          try { localStorage.setItem('monitor-perf-visible', '1'); } catch { /* ignore */ }
        }}
        title="성능 지표 (Ctrl+Shift+P)"
      >
        <Activity className="h-3.5 w-3.5" />
      </button>
    );
  }

  const latencyClass = (ms: number | null) =>
    ms == null ? 'text-muted-foreground'
      : ms < 500 ? 'text-success'
      : ms < 1500 ? 'text-amber-500'
      : 'text-destructive';

  const fmtMs = (ms: number | null) => ms == null ? '-' : `${ms.toLocaleString()}ms`;
  const sinceUpdate = metrics.lastUpdate ? Math.round((Date.now() - metrics.lastUpdate) / 1000) : null;

  return (
    <div className="fixed bottom-3 right-3 z-40 w-[260px] rounded-md border bg-background/95 backdrop-blur-sm shadow-xl text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-1.5 font-medium">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span>모니터링 성능 지표</span>
        </div>
        <div className="flex items-center gap-1">
          {onReset && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={onReset}>
              초기화
            </Button>
          )}
          <button
            className="p-0.5 hover:bg-muted rounded"
            onClick={() => {
              setVisible(false);
              try { localStorage.setItem('monitor-perf-visible', '0'); } catch { /* ignore */ }
            }}
            aria-label="닫기"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        <Row icon={<Database className="h-3 w-3" />} label="DB 쿼리 누적" value={metrics.queryCount.toLocaleString()} />
        <Row icon={<Radio className="h-3 w-3" />} label="Realtime 이벤트" value={metrics.eventCount.toLocaleString()} />
        <Row icon={<Timer className="h-3 w-3" />} label="최근 지연" value={fmtMs(metrics.lastLatencyMs)} valueClass={latencyClass(metrics.lastLatencyMs)} />
        <Row icon={<Timer className="h-3 w-3 opacity-60" />} label="평균 지연 (20건)" value={fmtMs(metrics.avgLatencyMs)} valueClass={latencyClass(metrics.avgLatencyMs)} />
        <Row icon={<Timer className="h-3 w-3 opacity-40" />} label="최대 지연" value={fmtMs(metrics.maxLatencyMs)} valueClass={latencyClass(metrics.maxLatencyMs)} />
        <div className="pt-1.5 mt-1 border-t flex items-center justify-between text-muted-foreground">
          <span>캐시된 응시자</span>
          <span className="tabular-nums">{sessionsCached}명</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>마지막 업데이트</span>
          <span className="tabular-nums">{sinceUpdate == null ? '-' : `${sinceUpdate}초 전`}</span>
        </div>
        <p className="pt-1 text-[10px] text-muted-foreground/70 leading-tight">
          Ctrl+Shift+P 로 표시/숨김
        </p>
      </div>
    </div>
  );
}

function Row({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
      <span className={cn('tabular-nums font-medium', valueClass)}>{value}</span>
    </div>
  );
}
