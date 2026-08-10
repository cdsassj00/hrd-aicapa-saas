import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Options {
  sessionId: string;
  enabled: boolean;
  chunkMs?: number; // default 30s
}

type Kind = 'webcam' | 'screen';

interface RecorderHandle {
  recorder: MediaRecorder;
  stream: MediaStream;
  kind: Kind;
  index: number;
  startedAt: number;
  rotateTimer: number | null;
  stopping: boolean;
  closed: boolean;
}

interface PendingChunk {
  index: number;
  blob: Blob;
  mime: string;
  startedAt: Date;
  endedAt: Date;
}

async function uploadChunk(sessionId: string, kind: Kind, chunk: PendingChunk) {
  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('kind', kind);
  form.append('chunk_index', String(chunk.index));
  form.append('mime', chunk.mime);
  form.append('started_at', chunk.startedAt.toISOString());
  form.append('ended_at', chunk.endedAt.toISOString());
  form.append('file', chunk.blob, `${kind}_${String(chunk.index).padStart(5, '0')}.webm`);

  const { error } = await supabase.functions.invoke('r2-upload', { body: form });
  if (error) throw error;
}

type DiagStage = 'init' | 'media_request' | 'recorder_start' | 'recorder_stop' | 'chunk_emitted' | 'presign' | 'upload' | 'db_insert' | 'session_end';
type DiagStatus = 'info' | 'success' | 'warn' | 'error';

async function logDiag(sessionId: string, kind: Kind | 'system', stage: DiagStage, status: DiagStatus, message?: string, meta?: any) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('recording_diagnostics').insert({
      session_id: sessionId,
      applicant_id: user.id,
      kind,
      stage,
      status,
      message: message?.slice(0, 1000) || null,
      meta: meta || null,
    });
  } catch (e) {
    console.warn('[recorder][diag] failed to log', e);
  }
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

export interface KindStatus {
  active: boolean;
  uploaded: number;
  failed: number;
  pending: number;
  retrying: boolean;
  lastUploadedAt: number | null;
  lastError: string | null;
}

export interface RecorderStatus {
  webcam: KindStatus;
  screen: KindStatus;
}

const emptyStatus = (): KindStatus => ({
  active: false, uploaded: 0, failed: 0, pending: 0, retrying: false,
  lastUploadedAt: null, lastError: null,
});

export function useExamRecorder({ sessionId, enabled, chunkMs = 30_000 }: Options) {
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<RecorderStatus>({ webcam: emptyStatus(), screen: emptyStatus() });
  const handles = useRef<Partial<Record<Kind, RecorderHandle>>>({});
  const indices = useRef<Record<Kind, number>>({ webcam: 0, screen: 0 });
  const pendingRef = useRef<Record<Kind, PendingChunk[]>>({ webcam: [], screen: [] });

  const patch = useCallback((kind: Kind, p: Partial<KindStatus>) => {
    setStatus(prev => ({ ...prev, [kind]: { ...prev[kind], ...p } }));
  }, []);

  const tryUpload = useCallback(async (kind: Kind, c: PendingChunk) => {
    await uploadChunk(sessionId, kind, c);
  }, [sessionId]);

  const retry = useCallback(async (kind: Kind) => {
    const queue = pendingRef.current[kind];
    if (!queue.length) return;
    patch(kind, { retrying: true, lastError: null });
    const remaining: PendingChunk[] = [];
    let recovered = 0;
    let lastErr: string | null = null;
    for (const c of queue) {
      try {
        await tryUpload(kind, c);
        recovered += 1;
      } catch (err: any) {
        lastErr = err?.message || String(err);
        remaining.push(c);
      }
    }
    pendingRef.current[kind] = remaining;
    setStatus(prev => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        retrying: false,
        uploaded: prev[kind].uploaded + recovered,
        failed: remaining.length,
        pending: remaining.length,
        lastUploadedAt: recovered ? Date.now() : prev[kind].lastUploadedAt,
        lastError: lastErr,
      },
    }));
  }, [patch, tryUpload]);

  const startOne = useCallback(async (kind: Kind, stream: MediaStream) => {
    if (handles.current[kind]) return;
    const mime = pickMime();

    // 인코딩 부하 감소: 트랙에 낮은 해상도/프레임레이트 강제 적용
    // - 웹캠: 640x360 @ 10fps (감독 목적상 충분)
    // - 화면: 1280x720 @ 5fps (문서/코드 확인 목적상 충분)
    // - 오디오 트랙은 recorder 입력에서 제외 (마이크 정책 반영)
    const videoOnlyStream = new MediaStream(stream.getVideoTracks());
    const vTrack = videoOnlyStream.getVideoTracks()[0];
    if (vTrack) {
      const constraints = kind === 'webcam'
        ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 5, max: 8 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 2, max: 3 } };
      try { await vTrack.applyConstraints(constraints as any); } catch (e) {
        console.warn('[recorder] applyConstraints 실패 (계속 진행)', kind, e);
      }
    }
    const settings = vTrack?.getSettings?.() as any;
    logDiag(sessionId, kind, 'recorder_start', 'info', '트랙 다운스케일 적용', {
      width: settings?.width, height: settings?.height, frameRate: settings?.frameRate,
    });

    const videoBitrate = kind === 'webcam' ? 150_000 : 250_000;

    // 회전형 녹화: chunkMs마다 stop → 즉시 새 recorder 시작.
    // 이렇게 해야 각 청크가 EBML 헤더를 포함한 완전한 WebM 파일이 되어 단독 재생이 가능.
    const spawnRecorder = (): MediaRecorder | null => {
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(videoOnlyStream, { mimeType: mime, videoBitsPerSecond: videoBitrate });
      } catch (err: any) {
        logDiag(sessionId, kind, 'recorder_start', 'error', `MediaRecorder 생성 실패: ${err?.message || err}`, { mime });
        patch(kind, { lastError: err?.message || String(err) });
        return null;
      }
      const startedAtMs = Date.now();
      const idx = indices.current[kind];
      indices.current[kind] = idx + 1;

      rec.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) {
          logDiag(sessionId, kind, 'chunk_emitted', 'warn', '빈 청크 발생');
          return;
        }
        const startedAt = new Date(startedAtMs);
        const endedAt = new Date();
        const chunk: PendingChunk = { index: idx, blob: ev.data, mime, startedAt, endedAt };
        try {
          await tryUpload(kind, chunk);
          setStatus(prev => ({
            ...prev,
            [kind]: {
              ...prev[kind],
              uploaded: prev[kind].uploaded + 1,
              lastUploadedAt: endedAt.getTime(),
              lastError: null,
            },
          }));
        } catch (err: any) {
          const msg = err?.message || String(err);
          console.error('[recorder] chunk upload failed', kind, idx, err);
          logDiag(sessionId, kind, 'upload', 'error', `청크 ${idx} 업로드 실패: ${msg}`, { idx, size: ev.data.size, mime });
          pendingRef.current[kind].push(chunk);
          setStatus(prev => ({
            ...prev,
            [kind]: {
              ...prev[kind],
              failed: prev[kind].failed + 1,
              pending: pendingRef.current[kind].length,
              lastError: msg,
            },
          }));
        }
      };

      rec.onerror = (e: any) => {
        console.error('[recorder] error', kind, e);
        logDiag(sessionId, kind, 'recorder_start', 'error', `MediaRecorder 오류: ${e?.error?.message || e?.message || 'unknown'}`, { mime });
      };

      rec.onstop = () => {
        const h = handles.current[kind];
        if (!h || h.recorder !== rec) return;
        // 회전: 닫힌 상태가 아니면 다음 recorder 즉시 시작
        if (h.closed) return;
        const next = spawnRecorder();
        if (!next) return;
        h.recorder = next;
        h.startedAt = Date.now();
        h.stopping = false;
        h.rotateTimer = window.setTimeout(() => rotate(), chunkMs);
      };

      try { rec.start(); } catch (err: any) {
        logDiag(sessionId, kind, 'recorder_start', 'error', `start 실패: ${err?.message || err}`);
        return null;
      }
      return rec;
    };

    const rotate = () => {
      const h = handles.current[kind];
      if (!h || h.closed || h.stopping) return;
      h.stopping = true;
      try { h.recorder.stop(); } catch {}
    };

    const first = spawnRecorder();
    if (!first) return;
    const handle: RecorderHandle = {
      recorder: first, stream, kind,
      index: indices.current[kind],
      startedAt: Date.now(),
      rotateTimer: window.setTimeout(() => rotate(), chunkMs),
      stopping: false,
      closed: false,
    };
    handles.current[kind] = handle;
    patch(kind, { active: true });
    logDiag(sessionId, kind, 'recorder_start', 'success', '녹화 시작 (rotating)', { mime, chunkMs });
  }, [chunkMs, patch, tryUpload, sessionId]);

  const stopOne = useCallback((kind: Kind) => {
    const h = handles.current[kind];
    if (h) {
      h.closed = true;
      if (h.rotateTimer != null) { clearTimeout(h.rotateTimer); h.rotateTimer = null; }
      try { h.recorder.stop(); } catch {}
      handles.current[kind] = undefined;
      logDiag(sessionId, kind, 'recorder_stop', 'info', '녹화 중지');
    }
    patch(kind, { active: false });
  }, [patch, sessionId]);

  // 스트림 도착 로그
  useEffect(() => {
    if (webcamStream) logDiag(sessionId, 'webcam', 'media_request', 'success', '웹캠 스트림 수신', { tracks: webcamStream.getTracks().map(t => t.kind) });
  }, [sessionId, webcamStream]);
  useEffect(() => {
    if (screenStream) logDiag(sessionId, 'screen', 'media_request', 'success', '화면 스트림 수신', { tracks: screenStream.getTracks().map(t => t.kind) });
  }, [sessionId, screenStream]);

  useEffect(() => {
    if (!enabled || !webcamStream) { stopOne('webcam'); return; }
    startOne('webcam', webcamStream);
    return () => stopOne('webcam');
  }, [enabled, webcamStream, startOne, stopOne]);

  useEffect(() => {
    if (!enabled || !screenStream) { stopOne('screen'); return; }
    startOne('screen', screenStream);
    return () => stopOne('screen');
  }, [enabled, screenStream, startOne, stopOne]);

  useEffect(() => () => {
    stopOne('webcam');
    stopOne('screen');
  }, [stopOne]);

  // 30초마다 pending chunks 자동 재시도 (네트워크 일시 끊김 회복)
  useEffect(() => {
    if (!sessionId || !enabled) return;
    const interval = setInterval(() => {
      if (pendingRef.current.webcam.length > 0) retry('webcam');
      if (pendingRef.current.screen.length > 0) retry('screen');
    }, 30000);
    return () => clearInterval(interval);
  }, [sessionId, enabled, retry]);

  return { setWebcamStream, setScreenStream, status, retry };
}
