import { CircleDot, CloudUpload, CloudOff, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RecorderStatus, KindStatus } from '@/hooks/useExamRecorder';

type Kind = 'webcam' | 'screen';

interface Props {
  status: RecorderStatus;
  onRetry?: (kind: Kind) => void;
  className?: string;
}

function fmtAgo(ts: number | null): string {
  if (!ts) return '-';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  return `${m}분 전`;
}

function One({ label, kind, k, onRetry }: { label: string; kind: Kind; k: KindStatus; onRetry?: (kind: Kind) => void }) {
  const fail = k.failed > 0 || k.pending > 0;
  const color = !k.active
    ? 'text-muted-foreground'
    : fail
    ? 'text-destructive'
    : 'text-success';
  const canRetry = !!onRetry && k.pending > 0 && !k.retrying;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn('inline-flex items-center gap-1 text-[11px] font-medium', color)}
        title={
          k.lastError
            ? `최근 오류: ${k.lastError}`
            : `업로드 ${k.uploaded}건 · 실패 ${k.failed}건 · 최근 ${fmtAgo(k.lastUploadedAt)}`
        }
      >
        {k.active ? (
          <CircleDot className="h-3 w-3 animate-pulse" />
        ) : (
          <CloudOff className="h-3 w-3" />
        )}
        <span>{label}</span>
        <span className="font-mono">
          {k.uploaded}
          {fail && <span className="text-destructive">/×{k.failed}</span>}
        </span>
      </span>
      {(k.pending > 0 || k.retrying) && (
        <button
          type="button"
          disabled={!canRetry}
          onClick={() => canRetry && onRetry?.(kind)}
          className={cn(
            'inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium',
            'border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-60 disabled:cursor-not-allowed',
          )}
          title={`실패 ${k.pending}건 재시도`}
        >
          {k.retrying ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" />
          )}
          재시도
        </button>
      )}
    </span>
  );
}

export default function RecordingStatusBadge({ status, onRetry, className }: Props) {
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1 rounded-md border bg-card', className)}>
      <CloudUpload className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] text-muted-foreground">녹화</span>
      <One label="캠" kind="webcam" k={status.webcam} onRetry={onRetry} />
      <One label="화면" kind="screen" k={status.screen} onRetry={onRetry} />
    </div>
  );
}
