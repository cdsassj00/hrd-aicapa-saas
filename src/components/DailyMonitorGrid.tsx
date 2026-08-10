import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Users, Maximize2, Minimize2, Monitor, Video, Volume2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDailyRoom } from '@/hooks/useDailyRoom';

const PAGE_SIZE = 9;                 // 감독관 브라우저 부하 완화 (16 → 9)
const SNAPSHOT_ROTATION_BATCH = 3;   // 스냅샷 모드에서 동시에 라이브 구독할 타일 수
const SNAPSHOT_ROTATION_INTERVAL_MS = 3000; // 배치 순환 주기

interface DailyMonitorGridProps {
  examId: string;
  roomName?: string;
  roomUrl?: string;
  sessionProfiles?: Map<string, string>;
}

interface ParticipantTile {
  sessionId: string;
  userName: string;
  videoTrack: MediaStreamTrack | null;
  screenTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
}

export default function DailyMonitorGrid({ examId, roomName, roomUrl, sessionProfiles }: DailyMonitorGridProps) {
  const callRef = useRef<DailyCall | null>(null);
  const { getRoom, getToken } = useDailyRoom();

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [participants, setParticipants] = useState<Map<string, ParticipantTile>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<'cam' | 'screen'>('screen');
  const [page, setPage] = useState(0);
  const [snapshotMode, setSnapshotMode] = useState(true); // 기본 ON: 대규모 시험 안전 기본값
  const [rotationTick, setRotationTick] = useState(0);

  const updateParticipants = useCallback((call: DailyCall) => {
    const all = call.participants();
    const tiles = new Map<string, ParticipantTile>();

    Object.entries(all).forEach(([id, p]) => {
      if (id === 'local') return;
      if ((p as any).owner === true) return;
      if (p.user_name === '감독관') return;
      const rawName = p.user_name || '';
      const resolvedName = (sessionProfiles && rawName ? sessionProfiles.get(rawName) : null) || rawName || '응시자';
      tiles.set(id, {
        sessionId: id,
        userName: resolvedName,
        videoTrack: p.tracks?.video?.persistentTrack || null,
        screenTrack: p.tracks?.screenVideo?.persistentTrack || null,
        audioTrack: p.tracks?.audio?.persistentTrack || null,
      });
    });

    setParticipants(new Map(tiles));
  }, [sessionProfiles]);

  const tiles = useMemo(() => Array.from(participants.values()), [participants]);
  const totalPages = Math.max(1, Math.ceil(tiles.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleTiles = useMemo(
    () => tiles.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [tiles, safePage]
  );

  // 스냅샷 모드에서 현재 라이브로 구독할 타일 ID들 (visibleTiles를 배치로 나눠 순환)
  const activeLiveIds = useMemo(() => {
    if (!snapshotMode) return new Set(visibleTiles.map(t => t.sessionId));
    if (visibleTiles.length === 0) return new Set<string>();
    const batches = Math.max(1, Math.ceil(visibleTiles.length / SNAPSHOT_ROTATION_BATCH));
    const idx = rotationTick % batches;
    const slice = visibleTiles.slice(idx * SNAPSHOT_ROTATION_BATCH, (idx + 1) * SNAPSHOT_ROTATION_BATCH);
    return new Set(slice.map(t => t.sessionId));
  }, [snapshotMode, visibleTiles, rotationTick]);

  // 스냅샷 모드 순환 타이머
  useEffect(() => {
    if (!snapshotMode || !joined) return;
    const t = setInterval(() => setRotationTick(x => x + 1), SNAPSHOT_ROTATION_INTERVAL_MS);
    return () => clearInterval(t);
  }, [snapshotMode, joined]);

  // 엄격한 구독 관리: 현재 필요한 참가자만 구독, 나머지는 완전 해제
  useEffect(() => {
    const call = callRef.current;
    if (!call || !joined) return;

    const allParticipants = call.participants();
    Object.entries(allParticipants).forEach(([id, p]) => {
      if (id === 'local') return;
      if ((p as any).owner === true) return;
      if (p.user_name === '감독관') return;

      const isExpanded = id === expandedId;
      const isActiveLive = activeLiveIds.has(id) || isExpanded;
      const audio = isExpanded;

      call.updateParticipant(id, {
        setSubscribedTracks: {
          video: isActiveLive,
          screenVideo: isActiveLive,
          audio,
        },
      });
    });
  }, [activeLiveIds, expandedId, joined, participants]);

  useEffect(() => {
    if (page >= totalPages && totalPages > 0) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  const joinAsExaminer = useCallback(async () => {
    if (joining || joined) return;
    setJoining(true);

    try {
      let rName = roomName;
      let rUrl = roomUrl;

      if (!rName || !rUrl) {
        const data = await getRoom(examId);
        rName = data?.daily_room_name;
        rUrl = data?.daily_room_url;
      }

      if (!rName || !rUrl) {
        setJoining(false);
        return;
      }

      const token = await getToken(rName, '감독관', true);
      if (!token) {
        setJoining(false);
        return;
      }

      const call = DailyIframe.createCallObject({
        audioSource: false,
        videoSource: false,
        subscribeToTracksAutomatically: false,
      });
      callRef.current = call;

      // 저품질 수신 강제 (대규모 시험 브라우저 부하 완화)
      try {
        call.updateReceiveSettings({
          base: {
            video: { layer: 0 },
            screenVideo: { layer: 0 },
          },
        });
      } catch {}

      const refresh = () => updateParticipants(call);

      call.on('joined-meeting', () => {
        setJoined(true);
        refresh();
      });
      call.on('participant-joined', refresh);
      call.on('participant-updated', refresh);
      call.on('participant-left', refresh);
      call.on('track-started', refresh);
      call.on('track-stopped', refresh);

      await call.join({ url: rUrl, token });
    } catch (err) {
      console.error('Examiner join error:', err);
    } finally {
      setJoining(false);
    }
  }, [examId, roomName, roomUrl, joining, joined, getRoom, getToken, updateParticipants]);

  useEffect(() => {
    return () => {
      callRef.current?.leave().catch(() => {});
      callRef.current?.destroy().catch(() => {});
    };
  }, []);

  const expandedParticipant = expandedId ? participants.get(expandedId) : null;

  return (
    <div className="space-y-3">
      {!joined ? (
        <div className="min-h-[320px] rounded-md border bg-muted/30 flex flex-col items-center justify-center gap-3">
          <Users className="h-8 w-8 text-muted-foreground" />
          {roomName ? (
            <>
              <p className="text-[13px] font-medium">감독 모니터링을 시작합니다</p>
              <Button size="sm" className="text-[12px]" onClick={joinAsExaminer} disabled={joining}>
                {joining ? '연결 중...' : '모니터링 시작'}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium">화상 회의가 아직 준비되지 않았습니다</p>
              <p className="text-[11px] text-muted-foreground">평가 생성 시 자동으로 개설됩니다.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {expandedParticipant && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[13px] flex items-center gap-2">
                    {expandedView === 'screen' ? <Monitor className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                    {expandedParticipant.userName} — {expandedView === 'screen' ? '화면 공유' : '웹캠'}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => setExpandedView(expandedView === 'screen' ? 'cam' : 'screen')}
                    >
                      {expandedView === 'screen' ? '웹캠 보기' : '화면 보기'}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setExpandedId(null)}>
                      <Minimize2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <SnapshotVideoTile
                  track={expandedView === 'screen' ? expandedParticipant.screenTrack : expandedParticipant.videoTrack}
                  className="w-full aspect-video rounded-md"
                  live
                />
                <AudioTile track={expandedParticipant.audioTrack} muted={false} />
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1 gap-2 flex-wrap">
            <span>
              접속 중: <b className="text-foreground">{tiles.length}명</b>
              {' · '}표시 {safePage * PAGE_SIZE + 1}-{Math.min((safePage + 1) * PAGE_SIZE, tiles.length)}
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch checked={snapshotMode} onCheckedChange={setSnapshotMode} />
                <span className="text-[11px]">저부하(스냅샷) 모드</span>
              </label>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    disabled={safePage === 0}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-[11px] font-medium tabular-nums">
                    {safePage + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {tiles.length === 0 ? (
            <div className="text-center py-8 text-[12px] text-muted-foreground">
              아직 접속한 응시자가 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {visibleTiles.map((tile) => {
                const isExpanded = expandedId === tile.sessionId;
                const isLive = activeLiveIds.has(tile.sessionId) || isExpanded;
                return (
                  <div
                    key={tile.sessionId}
                    className={cn(
                      "rounded-md border bg-card overflow-hidden cursor-pointer hover:border-primary/50 transition-colors relative",
                      isExpanded && "border-primary"
                    )}
                    onClick={() => {
                      setExpandedId(tile.sessionId);
                      setExpandedView(tile.screenTrack ? 'screen' : 'cam');
                    }}
                  >
                    <SnapshotVideoTile
                      track={tile.videoTrack}
                      className="w-full aspect-video"
                      live={isLive}
                    />
                    {snapshotMode && !isLive && (
                      <span className="absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white">
                        스냅샷
                      </span>
                    )}
                    {snapshotMode && isLive && (
                      <span className="absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded bg-red-500/80 text-white">
                        LIVE
                      </span>
                    )}
                    <div className="px-2 py-1 flex items-center justify-between">
                      <span className="text-[10px] font-medium truncate">{tile.userName}</span>
                      <div className="flex items-center gap-1">
                        {tile.videoTrack && <Video className="h-2.5 w-2.5 text-green-500" />}
                        {tile.screenTrack && <Monitor className="h-2.5 w-2.5 text-green-500" />}
                        {tile.audioTrack && <Volume2 className="h-2.5 w-2.5 text-muted-foreground" />}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(tile.sessionId);
                            setExpandedView(tile.screenTrack ? 'screen' : 'cam');
                          }}
                        >
                          <Maximize2 className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 라이브 구독 중일 때는 <video>를 렌더링해 실시간 재생하고,
 * 라이브가 아닐 때는 마지막으로 캡처된 스냅샷을 <canvas>로 보여준다.
 * 라이브가 꺼지기 직전 프레임을 캔버스에 그려두어 "영상 없음" 대신 마지막 화면을 계속 표시.
 */
function SnapshotVideoTile({
  track,
  className,
  live,
}: {
  track: MediaStreamTrack | null;
  className?: string;
  live: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastLiveRef = useRef(live);

  // 라이브 상태에서 video에 track 부착
  useEffect(() => {
    if (!videoRef.current) return;
    if (live && track) {
      videoRef.current.srcObject = new MediaStream([track]);
    } else {
      // 라이브 해제되기 직전 스냅샷을 캔버스에 저장
      try {
        const v = videoRef.current;
        const c = canvasRef.current;
        if (lastLiveRef.current && !live && v && c && v.videoWidth > 0) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext('2d');
          ctx?.drawImage(v, 0, 0, c.width, c.height);
        }
      } catch {}
      videoRef.current.srcObject = null;
    }
    lastLiveRef.current = live;
  }, [live, track]);

  // 라이브 중에도 주기적으로 스냅샷 갱신 (다음 순환 때까지의 백업 이미지)
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      try {
        const v = videoRef.current;
        const c = canvasRef.current;
        if (v && c && v.videoWidth > 0) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext('2d');
          ctx?.drawImage(v, 0, 0, c.width, c.height);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [live]);

  return (
    <div className={cn("bg-foreground/5 relative", className)}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn("w-full h-full object-cover", !live && "hidden")}
      />
      <canvas
        ref={canvasRef}
        className={cn("w-full h-full object-cover", live && "hidden")}
      />
      {!track && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">영상 없음</span>
        </div>
      )}
    </div>
  );
}

function AudioTile({ track, muted }: { track: MediaStreamTrack | null; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (ref.current && track) {
      ref.current.srcObject = new MediaStream([track]);
      ref.current.muted = muted;
    } else if (ref.current) {
      ref.current.srcObject = null;
    }
  }, [track, muted]);

  if (!track) return null;
  return <audio ref={ref} autoPlay />;
}
