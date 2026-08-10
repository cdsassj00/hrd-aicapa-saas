import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Search, AlertTriangle, CheckCircle2, Crosshair, Play, Pause, FileWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import RecordingStatsPanel from '@/components/admin/RecordingStatsPanel';

interface DiagRow {
  id: string;
  kind: string | null;
  stage: string;
  status: string;
  message: string | null;
  meta: any;
  at: string;
}

const DIAG_STAGE_LABEL: Record<string, string> = {
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

type Kind = 'webcam' | 'screen';

interface SessionRow {
  id: string;
  exam_id: string;
  applicant_id: string;
  start_time: string | null;
  submit_time: string | null;
  is_flagged: boolean | null;
  exams: { title: string | null } | null;
  profiles: { name: string | null; email: string | null } | null;
  chunk_count?: number;
  last_chunk_at?: string | null;
}

interface ChunkRow {
  id: string;
  kind: Kind;
  chunk_index: number;
  object_key: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  started_at: string;
  ended_at: string;
  created_at: string;
  is_header: boolean | null;
}

interface EventRow {
  id: string;
  event_type: string;
  detected_at: string;
  reviewer_note: string | null;
}

interface PlaybackFetchResult {
  buffer: ArrayBuffer;
  status: number;
  contentType: string;
  contentLength: number | null;
  r2ContentType: string;
  r2ContentLength: number | null;
  elapsedMs: number;
}

type PlaybackProbeStatus = 'pending' | 'playable' | 'failed';

interface PlaybackProbe {
  status: PlaybackProbeStatus;
  checkedAt?: string;
  downloadMs?: number;
  httpStatus?: number;
  responseBytes?: number;
  contentType?: string;
  r2ContentType?: string;
  r2ContentLength?: number | null;
  failureStage?: string;
  message?: string;
}

interface PlaybackLogRow {
  id: string;
  at: string;
  kind: Kind;
  chunkId: string;
  chunkIndex: number;
  chunkTone: 'green' | 'red';
  stage: 'download' | 'response' | 'decode' | 'mse' | 'video';
  status: 'info' | 'ok' | 'error';
  message: string;
  bytes?: number | null;
  contentType?: string;
  durationMs?: number;
}

const EVENT_COLOR: Record<string, string> = {
  face_missing: 'bg-amber-500',
  multiple_faces: 'bg-orange-500',
  tab_switch: 'bg-red-500',
  window_blur: 'bg-rose-500',
  screen_share_off: 'bg-red-600',
  screen_share_picker: 'bg-purple-500',
  voice_detected: 'bg-blue-500',
};

const EVENT_LABEL: Record<string, string> = {
  face_missing: '얼굴 미감지',
  multiple_faces: '다중 얼굴',
  tab_switch: '탭 전환',
  window_blur: '창 비활성',
  screen_share_off: '화면공유 중단',
  screen_share_picker: '공유 선택창',
  voice_detected: '음성 감지',
};

const PLAYBACK_STAGE_LABEL: Record<PlaybackLogRow['stage'] | string, string> = {
  download: 'R2 다운로드',
  response: '응답 확인',
  decode: '디코딩 검사',
  mse: '복구 조립',
  video: '비디오 재생',
};

const PLAYBACK_STATUS_LABEL: Record<PlaybackLogRow['status'], string> = {
  info: '진행',
  ok: '성공',
  error: '실패',
};

function fmtKst(iso: string | null | undefined) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  } catch { return iso; }
}
function fmtBytes(n: number | null | undefined) {
  if (!n) return '-';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}
function fmtMs(n: number | null | undefined) {
  if (!n && n !== 0) return '-';
  return `${(n / 1000).toFixed(1)}s`;
}
function fmtDurationMs(n: number | null | undefined) {
  if (!n && n !== 0) return '-';
  return `${Math.round(n)}ms`;
}
function codecOf(mime: string | null | undefined) {
  if (!mime) return '-';
  const m = mime.match(/codecs=([^"';]+)/);
  return m ? m[1] : mime.split(';')[0];
}
function fmtElapsed(fromIso: string | null | undefined, toIso: string | null | undefined) {
  if (!fromIso || !toIso) return '-';
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!isFinite(ms)) return '-';
  const sign = ms < 0 ? '-' : '';
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${h > 0 ? h + ':' : ''}${pad(m)}:${pad(sec)}`;
}

interface ChunkHealth {
  ok: boolean;
  reasons: string[];
}
function assessChunk(c: ChunkRow, prev: ChunkRow | null): ChunkHealth {
  const reasons: string[] = [];
  if (!c.size_bytes || c.size_bytes < 50_000) reasons.push('비정상적으로 작음');
  if (!c.duration_ms || c.duration_ms < 1000) reasons.push('길이 누락/짧음');
  if (prev) {
    const gap = new Date(c.started_at).getTime() - new Date(prev.ended_at).getTime();
    if (gap > 5000) reasons.push(`이전 청크와 ${(gap / 1000).toFixed(1)}s 단절`);
  }
  return { ok: reasons.length === 0, reasons };
}

export default function RecordingReviewPage() {
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [playbackProbe, setPlaybackProbe] = useState<Record<string, PlaybackProbe>>({});
  const [playbackLogs, setPlaybackLogs] = useState<PlaybackLogRow[]>([]);
  const [playbackSrc, setPlaybackSrc] = useState<Record<Kind, string | null>>({ webcam: null, screen: null });
  const [repairing, setRepairing] = useState<Record<Kind, boolean>>({ webcam: false, screen: false });
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  const webcamChunks = useMemo(() => chunks.filter(c => c.kind === 'webcam'), [chunks]);
  const screenChunks = useMemo(() => chunks.filter(c => c.kind === 'screen'), [chunks]);

  const webcamRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [activeKey, setActiveKey] = useState<Record<Kind, string | null>>({ webcam: null, screen: null });
  const objectUrlRef = useRef<Record<Kind, string | null>>({ webcam: null, screen: null });
  const selectedKeyRef = useRef<Record<Kind, string | null>>({ webcam: null, screen: null });
  const loadedKeyRef = useRef<Record<Kind, string | null>>({ webcam: null, screen: null });
  const repairTimerRef = useRef<Record<Kind, number | null>>({ webcam: null, screen: null });
  const probeRunRef = useRef(0);
  const chunksRef = useRef<ChunkRow[]>([]);
  // Session-scoped LRU-ish cache for fetched chunk buffers (max ~40 entries, ~수백 MB 상한은 별도 트림)
  const fetchCacheRef = useRef<Map<string, PlaybackFetchResult>>(new Map());
  const fetchInflightRef = useRef<Map<string, Promise<PlaybackFetchResult>>>(new Map());
  const FETCH_CACHE_MAX = 40;
  // Timeline zoom (px per minute). 0 = fit to container (no scroll).
  const [timelineZoom, setTimelineZoom] = useState<number>(0);

  const getVideoRef = (kind: Kind) => kind === 'webcam' ? webcamRef : screenRef;

  const addPlaybackLog = useCallback((chunk: ChunkRow, tone: 'green' | 'red', log: Omit<PlaybackLogRow, 'id' | 'at' | 'kind' | 'chunkId' | 'chunkIndex' | 'chunkTone'>) => {
    const row: PlaybackLogRow = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      at: new Date().toISOString(),
      kind: chunk.kind,
      chunkId: chunk.id,
      chunkIndex: chunk.chunk_index,
      chunkTone: tone,
      ...log,
    };
    setPlaybackLogs(prev => [row, ...prev].slice(0, 500));
  }, []);

  const updateProbe = useCallback((chunkId: string, patch: PlaybackProbe) => {
    setPlaybackProbe(prev => ({ ...prev, [chunkId]: { ...prev[chunkId], ...patch } }));
  }, []);

  const clearRepairTimer = (kind: Kind) => {
    const timer = repairTimerRef.current[kind];
    if (timer != null) {
      window.clearTimeout(timer);
      repairTimerRef.current[kind] = null;
    }
  };

  const revokeObjectUrl = (kind: Kind) => {
    const old = objectUrlRef.current[kind];
    if (old) URL.revokeObjectURL(old);
    objectUrlRef.current[kind] = null;
  };

  const scheduleSeek = useCallback((kind: Kind, key: string, seconds: number, autoPlay: boolean) => {
    window.setTimeout(() => {
      if (selectedKeyRef.current[kind] !== key) return;
      const v = getVideoRef(kind).current;
      if (!v) return;
      const seek = () => {
        if (selectedKeyRef.current[kind] !== key) return;
        try { v.currentTime = Math.max(0, seconds); } catch {}
        if (autoPlay) v.play().catch(() => {});
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener('loadedmetadata', seek, { once: true });
    }, 60);
  }, []);

  const fetchPlaybackObject = useCallback(async (objectKey: string, sessionId: string): Promise<PlaybackFetchResult> => {
    // 캐시 적중
    const cached = fetchCacheRef.current.get(objectKey);
    if (cached) {
      // LRU 갱신: 다시 넣어 맨 뒤로
      fetchCacheRef.current.delete(objectKey);
      fetchCacheRef.current.set(objectKey, cached);
      return cached;
    }
    // 동일 키 동시요청 머지
    const inflight = fetchInflightRef.current.get(objectKey);
    if (inflight) return inflight;

    const task = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('로그인이 필요합니다');
      const started = performance.now();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/r2-playback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mode: 'object', object_key: objectKey, session_id: sessionId, expires_in: 600 }),
      });
      const elapsedMs = performance.now() - started;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `녹화 파일 읽기 실패 (${res.status})`);
      }
      const buffer = await res.arrayBuffer();
      const parseLength = (value: string | null) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      const result: PlaybackFetchResult = {
        buffer,
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        contentLength: parseLength(res.headers.get('content-length')),
        r2ContentType: res.headers.get('x-r2-content-type') || '',
        r2ContentLength: parseLength(res.headers.get('x-r2-content-length')),
        elapsedMs,
      };
      // 캐시 저장 + 트림
      fetchCacheRef.current.set(objectKey, result);
      while (fetchCacheRef.current.size > FETCH_CACHE_MAX) {
        const firstKey = fetchCacheRef.current.keys().next().value;
        if (firstKey == null) break;
        fetchCacheRef.current.delete(firstKey);
      }
      return result;
    })();
    fetchInflightRef.current.set(objectKey, task);
    try {
      return await task;
    } finally {
      fetchInflightRef.current.delete(objectKey);
    }
  }, []);

  const hasEbmlHeader = (buffer: ArrayBuffer) => {
    const b = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  };

  const getKindChunkList = useCallback((kind: Kind) => {
    const stateList = kind === 'webcam' ? webcamChunks : screenChunks;
    return stateList.length ? stateList : chunksRef.current.filter(x => x.kind === kind);
  }, [screenChunks, webcamChunks]);

  const inspectVideoDecode = useCallback((parts: BlobPart[] | ArrayBuffer, contentType: string, seekSeconds = 0) => new Promise<string>((resolve, reject) => {
    const blob = new Blob(Array.isArray(parts) ? parts : [parts], { type: contentType || 'video/webm' });
    const src = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let done = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(src);
    };
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      cleanup();
      ok ? resolve(message) : reject(new Error(message));
    };
    const timer = window.setTimeout(() => finish(false, seekSeconds > 0 ? 'seek/decode timeout' : 'loadeddata timeout'), 7000);
    const okMessage = () => {
      const dur = Number.isFinite(video.duration) ? `${video.duration.toFixed(2)}s` : 'duration unknown';
      const dim = video.videoWidth && video.videoHeight ? `${video.videoWidth}x${video.videoHeight}` : 'size unknown';
      return `${dim}, ${dur}${seekSeconds > 0 ? `, seek ${seekSeconds.toFixed(1)}s` : ''}`;
    };
    video.onloadedmetadata = () => {
      if (seekSeconds > 0) {
        try { video.currentTime = seekSeconds; } catch {}
      }
    };
    video.onseeked = () => finish(true, okMessage());
    video.onloadeddata = () => {
      if (seekSeconds > 0 && video.currentTime < Math.max(0, seekSeconds - 1)) return;
      finish(true, okMessage());
    };
    video.onerror = () => {
      const code = video.error?.code ? `code ${video.error.code}` : 'unknown';
      const msg = video.error?.message || 'HTMLMediaElement decode error';
      finish(false, `${code}: ${msg}`);
    };
    video.src = src;
    video.load();
  }), []);

  const getLegacyRepairPlan = useCallback((kind: Kind, c: ChunkRow, lookahead = 5) => {
    const list = getKindChunkList(kind);
    const targetIdx = list.findIndex(x => x.object_key === c.object_key);
    if (targetIdx < 0) return null;

    let startIdx = targetIdx;
    while (startIdx > 0) {
      const prev = list[startIdx - 1];
      const curr = list[startIdx];
      const gap = new Date(curr.started_at).getTime() - new Date(prev.ended_at).getTime();
      // legacy timeslice recordings can contain duplicated/reset chunk_index values while the
      // binary stream is still continuous. For repair, time continuity matters more than index.
      if (gap > 5000) break;
      startIdx -= 1;
    }

    const targetAndNext = list.slice(targetIdx, Math.min(list.length, targetIdx + lookahead + 1));
    const sourceChunks = [list[startIdx], ...targetAndNext]
      .filter((x, i, arr) => arr.findIndex(y => y.object_key === x.object_key) === i);
    return {
      list,
      targetIdx,
      startIdx,
      startChunk: list[startIdx],
      sourceChunks,
    };
  }, [getKindChunkList]);

  const buildHeaderBackedPlayback = useCallback(async (
    sessionId: string,
    kind: Kind,
    target: ChunkRow,
    options?: { targetFetch?: PlaybackFetchResult; lookahead?: number; logTone?: 'green' | 'red' },
  ) => {
    const list = getKindChunkList(kind);
    const targetIdx = list.findIndex(x => x.object_key === target.object_key);
    if (targetIdx < 0) throw new Error('청크 목록에서 대상 청크를 찾을 수 없습니다');

    // 미리 받은 target buffer 가 있으면 캐시에 주입 (중복 다운로드 방지)
    if (options?.targetFetch) fetchCacheRef.current.set(target.object_key, options.targetFetch);
    const fetchPart = (part: ChunkRow) => fetchPlaybackObject(part.object_key, sessionId);

    // ── 1) 헤더 청크 찾기 ──
    // 우선 DB의 is_header=true 표기를 신뢰: target 이하 인덱스에서 가장 가까운 헤더 청크.
    let headerIdx = -1;
    for (let i = targetIdx; i >= 0; i -= 1) {
      if (list[i].is_header === true) { headerIdx = i; break; }
    }
    // is_header 정보가 없는(레거시) 청크들은 백스캔으로 폴백 — 단, 직렬 → 8개씩 배치 병렬.
    if (headerIdx < 0) {
      const maxBackscan = 80;
      const minIdx = Math.max(0, targetIdx - maxBackscan);
      const BATCH = 8;
      outer:
      for (let end = targetIdx; end >= minIdx; end -= BATCH) {
        const start = Math.max(minIdx, end - BATCH + 1);
        const slice = list.slice(start, end + 1); // ascending
        const fetched = await Promise.all(slice.map(p => fetchPart(p)));
        // 큰 인덱스부터(즉 target 쪽에서 가까운 것부터) 검사
        for (let j = fetched.length - 1; j >= 0; j -= 1) {
          if (hasEbmlHeader(fetched[j].buffer)) {
            headerIdx = start + j;
            break outer;
          }
        }
      }
      if (headerIdx < 0) {
        throw new Error(`이전 ${Math.min(80, targetIdx + 1)}개 청크 안에서 EBML 헤더를 찾지 못했습니다`);
      }
    }

    // ── 2) 헤더~target+lookahead 병렬 다운로드 ──
    const endLimit = Math.min(list.length - 1, targetIdx + (options?.lookahead ?? 5));
    const range = list.slice(headerIdx, endLimit + 1);
    const fetchedAll = await Promise.all(range.map(p => fetchPart(p)));

    // ── 3) 헤더가 중간에 또 나오면(다음 segment) 거기서 잘라냄 ──
    const buffers: ArrayBuffer[] = [];
    const sourceChunks: ChunkRow[] = [];
    let contentType = range[0].mime_type || target.mime_type || 'video/webm';
    for (let i = 0; i < range.length; i += 1) {
      const part = range[i];
      const fetched = fetchedAll[i];
      const absIdx = headerIdx + i;
      const isHeader = hasEbmlHeader(fetched.buffer);
      // target 이후에 새 헤더 등장 → 새 segment 시작, 거기서 stop
      if (i > 0 && absIdx > targetIdx && isHeader) break;
      // target 이전에 더 가까운 헤더가 또 있으면 그 지점부터 다시 시작
      if (i > 0 && absIdx <= targetIdx && isHeader) {
        buffers.length = 0;
        sourceChunks.length = 0;
      }
      buffers.push(fetched.buffer);
      sourceChunks.push(part);
      contentType = fetched.contentType || fetched.r2ContentType || part.mime_type || contentType;

      if (options?.logTone && part.object_key !== target.object_key) {
        const h = assessChunk(part, null);
        addPlaybackLog(part, h.ok ? 'green' : 'red', {
          stage: 'download',
          status: 'ok',
          message: `복구용 헤더/연속 청크 다운로드(병렬) · HTTP ${fetched.status} · ${fmtBytes(fetched.buffer.byteLength)}`,
          bytes: fetched.buffer.byteLength,
          contentType,
          durationMs: fetched.elapsedMs,
        });
      }
    }

    const actualHeaderChunk = sourceChunks[0];
    if (!actualHeaderChunk || !hasEbmlHeader(buffers[0])) {
      throw new Error('조립 시작 버퍼에 EBML 헤더가 없습니다');
    }

    return {
      buffers,
      sourceChunks,
      headerChunk: actualHeaderChunk,
      contentType,
      seekSeconds: Math.max(0, (new Date(target.started_at).getTime() - new Date(actualHeaderChunk.started_at).getTime()) / 1000),
      totalBytes: buffers.reduce((sum, b) => sum + b.byteLength, 0),
    };
  }, [addPlaybackLog, fetchPlaybackObject, getKindChunkList]);

  const probeChunkPlayback = useCallback(async (sessionId: string, c: ChunkRow, tone: 'green' | 'red') => {
    updateProbe(c.id, { status: 'pending', checkedAt: new Date().toISOString(), failureStage: undefined, message: '검사 중' });
    addPlaybackLog(c, tone, { stage: 'download', status: 'info', message: 'R2 객체 다운로드 시작' });
    let fetched: PlaybackFetchResult | null = null;
    try {
      fetched = await fetchPlaybackObject(c.object_key, sessionId);
      addPlaybackLog(c, tone, {
        stage: 'response',
        status: 'ok',
        message: `HTTP ${fetched.status} · 응답 ${fmtBytes(fetched.buffer.byteLength)} · R2 ${fmtBytes(fetched.r2ContentLength)}`,
        bytes: fetched.buffer.byteLength,
        contentType: fetched.contentType || fetched.r2ContentType || c.mime_type || '',
        durationMs: fetched.elapsedMs,
      });

      if (!fetched.buffer.byteLength) throw new Error('응답 바디 0B');
      if (!hasEbmlHeader(fetched.buffer)) {
        addPlaybackLog(c, tone, {
          stage: 'decode',
          status: 'info',
          message: '단독 EBML 헤더 없음 → 실제 이전 청크들을 역추적해 헤더 포함 WebM으로 조립',
          bytes: fetched.buffer.byteLength,
          contentType: fetched.contentType || fetched.r2ContentType || c.mime_type || '',
        });
        const repaired = await buildHeaderBackedPlayback(sessionId, c.kind, c, { targetFetch: fetched, lookahead: 2, logTone: tone });
        const repairedMessage = await inspectVideoDecode(repaired.buffers, repaired.contentType);
        updateProbe(c.id, {
          status: 'playable',
          checkedAt: new Date().toISOString(),
          downloadMs: fetched.elapsedMs,
          httpStatus: fetched.status,
          responseBytes: fetched.buffer.byteLength,
          contentType: fetched.contentType,
          r2ContentType: fetched.r2ContentType,
          r2ContentLength: fetched.r2ContentLength,
          failureStage: undefined,
          message: `단독 불가, #${repaired.headerChunk.chunk_index}부터 ${repaired.sourceChunks.length}개 조립 재생 가능 · ${repairedMessage}`,
        });
        addPlaybackLog(c, tone, {
          stage: 'mse',
          status: 'ok',
          message: `헤더 역추적 복구 성공 · #${repaired.headerChunk.chunk_index}부터 ${repaired.sourceChunks.length}개 조립 · ${repairedMessage}`,
          bytes: repaired.totalBytes,
          contentType: repaired.contentType,
        });
        return;
      }
      const contentType = fetched.contentType || fetched.r2ContentType || c.mime_type || 'video/webm';
      const message = await inspectVideoDecode(fetched.buffer, contentType);
      updateProbe(c.id, {
        status: 'playable',
        checkedAt: new Date().toISOString(),
        downloadMs: fetched.elapsedMs,
        httpStatus: fetched.status,
        responseBytes: fetched.buffer.byteLength,
        contentType: fetched.contentType,
        r2ContentType: fetched.r2ContentType,
        r2ContentLength: fetched.r2ContentLength,
        failureStage: undefined,
        message,
      });
      addPlaybackLog(c, tone, {
        stage: 'decode',
        status: 'ok',
        message: `단독 디코딩 가능 · ${message}`,
        bytes: fetched.buffer.byteLength,
        contentType,
      });
    } catch (e: any) {
      const message = e?.message || String(e);
      const failureStage = message.includes('녹화 파일 읽기') || message.includes('object fetch') || message.includes('R2') || message.includes('HTTP')
        ? 'download'
        : message.includes('0B') || message.includes('응답')
        ? 'response'
        : 'decode';

      if (failureStage === 'decode') {
        const plan = getLegacyRepairPlan(c.kind, c, 0);
        if (plan && plan.startIdx < plan.targetIdx && fetched) {
          try {
            addPlaybackLog(c, tone, {
              stage: 'mse',
              status: 'info',
              message: `단독 디코딩 실패 → #${plan.startChunk.chunk_index}부터 #${c.chunk_index}까지 연속 청크로 복구 검사`,
            });
            const buffers: ArrayBuffer[] = [];
            let contentType = fetched.contentType || fetched.r2ContentType || c.mime_type || 'video/webm';
            for (const part of plan.sourceChunks) {
              const partFetched = part.object_key === c.object_key ? fetched : await fetchPlaybackObject(part.object_key, sessionId);
              if (part.object_key === plan.startChunk.object_key && !hasEbmlHeader(partFetched.buffer)) {
                throw new Error('복구 시작 청크에도 EBML 헤더가 없습니다');
              }
              buffers.push(partFetched.buffer);
              contentType = partFetched.contentType || partFetched.r2ContentType || contentType;
            }
            const seekSeconds = Math.max(0, (new Date(c.started_at).getTime() - new Date(plan.startChunk.started_at).getTime()) / 1000);
            const repairedMessage = await inspectVideoDecode(buffers, contentType, seekSeconds);
            updateProbe(c.id, {
              status: 'playable',
              checkedAt: new Date().toISOString(),
              downloadMs: fetched.elapsedMs,
              httpStatus: fetched.status,
              responseBytes: fetched.buffer.byteLength,
              contentType: fetched.contentType,
              r2ContentType: fetched.r2ContentType,
              r2ContentLength: fetched.r2ContentLength,
              failureStage: undefined,
              message: `단독 불가, 연속 청크 복구 가능 · ${repairedMessage}`,
            });
            addPlaybackLog(c, tone, {
              stage: 'mse',
              status: 'ok',
              message: `연속 청크 복구 디코딩 성공 · ${repairedMessage}`,
              bytes: buffers.reduce((sum, b) => sum + b.byteLength, 0),
              contentType,
            });
            return;
          } catch (repairErr: any) {
            addPlaybackLog(c, tone, {
              stage: 'mse',
              status: 'error',
              message: `연속 청크 복구도 실패: ${repairErr?.message || repairErr}`,
            });
          }
        }
      }

      updateProbe(c.id, {
        status: 'failed',
        checkedAt: new Date().toISOString(),
        failureStage,
        message,
      });
      addPlaybackLog(c, tone, {
        stage: failureStage as PlaybackLogRow['stage'],
        status: 'error',
        message,
      });
    }
  }, [addPlaybackLog, buildHeaderBackedPlayback, fetchPlaybackObject, getLegacyRepairPlan, inspectVideoDecode, updateProbe]);

  const probeSessionChunks = useCallback(async (sessionId: string, rows: ChunkRow[]) => {
    const runId = ++probeRunRef.current;
    const initial: Record<string, PlaybackProbe> = {};
    const jobs = rows.map((c, index) => {
      const prev = rows.slice(0, index).reverse().find(x => x.kind === c.kind) || null;
      const health = assessChunk(c, prev);
      initial[c.id] = { status: 'pending', checkedAt: new Date().toISOString(), message: '대기 중' };
      return { c, tone: health.ok ? 'green' as const : 'red' as const };
    });
    setPlaybackProbe(initial);
    setPlaybackLogs([]);

    const concurrency = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length && probeRunRef.current === runId) {
        const job = jobs[cursor++];
        await probeChunkPlayback(sessionId, job.c, job.tone);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  }, [probeChunkPlayback]);

  const runSearch = async () => {
    setSearching(true);
    try {
      // 1) 최근 녹화 청크가 있는 세션을 먼저 모은다 (녹화 없는 세션 제외)
      const sinceIso = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const { data: chunkRows, error: chunkErr } = await supabase
        .from('recording_chunks')
        .select('session_id, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (chunkErr) throw chunkErr;
      const countMap = new Map<string, { count: number; last: string }>();
      (chunkRows || []).forEach((r: any) => {
        const prev = countMap.get(r.session_id);
        if (prev) prev.count += 1;
        else countMap.set(r.session_id, { count: 1, last: r.created_at });
      });
      const sessionIds = Array.from(countMap.keys()).slice(0, 200);
      if (!sessionIds.length) {
        setSessions([]);
        toast.info('녹화된 세션이 아직 없습니다.');
        return;
      }
      // 2) 해당 세션 메타데이터 조회
      const { data, error } = await supabase
        .from('exam_sessions')
        .select('id, exam_id, applicant_id, start_time, submit_time, is_flagged, exams(title)')
        .in('id', sessionIds);
      if (error) throw error;
      const rows = (data || []) as any[];
      const ids = Array.from(new Set(rows.map(r => r.applicant_id)));
      let profilesMap: Record<string, { name: string | null; email: string | null }> = {};
      if (ids.length) {
        const [profsRes, emailsRes] = await Promise.all([
          supabase.from('profiles').select('id, name').in('id', ids),
          supabase.rpc('get_user_emails'),
        ]);
        const emailById: Record<string, string> = {};
        (emailsRes.data || []).forEach((e: any) => { emailById[e.user_id] = e.email; });
        (profsRes.data || []).forEach((p: any) => {
          profilesMap[p.id] = { name: p.name, email: emailById[p.id] || null };
        });
        ids.forEach(id => { if (!profilesMap[id]) profilesMap[id] = { name: null, email: emailById[id] || null }; });
      }
      const merged: SessionRow[] = rows.map(r => {
        const meta = countMap.get(r.id);
        return {
          ...r,
          profiles: profilesMap[r.applicant_id] || null,
          chunk_count: meta?.count || 0,
          last_chunk_at: meta?.last || null,
        };
      });
      // 최신 녹화 활동순 정렬
      merged.sort((a, b) => (b.last_chunk_at || '').localeCompare(a.last_chunk_at || ''));
      const q = search.trim().toLowerCase();
      const filtered = merged.filter(s => {
        if (!q) return true;
        const name = s.profiles?.name?.toLowerCase() || '';
        const email = s.profiles?.email?.toLowerCase() || '';
        const title = s.exams?.title?.toLowerCase() || '';
        return name.includes(q) || email.includes(q) || title.includes(q) || s.id.startsWith(q);
      });
      setSessions(filtered.slice(0, 100));
      if (!filtered.length) toast.info('검색 결과 없음');
    } catch (e: any) {
      toast.error(`검색 실패: ${e.message}`);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => { runSearch(); /* initial load */ }, []);

  const loadSession = async (s: SessionRow) => {
    setActiveSession(s);
    setChunks([]); setEvents([]); setDiagnostics([]); setUrls({});
    chunksRef.current = [];
    fetchCacheRef.current.clear();
    fetchInflightRef.current.clear();
    setPlaybackProbe({});
    setPlaybackLogs([]);
    probeRunRef.current += 1;
    (['webcam', 'screen'] as Kind[]).forEach(kind => {
      clearRepairTimer(kind);
      revokeObjectUrl(kind);
      selectedKeyRef.current[kind] = null;
      loadedKeyRef.current[kind] = null;
    });
    setPlaybackSrc({ webcam: null, screen: null });
    setRepairing({ webcam: false, screen: false });
    setActiveKey({ webcam: null, screen: null });
    setLoading(true);
    try {
      const [cRes, eRes, dRes] = await Promise.all([
        supabase.from('recording_chunks')
          .select('id,kind,chunk_index,object_key,mime_type,size_bytes,duration_ms,started_at,ended_at,created_at,is_header')
          .eq('session_id', s.id).order('started_at', { ascending: true }),
        supabase.from('monitoring_events')
          .select('id,event_type,detected_at,reviewer_note')
          .eq('session_id', s.id).order('detected_at', { ascending: true }),
        (supabase as any).from('recording_diagnostics')
          .select('id,kind,stage,status,message,meta,at')
          .eq('session_id', s.id).order('at', { ascending: true }).limit(500),
      ]);
      if (cRes.error) throw cRes.error;
      if (eRes.error) throw eRes.error;
      const cs = (cRes.data || []) as ChunkRow[];
      chunksRef.current = cs;
      setChunks(cs);
      setEvents((eRes.data || []) as EventRow[]);
      setDiagnostics((dRes?.data || []) as DiagRow[]);
      // 자동 재생 검사는 비활성화 — 청크 클릭 시점에 그때그때 디코딩/재생

      // Presign all
      const keys = cs.map(c => c.object_key);
      if (keys.length) {
        const { data: pData, error: pErr } = await supabase.functions.invoke('r2-playback', {
          body: { session_id: s.id, expires_in: 3600 },
        });
        if (pErr) throw pErr;
        setUrls(pData?.urls || {});
        // 자동 선택 비활성화 — 타임라인에서 사용자가 직접 청크를 클릭해야 R2 다운로드/디코딩이 시작됩니다.
        selectedKeyRef.current.webcam = null;
        selectedKeyRef.current.screen = null;
        setActiveKey({ webcam: null, screen: null });
      }
    } catch (e: any) {
      toast.error(`로드 실패: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const timeline = useMemo(() => {
    if (!chunks.length) return null;
    const starts = chunks.map(c => new Date(c.started_at).getTime());
    const ends = chunks.map(c => new Date(c.ended_at).getTime());
    const t0 = Math.min(...starts);
    const t1 = Math.max(...ends);
    const span = Math.max(1, t1 - t0);
    return { t0, t1, span };
  }, [chunks]);

  const repairLegacyChunk = useCallback(async (kind: Kind, c: ChunkRow, seekIso?: string, autoPlay = false) => {
    if (!activeSession) return;
    setRepairing(prev => ({ ...prev, [kind]: true }));

    try {
      const h = assessChunk(c, null);
      addPlaybackLog(c, h.ok ? 'green' : 'red', {
        stage: 'mse',
        status: 'info',
        message: '선택 청크 직접 재생 실패/지연 → 이전 청크에서 실제 EBML 헤더 역추적 시작',
      });
      const repaired = await buildHeaderBackedPlayback(activeSession.id, kind, c, { lookahead: 5, logTone: h.ok ? 'green' : 'red' });
      if (selectedKeyRef.current[kind] !== c.object_key) return;
      const blob = new Blob(repaired.buffers, { type: repaired.contentType });
      const src = URL.createObjectURL(blob);
      revokeObjectUrl(kind);
      objectUrlRef.current[kind] = src;
      setPlaybackSrc(prev => ({ ...prev, [kind]: src }));
      addPlaybackLog(c, assessChunk(c, null).ok ? 'green' : 'red', {
        stage: 'mse',
        status: 'ok',
        message: `EBML 헤더가 있는 #${repaired.headerChunk.chunk_index}부터 연속 청크 ${repaired.sourceChunks.length}개를 하나의 WebM으로 조립`,
        bytes: repaired.totalBytes,
        contentType: repaired.contentType,
      });
      const seekBase = seekIso || c.started_at;
      const offset = Math.max(0, (new Date(seekBase).getTime() - new Date(repaired.headerChunk.started_at).getTime()) / 1000);
      scheduleSeek(kind, c.object_key, offset, autoPlay);
    } catch (e: any) {
      if (selectedKeyRef.current[kind] === c.object_key) {
        const h = assessChunk(c, null);
        addPlaybackLog(c, h.ok ? 'green' : 'red', {
          stage: 'mse',
          status: 'error',
          message: e?.message || String(e),
        });
        toast.error(`복구 재생 실패: ${e?.message || e}`);
        setPlaybackSrc(prev => ({ ...prev, [kind]: null }));
        revokeObjectUrl(kind);
      }
    } finally {
      setRepairing(prev => ({ ...prev, [kind]: false }));
    }
  }, [activeSession, addPlaybackLog, buildHeaderBackedPlayback, scheduleSeek]);

  const needsLegacyRepair = useCallback((kind: Kind, c: ChunkRow) => {
    const plan = getLegacyRepairPlan(kind, c, 0);
    if (!plan) return false;
    const list = plan.list;
    const hasDuplicateIndex = new Set(list.map(x => x.chunk_index)).size < list.length;
    const hasRotatingLog = diagnostics.some(d => d.kind === kind && d.stage === 'recorder_start' && String(d.message || '').includes('rotating'));

    const probe = playbackProbe[c.id];
    if (probe?.status === 'playable' && String(probe.message || '').includes('단독 불가')) return true;
    if (probe?.status === 'failed' && (probe.failureStage === 'decode' || String(probe.message || '').includes('EBML'))) return true;
    if (probe?.status === 'playable' && !String(probe.message || '').includes('단독 불가')) return false;
    if (!hasDuplicateIndex && hasRotatingLog) return false;
    return plan.startIdx !== plan.targetIdx;
  }, [diagnostics, getLegacyRepairPlan, playbackProbe]);

  const selectChunk = useCallback((kind: Kind, c: ChunkRow, opts?: { seekIso?: string; autoPlay?: boolean }) => {
    clearRepairTimer(kind);
    revokeObjectUrl(kind);
    selectedKeyRef.current[kind] = c.object_key;
    loadedKeyRef.current[kind] = null;
    setPlaybackSrc(prev => ({ ...prev, [kind]: null }));
    setRepairing(prev => ({ ...prev, [kind]: false }));
    setActiveKey(prev => ({ ...prev, [kind]: c.object_key }));

    if (needsLegacyRepair(kind, c)) {
      repairLegacyChunk(kind, c, opts?.seekIso, !!opts?.autoPlay);
      return;
    }

    const offsetSec = opts?.seekIso
      ? Math.max(0, (new Date(opts.seekIso).getTime() - new Date(c.started_at).getTime()) / 1000)
      : 0;
    scheduleSeek(kind, c.object_key, offsetSec, !!opts?.autoPlay);

    repairTimerRef.current[kind] = window.setTimeout(() => {
      if (selectedKeyRef.current[kind] === c.object_key && loadedKeyRef.current[kind] !== c.object_key) {
        repairLegacyChunk(kind, c, opts?.seekIso, !!opts?.autoPlay);
      }
    }, 2200);
  }, [needsLegacyRepair, repairLegacyChunk, scheduleSeek]);

  useEffect(() => () => {
    (['webcam', 'screen'] as Kind[]).forEach(kind => {
      clearRepairTimer(kind);
      revokeObjectUrl(kind);
    });
  }, []);

  // 응시 기준 시각: 시험 세션 start_time → 없으면 첫 청크 시작
  const examStartIso = useMemo(() => {
    if (activeSession?.start_time) return activeSession.start_time;
    if (chunks.length) return chunks.reduce((a, b) => (a.started_at < b.started_at ? a : b)).started_at;
    return null;
  }, [activeSession?.start_time, chunks]);

  const findChunkForTime = (kind: Kind, target: number): ChunkRow | null => {
    const list = kind === 'webcam' ? webcamChunks : screenChunks;
    let candidate: ChunkRow | null = null;
    for (const c of list) {
      const cs = new Date(c.started_at).getTime();
      const ce = new Date(c.ended_at).getTime();
      if (target >= cs && target <= ce) return c;
      if (target >= cs) candidate = c;
    }
    return candidate;
  };

  const jumpTo = (iso: string) => {
    const target = new Date(iso).getTime();
    (['webcam', 'screen'] as Kind[]).forEach(kind => {
      const c = findChunkForTime(kind, target);
      if (!c) return;
      selectChunk(kind, c, { seekIso: iso, autoPlay: true });
    });
    setPlaying(true);
    toast.success(`응시 ${fmtElapsed(examStartIso, iso)} (${fmtKst(iso)}) 시점으로 이동`);
  };

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    [webcamRef.current, screenRef.current].forEach(v => {
      if (!v) return;
      if (next) v.play().catch(() => {}); else v.pause();
    });
  };

  const healthByChunkId = useMemo(() => {
    const map: Record<string, ChunkHealth> = {};
    (['webcam', 'screen'] as Kind[]).forEach(kind => {
      const list = kind === 'webcam' ? webcamChunks : screenChunks;
      list.forEach((c, i) => { map[c.id] = assessChunk(c, i ? list[i - 1] : null); });
    });
    return map;
  }, [webcamChunks, screenChunks]);

  const unhealthyCount = Object.values(healthByChunkId).filter(h => !h.ok).length;

  const playbackProbeStats = useMemo(() => {
    const values = chunks.map(c => playbackProbe[c.id]).filter(Boolean);
    return {
      total: chunks.length,
      pending: values.filter(p => p.status === 'pending').length,
      playable: values.filter(p => p.status === 'playable').length,
      failed: values.filter(p => p.status === 'failed').length,
    };
  }, [chunks, playbackProbe]);

  const renderProbeBadge = (probe?: PlaybackProbe) => {
    if (!probe) return <Badge variant="outline" className="text-[10px]">미검사</Badge>;
    if (probe.status === 'pending') return <Badge variant="outline" className="text-[10px]"><Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />검사중</Badge>;
    if (probe.status === 'playable') return <Badge variant="secondary" className="text-[10px]">재생 가능</Badge>;
    return <Badge variant="destructive" className="text-[10px]" title={`${probe.failureStage || '-'} · ${probe.message || ''}`}>재생 불가</Badge>;
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold">녹화 조회 및 재생</h1>
        <p className="text-sm text-muted-foreground">녹화 청크가 저장된 세션만 최신순으로 표시합니다. 응시생/시험명/세션ID로 좁힐 수 있습니다.</p>
      </div>

      <RecordingStatsPanel />

      <Card className="p-4">
        <div className="flex gap-2">
          <Input
            placeholder="응시생 이름·이메일·시험명·세션ID로 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          />
          <Button onClick={runSearch} disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-1">검색</span>
          </Button>
        </div>
        <div className="mt-3 max-h-64 overflow-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-2">응시생</th>
                <th className="text-left p-2">시험</th>
                <th className="text-left p-2">시작</th>
                <th className="text-left p-2">최근 녹화</th>
                <th className="text-left p-2">청크</th>
                <th className="text-left p-2">상태</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id} className={cn('border-t hover:bg-muted/30', activeSession?.id === s.id && 'bg-primary/5')}>
                  <td className="p-2">{s.profiles?.name || '-'}<div className="text-[10px] text-muted-foreground">{s.profiles?.email}</div></td>
                  <td className="p-2">{s.exams?.title || '-'}</td>
                  <td className="p-2">{fmtKst(s.start_time)}</td>
                  <td className="p-2">{fmtKst(s.last_chunk_at)}</td>
                  <td className="p-2 font-mono">{s.chunk_count ?? 0}</td>
                  <td className="p-2">{s.is_flagged ? <Badge variant="destructive">플래그</Badge> : <Badge variant="secondary">정상</Badge>}</td>
                  <td className="p-2"><Button size="sm" variant="outline" onClick={() => loadSession(s)}>조회</Button></td>
                </tr>
              ))}
              {!sessions.length && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">결과 없음</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {activeSession && (
        <>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-semibold text-sm">{activeSession.profiles?.name} · {activeSession.exams?.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  세션 {activeSession.id}
                  {examStartIso && <> · 응시 시작 {fmtKst(examStartIso)}</>}
                  {activeSession.start_time && activeSession.submit_time && <> · 총 응시 {fmtElapsed(activeSession.start_time, activeSession.submit_time)}</>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {unhealthyCount > 0 ? (
                  <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />이상 청크 {unhealthyCount}건</Badge>
                ) : chunks.length > 0 ? (
                  <Badge className="gap-1 bg-success text-success-foreground"><CheckCircle2 className="h-3 w-3" />모든 청크 정상</Badge>
                ) : null}
                {chunks.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    클릭한 청크만 디코딩
                  </Badge>
                )}
                <Button size="sm" variant="outline" onClick={togglePlay} disabled={!chunks.length}>
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span className="ml-1">{playing ? '일시정지' : '재생'}</span>
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !chunks.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">이 세션에 녹화 청크가 없습니다.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {(['webcam', 'screen'] as Kind[]).map(kind => {
                    const key = activeKey[kind];
                    const url = playbackSrc[kind] || (key ? urls[key] : null);
                    const activeChunk = key ? chunks.find(c => c.object_key === key) : null;
                    return (
                      <div key={kind} className="space-y-1">
                        <div className="text-xs font-medium">{kind === 'webcam' ? '웹캠' : '화면'}</div>
                        <div className="relative">
                          <video
                            ref={kind === 'webcam' ? webcamRef : screenRef}
                            src={url || undefined}
                            controls
                            className="w-full bg-black rounded aspect-video"
                            onLoadedData={() => {
                              if (key) loadedKeyRef.current[kind] = key;
                              clearRepairTimer(kind);
                              if (activeChunk) {
                                const h = healthByChunkId[activeChunk.id];
                                addPlaybackLog(activeChunk, h?.ok ? 'green' : 'red', {
                                  stage: 'video',
                                  status: 'ok',
                                  message: '선택 청크 video loadeddata 성공',
                                  contentType: activeChunk.mime_type || '',
                                });
                              }
                            }}
                            onError={() => {
                              if (activeChunk) {
                                const h = healthByChunkId[activeChunk.id];
                                const error = getVideoRef(kind).current?.error;
                                addPlaybackLog(activeChunk, h?.ok ? 'green' : 'red', {
                                  stage: 'video',
                                  status: 'error',
                                  message: `선택 청크 video error${error?.code ? ` code ${error.code}` : ''}${error?.message ? ` · ${error.message}` : ''}`,
                                  contentType: activeChunk.mime_type || '',
                                });
                                repairLegacyChunk(kind, activeChunk, undefined, playing);
                              }
                            }}
                            onPlay={() => setPlaying(true)}
                            onPause={() => setPlaying(false)}
                          />
                          {repairing[kind] && (
                            <div className="absolute inset-0 flex items-center justify-center rounded bg-background/70 text-xs font-medium">
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 기존 청크 복구 재생 준비 중
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{key || '청크 없음'}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Unified timeline */}
                {timeline && (() => {
                  const durMin = timeline.span / 60000;
                  // 줌 0 = fit (width 100%). 그 외엔 px/분 적용 → 가로 스크롤.
                  const trackStyle: React.CSSProperties = timelineZoom > 0
                    ? { width: `${Math.max(800, Math.round(durMin * timelineZoom))}px` }
                    : { width: '100%' };
                  // 눈금 간격: 줌·전체길이에 맞춰 자동 (1·2·5·10·15·30·60분)
                  const candidates = [1, 2, 5, 10, 15, 30, 60];
                  const pxPerMin = timelineZoom > 0 ? timelineZoom : 800 / Math.max(1, durMin);
                  const tickStepMin = candidates.find(m => m * pxPerMin >= 60) || 60;
                  const ticks: { t: number; label: string }[] = [];
                  const firstTick = Math.ceil(timeline.t0 / (tickStepMin * 60000)) * (tickStepMin * 60000);
                  for (let t = firstTick; t <= timeline.t1; t += tickStepMin * 60000) {
                    const d = new Date(t);
                    const hh = String(d.getUTCHours() + 9).padStart(2, '0').slice(-2);
                    const adjH = (d.getUTCHours() + 9) % 24;
                    const label = `${String(adjH).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
                    ticks.push({ t, label });
                  }
                  return (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">범례:</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/70" />정상 녹화 청크</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-destructive/80" />이상 청크 (작음/짧음/단절)</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-muted border" />녹화 누락 구간</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-[2px] bg-red-500" />이벤트 마커</span>
                      <span className="ml-auto inline-flex items-center gap-2">
                        <span>줌</span>
                        <Button size="sm" variant={timelineZoom === 0 ? 'secondary' : 'outline'} className="h-6 px-2 text-[10px]" onClick={() => setTimelineZoom(0)}>맞춤</Button>
                        <Button size="sm" variant={timelineZoom === 30 ? 'secondary' : 'outline'} className="h-6 px-2 text-[10px]" onClick={() => setTimelineZoom(30)}>30px/분</Button>
                        <Button size="sm" variant={timelineZoom === 60 ? 'secondary' : 'outline'} className="h-6 px-2 text-[10px]" onClick={() => setTimelineZoom(60)}>60px/분</Button>
                        <Button size="sm" variant={timelineZoom === 120 ? 'secondary' : 'outline'} className="h-6 px-2 text-[10px]" onClick={() => setTimelineZoom(120)}>120px/분</Button>
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded border bg-background/40">
                      <div style={trackStyle} className="space-y-2 p-2">
                        {/* 상단 시간 눈금 */}
                        <div className="relative h-5 border-b border-border/60">
                          {ticks.map(tk => {
                            const left = ((tk.t - timeline.t0) / timeline.span) * 100;
                            return (
                              <div key={tk.t} className="absolute top-0 h-full" style={{ left: `${left}%` }}>
                                <div className="absolute top-0 h-full w-px bg-border" />
                                <div className="absolute top-0 left-1 text-[10px] font-mono text-muted-foreground whitespace-nowrap">{tk.label}</div>
                              </div>
                            );
                          })}
                        </div>
                        {(['webcam', 'screen'] as Kind[]).map(kind => {
                          const list = kind === 'webcam' ? webcamChunks : screenChunks;
                          return (
                            <div key={kind}>
                              <div className="text-[11px] text-muted-foreground mb-1">{kind === 'webcam' ? '웹캠' : '화면'} 타임라인 ({list.length}개)</div>
                              <div className="relative h-8 bg-muted rounded overflow-hidden">
                                {/* 세로 눈금 라인 (배경) */}
                                {ticks.map(tk => {
                                  const left = ((tk.t - timeline.t0) / timeline.span) * 100;
                                  return <div key={tk.t} className="absolute top-0 h-full w-px bg-border/50" style={{ left: `${left}%` }} />;
                                })}
                                {list.map(c => {
                                  const cs = new Date(c.started_at).getTime();
                                  const ce = new Date(c.ended_at).getTime();
                                  const left = ((cs - timeline.t0) / timeline.span) * 100;
                                  const width = Math.max(0.3, ((ce - cs) / timeline.span) * 100);
                                  const h = healthByChunkId[c.id];
                                  const probe = playbackProbe[c.id];
                                  const isActive = activeKey[kind] === c.object_key;
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => selectChunk(kind, c, { autoPlay: playing })}
                                      className={cn(
                                        'absolute top-0 h-full border-r border-background/40 hover:opacity-80',
                                        h?.ok ? 'bg-emerald-500/70' : 'bg-destructive/80',
                                        probe?.status === 'failed' && !isActive && 'ring-2 ring-destructive ring-inset',
                                        isActive && 'ring-2 ring-primary ring-inset',
                                      )}
                                      style={{ left: `${left}%`, width: `${width}%` }}
                                      title={`#${c.chunk_index} · 응시 ${fmtElapsed(examStartIso, c.started_at)} · 길이 ${fmtMs(c.duration_ms)} · ${fmtBytes(c.size_bytes)} · ${codecOf(c.mime_type)}${probe?.status === 'failed' ? `\n재생 실패: ${probe.failureStage || '-'}${probe?.message ? ` · ${probe.message}` : ''}` : ''}\n시작(KST) ${fmtKst(c.started_at)}\n업로드(KST) ${fmtKst(c.created_at)}${h && !h.ok ? '\n⚠ ' + h.reasons.join(', ') : ''}`}
                                    />
                                  );
                                })}
                                {/* Event markers */}
                                {events.map(ev => {
                                  const t = new Date(ev.detected_at).getTime();
                                  if (t < timeline.t0 || t > timeline.t1) return null;
                                  const left = ((t - timeline.t0) / timeline.span) * 100;
                                  return (
                                    <button
                                      key={`${kind}-${ev.id}`}
                                      type="button"
                                      onClick={() => jumpTo(ev.detected_at)}
                                      className={cn('absolute top-0 h-full w-[2px]', EVENT_COLOR[ev.event_type] || 'bg-foreground')}
                                      style={{ left: `${left}%` }}
                                      title={`${EVENT_LABEL[ev.event_type] || ev.event_type} · ${fmtKst(ev.detected_at)}`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{fmtKst(new Date(timeline.t0).toISOString())} <span className="text-foreground/70">({fmtElapsed(examStartIso, new Date(timeline.t0).toISOString())} 경과)</span></span>
                      <span>총 {Math.round(durMin)}분 · 눈금 {tickStepMin}분 간격</span>
                      <span>{fmtKst(new Date(timeline.t1).toISOString())} <span className="text-foreground/70">({fmtElapsed(examStartIso, new Date(timeline.t1).toISOString())} 경과)</span></span>
                    </div>
                  </div>
                  );
                })()}
              </>
            )}
          </Card>

          {/* Events list with jump */}
          <Card className="p-4">
            <div className="font-semibold text-sm mb-2">감지 이벤트 ({events.length})</div>
            <div className="max-h-72 overflow-auto space-y-1">
              {events.map(ev => (
                <div key={ev.id} className="flex items-center justify-between gap-2 p-2 border rounded text-xs hover:bg-muted/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('inline-block h-2 w-2 rounded-full', EVENT_COLOR[ev.event_type] || 'bg-foreground')} />
                    <span className="font-medium shrink-0">{EVENT_LABEL[ev.event_type] || ev.event_type}</span>
                    <span className="text-muted-foreground shrink-0">응시 {fmtElapsed(examStartIso, ev.detected_at)} · {fmtKst(ev.detected_at)}</span>
                    {ev.reviewer_note && <span className="text-muted-foreground truncate">· {ev.reviewer_note}</span>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => jumpTo(ev.detected_at)} className="shrink-0">
                    <Crosshair className="h-3 w-3 mr-1" />클레임 시점으로 이동
                  </Button>
                </div>
              ))}
              {!events.length && <div className="text-xs text-muted-foreground py-4 text-center">이벤트 없음</div>}
            </div>
          </Card>

          {/* Chunks detail table */}
          <Card className="p-4">
            <div className="font-semibold text-sm mb-2">청크 상세 ({chunks.length})</div>
            <div className="max-h-80 overflow-auto rounded border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-1.5 text-left">유형</th>
                    <th className="p-1.5 text-left">#</th>
                    <th className="p-1.5 text-left">응시 경과</th>
                    <th className="p-1.5 text-left">시작(KST)</th>
                    <th className="p-1.5 text-left">길이</th>
                    <th className="p-1.5 text-left">크기</th>
                    <th className="p-1.5 text-left">코덱</th>
                    <th className="p-1.5 text-left">업로드(KST)</th>
                    <th className="p-1.5 text-left">상태</th>
                    <th className="p-1.5 text-left">재생 가능</th>
                    <th className="p-1.5 text-left">응답</th>
                  </tr>
                </thead>
                <tbody>
                  {chunks.map(c => {
                    const h = healthByChunkId[c.id];
                    const p = playbackProbe[c.id];
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="p-1.5">{c.kind === 'webcam' ? '웹캠' : '화면'}</td>
                        <td className="p-1.5 font-mono">{c.chunk_index}</td>
                        <td className="p-1.5 font-mono">{fmtElapsed(examStartIso, c.started_at)}~{fmtElapsed(examStartIso, c.ended_at)}</td>
                        <td className="p-1.5">{fmtKst(c.started_at)}</td>
                        <td className="p-1.5">{fmtMs(c.duration_ms)}</td>
                        <td className="p-1.5">{fmtBytes(c.size_bytes)}</td>
                        <td className="p-1.5">{codecOf(c.mime_type)}</td>
                        <td className="p-1.5">{fmtKst(c.created_at)}</td>
                        <td className="p-1.5">
                          {h?.ok ? <Badge variant="secondary" className="text-[10px]">정상</Badge>
                            : <Badge variant="destructive" className="text-[10px]" title={h?.reasons.join(', ')}>이상</Badge>}
                        </td>
                        <td className="p-1.5">{renderProbeBadge(p)}</td>
                        <td className="p-1.5 font-mono" title={p?.message || ''}>
                          {p ? `${fmtBytes(p.responseBytes)} · ${fmtDurationMs(p.downloadMs)} · ${(p.r2ContentType || p.contentType || '-').split(';')[0]}` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Playback diagnostics */}
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <FileWarning className="h-4 w-4" />
                <div className="font-semibold text-sm">청크 재생 상세 로그 ({playbackLogs.length})</div>
                <span className="text-[10px] text-muted-foreground">청크 클릭 시점 로그</span>
              </div>
            </div>
            <div className="max-h-80 overflow-auto rounded border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-1.5 text-left">시각(KST)</th>
                    <th className="p-1.5 text-left">색상</th>
                    <th className="p-1.5 text-left">유형/#</th>
                    <th className="p-1.5 text-left">단계</th>
                    <th className="p-1.5 text-left">결과</th>
                    <th className="p-1.5 text-left">응답 길이</th>
                    <th className="p-1.5 text-left">콘텐츠 타입</th>
                    <th className="p-1.5 text-left">소요</th>
                    <th className="p-1.5 text-left">메시지</th>
                  </tr>
                </thead>
                <tbody>
                  {playbackLogs.map(log => (
                    <tr key={log.id} className="border-t">
                      <td className="p-1.5">{fmtKst(log.at)}</td>
                      <td className="p-1.5">
                        <Badge variant={log.chunkTone === 'red' ? 'destructive' : 'secondary'} className="text-[10px]">
                          {log.chunkTone === 'red' ? '빨강' : '녹색'}
                        </Badge>
                      </td>
                      <td className="p-1.5 font-mono">{log.kind === 'webcam' ? '캠' : '화면'} #{log.chunkIndex}</td>
                      <td className="p-1.5">{PLAYBACK_STAGE_LABEL[log.stage] || log.stage}</td>
                      <td className="p-1.5">
                        <Badge variant={log.status === 'error' ? 'destructive' : log.status === 'ok' ? 'secondary' : 'outline'} className="text-[10px]">
                          {PLAYBACK_STATUS_LABEL[log.status]}
                        </Badge>
                      </td>
                      <td className="p-1.5 font-mono">{fmtBytes(log.bytes)}</td>
                      <td className="p-1.5 max-w-40 truncate" title={log.contentType || ''}>{log.contentType || '-'}</td>
                      <td className="p-1.5 font-mono">{fmtDurationMs(log.durationMs)}</td>
                      <td className="p-1.5 max-w-xl truncate" title={log.message}>{log.message}</td>
                    </tr>
                  ))}
                  {!playbackLogs.length && (
                    <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">청크 조회 후 자동으로 R2 다운로드·응답·디코딩 검사가 기록됩니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 진단 로그 (recording_diagnostics) */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileWarning className="h-4 w-4" />
              <div className="font-semibold text-sm">녹화 진단 로그 ({diagnostics.length})</div>
              {!diagnostics.length && chunks.length === 0 && (
                <Badge variant="destructive" className="text-[10px]">청크 0건 + 진단 로그 없음 → 녹화 시작 전 단계에서 실패 추정 (브라우저가 엣지 함수를 호출조차 못함)</Badge>
              )}
            </div>
            <div className="max-h-80 overflow-auto rounded border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-1.5 text-left">응시 경과</th>
                    <th className="p-1.5 text-left">시각(KST)</th>
                    <th className="p-1.5 text-left">종류</th>
                    <th className="p-1.5 text-left">단계</th>
                    <th className="p-1.5 text-left">결과</th>
                    <th className="p-1.5 text-left">메시지</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.map(d => (
                    <tr key={d.id} className="border-t">
                      <td className="p-1.5 font-mono">{fmtElapsed(examStartIso, d.at)}</td>
                      <td className="p-1.5">{fmtKst(d.at)}</td>
                      <td className="p-1.5">{d.kind === 'webcam' ? '웹캠' : d.kind === 'screen' ? '화면' : (d.kind || '-')}</td>
                      <td className="p-1.5">{DIAG_STAGE_LABEL[d.stage] || d.stage}</td>
                      <td className="p-1.5">
                        <Badge
                          variant={d.status === 'error' ? 'destructive' : d.status === 'warn' ? 'outline' : 'secondary'}
                          className="text-[10px]"
                        >{d.status}</Badge>
                      </td>
                      <td className="p-1.5 max-w-xl truncate" title={d.message || ''}>{d.message || '-'}</td>
                    </tr>
                  ))}
                  {!diagnostics.length && (
                    <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">진단 로그 없음 (이 세션은 새 녹화 진단 시스템 배포 이전이거나, 브라우저에서 녹화 훅이 실행되지 않았습니다)</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
