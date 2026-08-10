import { useEffect, useRef, useState, useCallback } from 'react';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { Card, CardContent } from '@/components/ui/card';
import { Video, VideoOff, Monitor, MonitorOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDailyRoom } from '@/hooks/useDailyRoom';
import { trackAction } from '@/lib/userActions';
import { getProctorWebcam, releaseProctorWebcam } from '@/lib/proctorMedia';

interface DailyProctorProps {
  examId: string;
  userName: string;
  sessionId: string;
  /** 대기실에서 선택된 웹캠 deviceId — 재선택 없이 그대로 재사용 */
  preferredVideoDeviceId?: string;
  onStatusChange?: (status: { camOn: boolean; screenOn: boolean; connected: boolean }) => void;
  destroyRef?: React.MutableRefObject<(() => void) | null>;
  /** Exposes the webcam <video> element for face detection */
  onVideoElement?: (el: HTMLVideoElement | null) => void;
  /** Exposes raw webcam+mic MediaStream (for recording) */
  onWebcamStream?: (stream: MediaStream | null) => void;
  /** Exposes raw screen share MediaStream (for recording) */
  onScreenStream?: (stream: MediaStream | null) => void;
  /** Exposes current error message to parent (e.g. for phase1 overlay) */
  onError?: (message: string | null) => void;
  /** 개별 응시자 면제 — 화면공유 요구 없이 진행 */
  allowNoScreenShare?: boolean;
  /** 개별 응시자 면제 — 웹캠 요구 없이 진행 */
  allowNoWebcam?: boolean;
}

export default function DailyProctor({ examId, userName, sessionId, preferredVideoDeviceId, onStatusChange, destroyRef, onVideoElement, onWebcamStream, onScreenStream, onError, allowNoScreenShare, allowNoWebcam }: DailyProctorProps) {

  const videoRef = useRef<HTMLVideoElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const lastVideoTrackId = useRef<string | null>(null);
  const { getRoom, getToken } = useDailyRoom();

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange?.({ camOn, screenOn, connected: joined });
  }, [camOn, screenOn, joined, onStatusChange]);

  const joinRoom = useCallback(async () => {
    if (joining || joined) return;
    setJoining(true);
    setError(null);

    try {
      const roomData = await getRoom(examId);
      if (!roomData?.daily_room_name) {
        setError('감독 화상회의가 아직 준비되지 않았습니다.');
        setJoining(false);
        return;
      }

      const token = await getToken(roomData.daily_room_name, userName);
      if (!token) {
        setError('토큰 발급에 실패했습니다.');
        setJoining(false);
        return;
      }

      // 우선순위: 대기실에서 획득한 live 트랙 → deviceId(prop/sessionStorage) → true
      const held = getProctorWebcam();
      const heldTrack = held.stream?.getVideoTracks().find(t => t.readyState === 'live');
      const fallbackDeviceId = preferredVideoDeviceId || held.deviceId || '';
      const videoSource: any = allowNoWebcam ? false : (heldTrack ? heldTrack : (fallbackDeviceId || true));

      const call = DailyIframe.createCallObject({
        audioSource: false,
        videoSource,
        dailyConfig: {
          userMediaVideoConstraints: {
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 10, max: 10 },
          },
        },
      });
      callRef.current = call;

      const emitWebcam = () => {
        const local = call.participants().local;
        const v = local?.tracks?.video?.persistentTrack;
        if (v) onWebcamStream?.(new MediaStream([v]));
      };


      // 선택된 카메라가 실제로 사용되고 있는지 확인하고, 아니면 강제로 교체
      const enforcePreferredCamera = async () => {
        if (!preferredVideoDeviceId) return;
        try {
          const inputs: any = await call.getInputDevices();
          const currentId = inputs?.camera?.deviceId;
          if (currentId !== preferredVideoDeviceId) {
            await call.setInputDevicesAsync({ videoDeviceId: preferredVideoDeviceId });
          }
        } catch (e) {
          console.warn('enforcePreferredCamera failed:', e);
        }
      };

      call.on('joined-meeting', async () => {
        setJoined(true);
        call.updateSendSettings({ video: { maxQuality: 'low' } }).catch(() => {});
        await enforcePreferredCamera();
        const localTrack = call.participants().local?.tracks?.video;
        const t = localTrack?.persistentTrack;
        // 실제 live 트랙이 있을 때만 캠 ON — 트랙 없이 UI만 켜지는 상황 방지
        if (t && t.readyState === 'live') {
          setCamOn(true);
          if (videoRef.current && lastVideoTrackId.current !== t.id) {
            videoRef.current.srcObject = new MediaStream([t]);
            lastVideoTrackId.current = t.id;
            onVideoElement?.(videoRef.current);
          }
          emitWebcam();
        } else {
          setCamOn(false);
        }
      });

      call.on('track-started', (ev) => {
        if (ev.participant?.local && ev.track) {
          if (ev.track.kind === 'video' && !ev.participant.screen && videoRef.current) {
            // [8] 동일 track id면 srcObject 재할당 skip → 깜빡임 제거
            if (lastVideoTrackId.current !== ev.track.id) {
              videoRef.current.srcObject = new MediaStream([ev.track]);
              lastVideoTrackId.current = ev.track.id;
              onVideoElement?.(videoRef.current);
            }
            setCamOn(true);
            emitWebcam();
          }
        }
      });

      // 카메라 획득 실패 (NotReadableError 등) — 조용히 묻히지 않도록 표면화 + 자동 재시도
      let camRetries = 0;
      call.on('camera-error', (ev: any) => {
        if (allowNoWebcam) return;
        console.error('Daily camera-error:', ev);
        setCamOn(false);
        setError('카메라 연결에 실패했습니다. 다른 프로그램이 카메라를 사용 중인지 확인해 주세요.');
        trackAction('env_check_fail' as any, { step: 'camera_live', errorName: ev?.errorMsg?.errorType || 'camera-error', message: ev?.errorMsg?.errorMsg || '' }, sessionId);
        if (camRetries < 2) {
          camRetries += 1;
          setTimeout(async () => {
            try {
              if (preferredVideoDeviceId) {
                await call.setInputDevicesAsync({ videoDeviceId: preferredVideoDeviceId });
              } else {
                call.setLocalVideo(true);
              }
            } catch (e) { console.warn('camera retry failed:', e); }
          }, 2000);
        }
      });


      call.on('error', (ev) => {
        console.error('Daily error:', ev);
        setError('화상 연결 오류가 발생했습니다.');
      });

      call.on('left-meeting', () => {
        setJoined(false);
        setCamOn(false);
        setScreenOn(false);
      });

      await call.join({ url: roomData.daily_room_url, token });
    } catch (err: any) {
      console.error('Daily join error:', err);
      setError(err.message || '화상 연결에 실패했습니다.');
    } finally {
      setJoining(false);
    }
  }, [examId, userName, getRoom, getToken, joining, joined, preferredVideoDeviceId, onVideoElement, onWebcamStream, sessionId]);

  const startScreenShare = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    if (allowNoScreenShare) return;
    try {
      // [4] 화면공유 picker 띄우기 직전 알림 → ExamBlackScreen 5초 grace 발동
      window.dispatchEvent(new CustomEvent('proctor:media-prompt'));
      // Get screen share stream manually to validate display surface
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor', frameRate: { ideal: 3, max: 5 } } as any,
        audio: false,
        ...( { monitorTypeSurfaces: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' } as any ),
      });
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings() as any;
      const surface = settings?.displaySurface;
      // Only accept entire screen ("monitor"), reject window/tab
      if (surface && surface !== 'monitor') {
        stream.getTracks().forEach(t => t.stop());
        setScreenOn(false);
        setError('전체 화면만 공유 가능합니다. "전체 화면"을 선택해 주세요.');
        // Retry after a short delay
        setTimeout(() => startScreenShare(), 1000);
        return;
      }
      // 화면공유 트랙 다운스케일 (감독 목적상 720p/3fps로 충분, R2 트래픽 절감)
      try {
        await videoTrack?.applyConstraints({ width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 3 } } as any);
      } catch { /* ignore — 일부 브라우저 미지원 */ }
      // Pass validated stream to Daily
      await call.startScreenShare({ mediaStream: stream });
      setScreenOn(true);
      setError(null);
      onScreenStream?.(stream);
      // When user stops via browser UI, propagate
      videoTrack?.addEventListener('ended', () => {
        setScreenOn(false);
        onScreenStream?.(null);
      });
    } catch (err) {
      setScreenOn(false);
      const errorName = err instanceof Error ? err.name : 'unknown';
      const errorMessage = err instanceof Error ? err.message : '';
      const helpLine = '해결되지 않으면 감독관에게 문의해주세요.';
      trackAction('env_check_fail' as any, { step: 'screen_share_live', errorName, message: errorMessage }, sessionId);
      if (errorName === 'NotAllowedError') {
        setError('화면 공유가 허용되지 않았습니다. ① 공유 창에서 "전체 화면"을 선택한 뒤 [공유] 버튼을 눌러주세요.\n② macOS: 시스템 설정 → 개인정보 보호 및 보안 → 화면 기록에서 브라우저를 허용한 뒤 브라우저를 완전히 종료했다가 다시 실행해주세요.\n③ 회사/기관 PC는 보안 정책으로 화면 공유가 차단될 수 있습니다. 개인 PC로 응시해주세요.\n' + helpLine);
      } else if (errorName === 'NotReadableError') {
        setError('화면을 캡처할 수 없습니다. Zoom, OBS, 원격제어 프로그램 등 화면을 사용 중인 다른 프로그램을 모두 종료한 뒤 다시 시도해주세요.\n종료해도 안 되면 PC를 재부팅한 뒤 브라우저만 켜고 다시 시도해주세요.\n' + helpLine);
      } else if (errorName === 'AbortError') {
        setError('화면을 캡처할 수 없는 환경입니다. 원격 데스크톱·가상 PC(VDI) 환경에서는 응시할 수 없습니다. 실제 PC에서 직접 접속해주세요.\n실제 PC인데도 발생하면 PC를 재부팅 후 다시 시도해주세요.\n' + helpLine);
      } else if (errorName === 'TypeError') {
        setError('지원되지 않는 브라우저입니다. 최신 버전의 Chrome 또는 Edge로 접속해주세요.\n카카오톡·네이버 앱 등 앱 내 브라우저에서는 응시할 수 없습니다.\n' + helpLine);
      } else {
        setError(`화면 공유 실패 — 오류: ${errorName}. 브라우저를 완전히 종료 후 다시 시도하고, 안 되면 PC를 재부팅해주세요.\n${helpLine}`);
      }
    }
  }, [onScreenStream, sessionId, allowNoScreenShare]);

  const reconnect = useCallback(async () => {
    callRef.current?.leave().catch(() => {});
    callRef.current?.destroy().catch(() => {});
    callRef.current = null;
    setJoined(false);
    setCamOn(false);
    setScreenOn(false);
    setError(null);
    // Small delay then rejoin
    setTimeout(() => joinRoom(), 500);
  }, [joinRoom]);

  const destroyCall = useCallback(() => {
    try {
      callRef.current?.leave().catch(() => {});
      callRef.current?.destroy().catch(() => {});
    } catch {}
    callRef.current = null;
    setJoined(false);
    setCamOn(false);
    setScreenOn(false);
    // 보관 중인 대기실 스트림도 정리 — 카메라 LED가 계속 켜져 있으면 안 됨
    releaseProctorWebcam();
  }, []);

  // Expose destroy to parent via ref
  useEffect(() => {
    if (destroyRef) destroyRef.current = destroyCall;
  }, [destroyRef, destroyCall]);

  useEffect(() => {
    joinRoom();
    return destroyCall;
  }, []);

  useEffect(() => {
    if (allowNoScreenShare) return;
    if (joined && !screenOn) {
      const timer = setTimeout(startScreenShare, 1500);
      return () => clearTimeout(timer);
    }
  }, [joined, screenOn, startScreenShare, allowNoScreenShare]);

  // Notify parent of error changes (e.g. phase1 overlay surfaces the reason)
  useEffect(() => {
    onError?.(error);
  }, [error, onError]);

  // Allow external UI (phase1 overlay) to trigger screen share from a user gesture
  useEffect(() => {
    const handler = () => { startScreenShare(); };
    window.addEventListener('proctor:request-screen-share', handler);
    return () => window.removeEventListener('proctor:request-screen-share', handler);
  }, [startScreenShare]);


  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-medium">🎥 감독 연결</h3>
          <div className="flex items-center gap-2">
            {allowNoWebcam ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">웹캠 면제</span>
            ) : (
              <div className="flex items-center gap-1">
                {camOn ? <Video className="h-3.5 w-3.5 text-success" /> : <VideoOff className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={cn("text-[10px] font-medium", camOn ? "text-success" : "text-muted-foreground")}>
                  {camOn ? '캠' : '캠 꺼짐'}
                </span>
              </div>
            )}
            {allowNoScreenShare ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">화면공유 면제</span>
            ) : (
              <div className="flex items-center gap-1">
                {screenOn ? <Monitor className="h-3.5 w-3.5 text-success" /> : <MonitorOff className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={cn("text-[10px] font-medium", screenOn ? "text-success" : "text-muted-foreground")}>
                  {screenOn ? '화면' : '화면 꺼짐'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="aspect-video bg-foreground/5 rounded-md overflow-hidden border relative">
          <video ref={videoRef} autoPlay playsInline muted className={cn("w-full h-full object-cover", (!camOn || allowNoWebcam) && "hidden")} />
          {(allowNoWebcam || (!camOn && !joining)) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <VideoOff className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          {!allowNoWebcam && joining && (
            <div className="absolute inset-0 flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">연결 중...</span>
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-destructive whitespace-pre-line">{error}</p>}

        {joined && !screenOn && !allowNoScreenShare && (
          <Button variant="outline" size="sm" className="w-full text-[11px] gap-1" onClick={startScreenShare}>
            <Monitor className="h-3 w-3" /> 화면 공유 시작
          </Button>
        )}

        {!joined && !joining && (
          <Button variant="outline" size="sm" className="w-full text-[11px] gap-1" onClick={reconnect}>
            <Video className="h-3 w-3" /> 감독 재연결
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
