import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Monitor, CheckCircle2, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

import EmailOtpVerification from '@/components/waiting-room/EmailOtpVerification';
import SecurityPledge from '@/components/exam/SecurityPledge';
import WebcamSelector from '@/components/waiting-room/WebcamSelector';
import DualMonitorDetector from '@/components/waiting-room/DualMonitorDetector';
import IdentityCheckCard from '@/components/waiting-room/IdentityCheckCard';
import { mergeCustomTexts, ExamCustomTexts } from '@/lib/defaultCustomTexts';
import { trackAction } from '@/lib/userActions';
import { setProctorWebcam, getProctorWebcam } from '@/lib/proctorMedia';

export default function WaitingRoom() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [invitation, setInvitation] = useState<any>(null);
  const [checks, setChecks] = useState({ webcam: false, screen: false, smsOtp: false, agree: false, pledge: false, monitor: false, identity: false });
  const skipChecks = exam?.skip_waiting_checks === true;
  const [checking, setChecking] = useState({ screen: false });
  const [starting, setStarting] = useState(false);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [now, setNow] = useState(Date.now());

  // 응시자가 대기실에 처음 진입한 시각 (block_late_entry 신규/기존 구분용)
  const enteredAtRef = useRef<number>(0);

  // sessionId 기반으로 진입 시각을 localStorage 영속화 (새로고침 회복)
  useEffect(() => {
    if (!sessionId) return;
    const key = `waitingRoom_enteredAt_${sessionId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      enteredAtRef.current = Number(stored);
    } else {
      const now = Date.now();
      enteredAtRef.current = now;
      localStorage.setItem(key, String(now));
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) fetchSessionAndExam();
    return () => {
      // 시험 입장으로 나가는 경우엔 홀더가 이 스트림을 인수받았으므로 stop하지 않는다.
      if (webcamStream && getProctorWebcam().stream !== webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
      }
    };
  }, [sessionId]);

  // Tick every second for countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // 이미 시험 진행 중인 세션이면 ExamPage 로 바로 이동 (재접속 흐름)
  useEffect(() => {
    if (session?.status === 'in_progress' && sessionId) {
      navigate(`/applicant/exam/${sessionId}`, { replace: true });
    }
  }, [session, sessionId, navigate]);

  const fetchSessionAndExam = async () => {
    setLoadingSession(true);
    setLoadError('');
    const { data: sessionData, error } = await supabase
      .from('exam_sessions').select('*, exams(*)').eq('id', sessionId!).maybeSingle();

    if (error) {
      console.error('waiting room load error:', error);
      setSession(null);
      setExam(null);
      setLoadError('대기실 정보를 불러오지 못했습니다. 로그인 계정 또는 입장 링크를 확인해 주세요.');
      setLoadingSession(false);
      return;
    }

    if (!sessionData) {
      setSession(null);
      setExam(null);
      setLoadError('접근 가능한 대기실 정보를 찾을 수 없습니다. 내 평가 목록에서 다시 입장해 주세요.');
      setLoadingSession(false);
      return;
    }

    if (sessionData) {
      setSession(sessionData);
      setExam(sessionData.exams);

      // Fetch invitation for this user+exam to check individual exemptions
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: inv } = await supabase
          .from('exam_invitations')
          .select('*')
          .eq('exam_id', sessionData.exam_id)
          .eq('email', user.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (inv) setInvitation(inv);
      }
    }
    setLoadingSession(false);
  };

  // Entry time restriction and countdown
  const { timeStatus, countdown, examStarted } = useMemo(() => {
    if (!exam) return { timeStatus: 'loading' as const, countdown: '', examStarted: false };
    if (exam.is_test_mode) return { timeStatus: 'ok' as const, countdown: '', examStarted: true };
    const examTime = new Date(exam.exam_date).getTime();
    const entryMinutes = exam.entry_start_minutes ?? 60;
    const entryStart = examTime - entryMinutes * 60 * 1000;
    const durationMs = (exam.duration_minutes || 90) * 60 * 1000;
    const lateEntryMs = ((exam as any).late_entry_minutes ?? 30) * 60 * 1000;

    if (now < entryStart) {
      const diff = Math.ceil((entryStart - now) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      return { timeStatus: 'too_early' as const, countdown: `${h > 0 ? h + '시간 ' : ''}${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`, examStarted: false };
    }

    // [2] Late entry policy:
    // - block_late_entry = true: 평가 시작 시각 이후 입실 완전 차단 (지각자 응시 X)
    //   단, 이미 시험 진행 중이던 응시자(in_progress)는 재접속 허용
    // - Absolute end mode: 종료시각 전이면 입실 허용 (남은시간 그대로)
    // - Relative mode: examTime + late_entry_minutes 까지 입실 허용
    const blockLate = (exam as any).block_late_entry === true;
    const isResumingActiveSession = session?.status === 'in_progress';
    // ⭐ 이미 시작 시각 전에 입실해서 대기 중인 응시자는 차단 예외
    const enteredBeforeExamStart = enteredAtRef.current <= examTime;
    if (blockLate && now > examTime && !isResumingActiveSession && !enteredBeforeExamStart) {
      return { timeStatus: 'too_late' as const, countdown: '', examStarted: true };
    }
    if ((exam as any).use_absolute_end) {
      const absoluteEnd = examTime + durationMs;
      if (now >= absoluteEnd) return { timeStatus: 'too_late' as const, countdown: '', examStarted: true };
    } else {
      if (now > examTime + lateEntryMs) return { timeStatus: 'too_late' as const, countdown: '', examStarted: true };
    }

    // In entry window but before exam start — allow checks, block exam start
    if (now < examTime) {
      const diff = Math.ceil((examTime - now) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      return { timeStatus: 'ok' as const, countdown: `평가 시작까지 ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, examStarted: false };
    }
    return { timeStatus: 'ok' as const, countdown: '', examStarted: true };
  }, [exam, now]);

  // If dual monitor is allowed (exam-wide or individual), auto-pass the monitor check
  const allowDualMonitor = exam?.allow_dual_monitor || invitation?.allow_dual_monitor;
  const allowNoWebcam = invitation?.allow_no_webcam;
  const allowNoScreenShare = invitation?.allow_no_screen_share;

  useEffect(() => {
    if (allowDualMonitor) {
      setChecks(p => ({ ...p, monitor: true }));
    }
  }, [allowDualMonitor]);

  useEffect(() => {
    if (allowNoWebcam) {
      setChecks(p => ({ ...p, webcam: true }));
    }
  }, [allowNoWebcam]);

  useEffect(() => {
    if (allowNoScreenShare) {
      setChecks(p => ({ ...p, screen: true }));
    }
  }, [allowNoScreenShare]);

  // Skip all hardware checks when exam-level skip is enabled
  useEffect(() => {
    if (skipChecks) {
      setChecks(p => ({ ...p, webcam: true, screen: true, smsOtp: true, monitor: true, identity: true }));
    }
  }, [skipChecks]);

  const allChecked = skipChecks ? checks.agree && checks.pledge : Object.values(checks).every(Boolean);
  const canStart = allChecked && timeStatus === 'ok' && examStarted;

  // Auto-start when exam time arrives and all checks are done
  const autoStartTriggered = useRef(false);
  useEffect(() => {
    if (!exam || exam.is_test_mode || autoStartTriggered.current) return;
    const examTime = new Date(exam.exam_date).getTime();
    // Auto-start when exam time has arrived (or passed by up to 10 min), all checks done, and countdown is empty (= past exam start)
    if (allChecked && timeStatus === 'ok' && now >= examTime && !starting) {
      autoStartTriggered.current = true;
      handleStart();
    }
  }, [allChecked, timeStatus, now, exam, starting]);

  const handleWebcamChecked = (stream: MediaStream, deviceId: string) => {
    webcamStream?.getTracks().forEach(t => t.stop());
    setWebcamStream(stream);
    setSelectedDeviceId(deviceId);
    setChecks(p => ({ ...p, webcam: true }));
    // deviceId를 즉시 sessionStorage에 저장 — router state 유실 시에도 DailyProctor가 같은 카메라 사용
    try { if (deviceId) sessionStorage.setItem('proctor_webcam_device_id', deviceId); } catch { /* ignore */ }
  };





  const checkScreen = async () => {
    setChecking(p => ({ ...p, screen: true }));
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // Chromium 힌트: "전체 화면" 탭을 기본으로 열고, 창/탭 선택 옵션을 숨김
        video: { displaySurface: 'monitor' } as any,
        audio: false,
        // 표준 외 옵션이지만 Chrome/Edge 에서 동작 (TS 타입엔 없음)
        ...( { monitorTypeSurfaces: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' } as any ),
      });
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings() as any;
      const surface = settings?.displaySurface;
      // Only accept entire screen ("monitor"), reject window/tab
      if (surface && surface !== 'monitor') {
        stream.getTracks().forEach(t => t.stop());
        toast({ title: '전체 화면만 공유 가능합니다', description: '창이나 탭이 아닌 "전체 화면"을 선택해 주세요.', variant: 'destructive' });
        return;
      }
      stream.getTracks().forEach(t => t.stop());
      setChecks(p => ({ ...p, screen: true }));
      toast({ title: '화면 공유 허용됨' });
    } catch (err) {
      const errorName = err instanceof Error ? err.name : 'unknown';
      const errorMessage = err instanceof Error ? err.message : '';
      const helpLine = '해결되지 않으면 감독관에게 문의해주세요.';
      trackAction('env_check_fail' as any, { step: 'screen', errorName, message: errorMessage }, sessionId);
      if (errorName === 'NotAllowedError') {
        toast({
          title: '화면 공유가 허용되지 않았습니다',
          description:
            '① 공유 창에서 "전체 화면"을 선택한 뒤 반드시 [공유] 버튼을 눌러주세요.\n② macOS: 시스템 설정 → 개인정보 보호 및 보안 → 화면 기록에서 브라우저를 허용한 뒤 브라우저를 완전히 종료했다가 다시 실행해주세요.\n③ 회사/기관 PC는 보안 정책으로 화면 공유가 차단될 수 있습니다. 개인 PC로 응시해주세요.\n' + helpLine,
          variant: 'destructive',
          duration: 30000,
        });
      } else if (errorName === 'NotReadableError') {
        toast({
          title: '화면을 캡처할 수 없습니다',
          description: 'Zoom, OBS, 원격제어 프로그램 등 화면을 사용 중인 다른 프로그램을 모두 종료한 뒤 다시 시도해주세요.\n종료해도 안 되면 PC를 재부팅한 뒤 브라우저만 켜고 다시 시도해주세요.\n' + helpLine,
          variant: 'destructive',
          duration: 30000,
        });
      } else if (errorName === 'AbortError') {
        toast({
          title: '화면을 캡처할 수 없는 환경입니다',
          description: '원격 데스크톱·가상 PC(VDI) 환경에서는 응시할 수 없습니다. 실제 PC에서 직접 접속해주세요.\n실제 PC인데도 발생하면 PC를 재부팅 후 다시 시도해주세요.\n' + helpLine,
          variant: 'destructive',
          duration: 30000,
        });
      } else if (errorName === 'TypeError') {
        toast({
          title: '지원되지 않는 브라우저입니다',
          description: '최신 버전의 Chrome 또는 Edge로 접속해주세요.\n카카오톡·네이버 앱 등 앱 내 브라우저에서는 응시할 수 없습니다.\n' + helpLine,
          variant: 'destructive',
          duration: 30000,
        });
      } else {
        toast({
          title: '화면 공유 실패',
          description: `오류: ${errorName}. 브라우저를 완전히 종료 후 다시 시도하고, 안 되면 PC를 재부팅해주세요.\n${helpLine}`,
          variant: 'destructive',
          duration: 30000,
        });
      }
    } finally {
      setChecking(p => ({ ...p, screen: false }));
    }
  };

  const handleStart = async () => {
    if (!sessionId || !exam) return;
    setStarting(true);

    // Check max_participants limit
    const { count, error: countErr } = await supabase
      .from('exam_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', exam.id)
      .in('status', ['in_progress', 'submitted']);

    if (!countErr && count !== null && count >= exam.max_participants) {
      toast({
        title: '입장 인원 초과',
        description: `최대 ${exam.max_participants}명까지 입장 가능합니다. 관리자에게 문의하시거나 다른 평가에 응시해 주세요.`,
        variant: 'destructive',
      });
      setStarting(false);
      return;
    }

    // 캠 스트림을 stop하지 않고 그대로 홀더에 넘겨 ExamPage/DailyProctor가 재사용하게 한다.
    // (Windows에서 stop 직후 재획득 시 NotReadableError 방지)
    setProctorWebcam(webcamStream, selectedDeviceId);
    // [5] 감독 면제(웹캠/화면공유)가 적용된 응시자는 자동으로 is_flagged=true (사후 검토 대상)
    const isExempt = !!(allowNoWebcam || allowNoScreenShare);
    const updatePayload: any = { status: 'in_progress', start_time: new Date().toISOString() };
    if (isExempt) updatePayload.is_flagged = true;

    const { error } = await supabase
      .from('exam_sessions')
      .update(updatePayload)
      .eq('id', sessionId);
    if (error) {
      toast({ title: '시험 시작 실패', description: error.message, variant: 'destructive' });
      setStarting(false);
    } else {
      // [7] Track exam start
      trackAction('exam_start', { examId: exam.id, isExempt }, sessionId);
      // 환경 점검에서 선택한 웹캠 deviceId를 ExamPage로 그대로 전달 (재선택 방지)
      navigate(`/applicant/exam/${sessionId}`, { state: { preferredVideoDeviceId: selectedDeviceId || undefined } });
    }
  };

  if (loadingSession) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
        <p className="text-sm text-muted-foreground">시험 정보를 불러오는 중...</p>
      </div>
    );
  }

  if (loadError || !exam) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-[520px]">
          <CardContent className="p-6 text-center space-y-4">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <div className="space-y-2">
              <h1 className="text-base font-bold">대기실 정보를 불러올 수 없습니다</h1>
              <p className="text-sm text-muted-foreground">{loadError || '내 평가 목록에서 다시 입장해 주세요.'}</p>
            </div>
            <Button onClick={() => navigate('/applicant')}>내 평가 목록으로 이동</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const instructions = exam.instructions || '';
  const examDate = new Date(exam.exam_date);
  const ct = mergeCustomTexts(exam.custom_texts as ExamCustomTexts | null);

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <h1>시험 대기실</h1>

      {/* Entry time restriction banner */}
      {timeStatus === 'too_early' && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-[13px] font-medium">아직 입실 시간이 아닙니다</p>
              <p className="text-[11px] text-muted-foreground">
                입실 가능 시간: {new Date(examDate.getTime() - (exam.entry_start_minutes ?? 60) * 60 * 1000).toLocaleString('ko-KR')} ~ {examDate.toLocaleString('ko-KR')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[18px] font-mono font-bold text-amber-600">{countdown}</p>
              <p className="text-[10px] text-muted-foreground">입실까지 남은 시간</p>
            </div>
          </CardContent>
        </Card>
      )}
      {timeStatus === 'too_late' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="text-[13px] font-medium">입실 시간이 종료되었습니다</p>
              <p className="text-[11px] text-muted-foreground">시험 시작 시간이 지나 입실이 불가합니다. 관리자에게 문의해 주세요.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">{exam.title}</CardTitle>
          <p className="text-[12px] text-muted-foreground">
            시험 시간: {exam.duration_minutes}분 | 시작: {examDate.toLocaleString('ko-KR')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <h3>환경 점검</h3>
          <div className="space-y-3">
            {skipChecks ? (
              <div className="p-4 rounded-md border border-primary/30 bg-primary/5 text-center">
                <CheckCircle2 className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-[13px] font-medium">환경 점검이 면제되었습니다</p>
                <p className="text-[11px] text-muted-foreground">관리자 설정에 의해 웹캠·마이크·화면공유·신분증 검사가 생략됩니다</p>
              </div>
            ) : (
            <>
            {/* Dual Monitor Check — skip if exam allows dual monitors */}
            {allowDualMonitor ? null : (
              <DualMonitorDetector onResult={(ok) => setChecks(p => ({ ...p, monitor: ok }))} descOverride={ct.waiting_room.monitor_desc} />
            )}

            {/* Webcam — skip if individually exempted */}
            {allowNoWebcam ? (
              <div className="flex items-center justify-between p-3 rounded-md border bg-card">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-medium">웹캠 면제</span>
                  <span className="text-[11px] text-muted-foreground">관리자에 의해 웹캠 검사가 면제되었습니다</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">면제</Badge>
              </div>
            ) : (

            <WebcamSelector
              checked={checks.webcam}
              checking={false}
              onChecked={handleWebcamChecked}
              stream={webcamStream}
              descOverride={ct.waiting_room.webcam_desc}
            />
            )}

            {/* Screen */}
            <CheckItem
              icon={<Monitor className="h-4 w-4 text-muted-foreground" />}
              title="3. 화면 공유 허용"
              desc={ct.waiting_room.screen_desc}
              checked={checks.screen}
              checking={checking.screen}
              onCheck={checkScreen}
            />


            {/* Email OTP */}
            <EmailOtpVerification sessionId={sessionId} verified={checks.smsOtp} onVerified={() => setChecks(p => ({ ...p, smsOtp: true }))} descOverride={ct.waiting_room.email_desc} />

            {/* Identity check: 신분증 업로드 필수, 얼굴 매칭은 시험 옵션으로 ON/OFF */}
            <IdentityCheckCard
              sessionId={sessionId}
              verified={checks.identity}
              onVerified={() => setChecks(p => ({ ...p, identity: true }))}
              skipFaceMatch={exam?.skip_face_match === true}
            />
            </>
            )}
          </div>


          {/* Instructions */}
          <Card className="bg-muted/50 border-dashed">
            <CardContent className="p-4">
              <h3 className="mb-2">유의사항</h3>
              <ul className="text-[12px] text-muted-foreground space-y-1 list-disc list-inside">
                {instructions.split('\n').filter(Boolean).map((line: string, i: number) => (
                  <li key={i}>{line.replace('• ', '')}</li>
                ))}
              </ul>
              <div className="flex items-center gap-2 mt-3">
                <Checkbox checked={checks.agree} onCheckedChange={() => setChecks(p => ({ ...p, agree: !p.agree }))} id="agree" />
                <label htmlFor="agree" className="text-[12px] font-medium cursor-pointer">위 유의사항을 모두 읽었으며 동의합니다</label>
              </div>
            </CardContent>
          </Card>

          {/* Security Pledge */}
          <SecurityPledge agreed={checks.pledge} onAgree={(v) => setChecks(p => ({ ...p, pledge: v }))} customTexts={exam.custom_texts as ExamCustomTexts | null} />

          {countdown && timeStatus === 'ok' && (
            <div className="text-center py-3 px-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-[20px] font-mono font-bold text-primary">{countdown}</p>
              <p className="text-[11px] text-muted-foreground mt-1">모든 준비가 완료되면 평가 시작 시간에 자동으로 입장합니다</p>
            </div>
          )}
          <Button className="w-full" disabled={!canStart || starting} onClick={handleStart}>
            {starting ? '평가 시작 중...' : timeStatus !== 'ok' ? '입실 시간이 아닙니다' : !examStarted ? '평가 시작 시간을 기다리는 중...' : canStart ? '평가 시작' : '모든 항목을 확인해 주세요'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CheckItem({ icon, title, desc, checked, checking, onCheck }: {
  icon: React.ReactNode; title: string; desc: string; checked: boolean; checking: boolean; onCheck: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-md border bg-card">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-[13px] font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Button variant={checked ? 'default' : 'outline'} size="sm" className="text-[12px]" onClick={onCheck} disabled={checked || checking}>
        {checking ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />확인 중...</> :
         checked ? <><CheckCircle2 className="h-3 w-3 mr-1" />확인됨</> : '확인하기'}
      </Button>
    </div>
  );
}
