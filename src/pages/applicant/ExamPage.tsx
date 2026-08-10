import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronLeft, ChevronRight, Clock, Upload, AlertTriangle, Video, VideoOff, Monitor, MonitorOff, WifiOff, SendHorizontal, Download, FileText, Megaphone, Bell } from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import DailyProctor from '@/components/DailyProctor';
import ExamBlackScreen from '@/components/exam/ExamBlackScreen';
import ExamPolicyBanner, { questionTypeLabels } from '@/components/exam/ExamPolicyBanner';
import { ExamCustomTexts } from '@/lib/defaultCustomTexts';
import McAnswerSelector from '@/components/exam/McAnswerSelector';
import ExamChatPanel from '@/components/exam/ExamChatPanel';
import FaceMonitor from '@/components/exam/FaceMonitor';

import { trackAction, flushActions } from '@/lib/userActions';
import SetScenarioCard from '@/components/exam/SetScenarioCard';
import SlotAnswerPanel from '@/components/exam/SlotAnswerPanel';
import type { QuestionSet, SubmissionSlot } from '@/lib/examStructure';
import { downloadAttachment, downloadAttachmentsAsZip } from '@/lib/attachmentDownload';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MarkdownView from '@/components/exam/MarkdownView';
import { useExamRecorder } from '@/hooks/useExamRecorder';
import RecordingStatusBadge from '@/components/exam/RecordingStatusBadge';

const categoryColors: Record<string, string> = {
  '생성형AI활용': 'bg-grade-green-bg text-grade-green border-grade-green/20',
  '데이터분석': 'bg-grade-blue-bg text-grade-blue border-grade-blue/20',
  '서비스구현': 'bg-grade-black-bg text-grade-black border-grade-black/20',
};

export default function ExamPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams();
  const { toast } = useToast();
  // 대기실에서 선택한 웹캠 deviceId — router state 유실 대비해 sessionStorage로 폴백
  const preferredVideoDeviceId: string | undefined =
    (location.state as any)?.preferredVideoDeviceId
    || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('proctor_webcam_device_id') || undefined : undefined);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitOpen, setSubmitOpen] = useState(false);
  const [confirmUnanswered, setConfirmUnanswered] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [violationCount, setViolationCount] = useState(0);
  const [questions, setQuestions] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [examTitle, setExamTitle] = useState('');
  const [examCustomTexts, setExamCustomTexts] = useState<ExamCustomTexts | null>(null);
  const [skipFaceMatch, setSkipFaceMatch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [proctorStatus, setProctorStatus] = useState({ camOn: false, screenOn: false, connected: false });
  const [proctorError, setProctorError] = useState<string | null>(null);
  const [exemptions, setExemptions] = useState({ allow_no_screen_share: false, allow_no_webcam: false });

  const [screenSharedOnce, setScreenSharedOnce] = useState(false);
  const dailyDestroyRef = useRef<(() => void) | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // 공지사항 히스토리 (시험 중 언제든 재확인 가능)
  const [announcementHistory, setAnnouncementHistory] = useState<Array<{ id: string; message: string; created_at: string }>>([]);
  const [announcementPopoverOpen, setAnnouncementPopoverOpen] = useState(false);
  const [webcamVideoEl, setWebcamVideoEl] = useState<HTMLVideoElement | null>(null);
  const [webcamStream, setWebcamStreamState] = useState<MediaStream | null>(null);
  // 세트/슬롯 지원
  const [setsById, setSetsById] = useState<Record<string, QuestionSet>>({});
  const [slotValues, setSlotValues] = useState<Record<string, Record<string, string>>>({});  // qId → slotId → value

  // R2 chunk recorder (webcam+mic & screen)
  const { setWebcamStream, setScreenStream, status: recStatus, retry: recRetry } = useExamRecorder({
    sessionId: sessionId || '',
    enabled: !!sessionId && proctorStatus.connected,
  });



  // Get current user
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
        setCurrentUserEmail(data.user.email || '');
        const { data: profile } = await supabase.from('profiles').select('name').eq('id', data.user.id).single();
        if (profile?.name) setProfileName(profile.name);
      }
    });
  }, []);

  // Fetch exemption flags from exam_invitations
  useEffect(() => {
    if (!session?.exam_id || !currentUserEmail) return;
    (async () => {
      const { data } = await supabase
        .from('exam_invitations')
        .select('allow_no_screen_share, allow_no_webcam')
        .eq('exam_id', session.exam_id)
        .eq('email', currentUserEmail)
        .maybeSingle();
      if (data) setExemptions({
        allow_no_screen_share: !!data.allow_no_screen_share,
        allow_no_webcam: !!data.allow_no_webcam,
      });
    })();
  }, [session?.exam_id, currentUserEmail]);

  // 이전 시험에서 실패한 monitoring 이벤트 재전송
  useEffect(() => {
    (async () => {
      try {
        const key = 'pendingMonitoringEvents';
        const pending = JSON.parse(localStorage.getItem(key) || '[]');
        if (!pending.length) return;
        const { error } = await supabase.from('monitoring_events').insert(pending);
        if (!error) localStorage.removeItem(key);
      } catch { /* silent */ }
    })();
  }, []);

  // 서버 시간 보정값 (밀리초) — PC 시계 오차/조작 보호
  const serverOffsetRef = useRef(0);

  // 시험 진입 시 + 5분마다 서버 시간 sync
  useEffect(() => {
    if (!sessionId) return;
    const sync = async () => {
      try {
        const before = Date.now();
        const { data } = await supabase.rpc('get_server_time');
        const after = Date.now();
        if (data) {
          const serverMs = new Date(data as any).getTime();
          const networkDelay = (after - before) / 2;
          serverOffsetRef.current = serverMs - (before + networkDelay);
          console.log('[timer] 서버 시간 sync, offset(ms)=', serverOffsetRef.current);
        }
      } catch (e) {
        console.warn('[timer] 서버 시간 sync 실패', e);
      }
    };
    sync();
    const interval = setInterval(sync, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Fetch session, exam, and questions from DB
  useEffect(() => {
    if (!sessionId) return;
    const fetchData = async (attempt = 1) => {
      try {
        const { data: sess, error: sessErr } = await supabase
          .from('exam_sessions')
          .select('*, exams(*)')
          .eq('id', sessionId)
          .single();

        if (sessErr) {
          console.error(`[ExamPage] session fetch failed (attempt ${attempt})`, sessErr);
          if (attempt < 5) {
            setTimeout(() => fetchData(attempt + 1), 1000 * attempt);
            return;
          }
          toast({
            title: '세션 정보를 불러오지 못했습니다',
            description: '페이지를 새로고침해 주세요.',
            variant: 'destructive',
            duration: 30000,
          });
          return;
        }

        if (sess) {
          const exam = (sess as any).exams;
          
          // Guard: if session is not in_progress, redirect to waiting room
          if (sess.status !== 'in_progress') {
            navigate(`/applicant/waiting-room/${sessionId}`, { replace: true });
            return;
          }

          const durationMinutes = exam?.duration_minutes || 90;

          // 🛡️ Critical: status=in_progress 인데 start_time 이 비어있는 데이터 이상 상황을 즉시 교정.
          if (exam && !exam.use_absolute_end && !sess.start_time) {
            const nowIso = new Date().toISOString();
            const { data: fixed } = await supabase
              .from('exam_sessions')
              .update({ start_time: nowIso })
              .eq('id', sessionId)
              .is('start_time', null)
              .select('*, exams(*)')
              .maybeSingle();
            if (fixed) Object.assign(sess as any, fixed);
            else {
              const { data: re } = await supabase.from('exam_sessions').select('*, exams(*)').eq('id', sessionId).single();
              if (re) Object.assign(sess as any, re);
            }
          }

          // 개인별 종료 시각 계산 (phased 조기 완료 반영)
          const computeEndMs = (): number | null => {
            let naturalEnd: number | null = null;
            if (exam?.use_absolute_end) {
              naturalEnd = new Date(exam.exam_date).getTime() + durationMinutes * 60_000;
            } else if ((sess as any).start_time) {
              naturalEnd = new Date((sess as any).start_time).getTime() + durationMinutes * 60_000;
            } else if (exam) {
              naturalEnd = new Date(exam.exam_date).getTime() + durationMinutes * 60_000;
            }
            if (exam?.phased_enabled && (sess as any).phase1_completed_at) {
              const phase1Min = (exam as any).phase1_minutes ?? 10;
              const phase2Sec = Math.max(0, (durationMinutes - phase1Min) * 60);
              const earlyEnd = new Date((sess as any).phase1_completed_at).getTime() + phase2Sec * 1000;
              return naturalEnd == null ? earlyEnd : Math.min(naturalEnd, earlyEnd);
            }
            return naturalEnd;
          };

          // 종료 시각 차단
          if (exam && !exam.is_test_mode) {
            const hardEnd = computeEndMs();
            if (hardEnd != null && Date.now() >= hardEnd) {
              toast({ title: '시험 시간이 종료되었습니다', variant: 'destructive' });
              await supabase
                .from('exam_sessions')
                .update({ status: 'submitted', submit_time: new Date().toISOString(), submit_reason: 'timeout' } as any)
                .eq('id', sessionId)
                .eq('status', 'in_progress');
              navigate('/applicant', { replace: true });
              return;
            }
          }

          setSession(sess);
          setExamTitle(exam?.title || '');
          setExamCustomTexts((exam as any)?.custom_texts || null);
          setSkipFaceMatch(!!(exam as any)?.skip_face_match);

          const endMs = computeEndMs();
          if (endMs != null) {
            const remaining = Math.floor((endMs - (Date.now() + serverOffsetRef.current)) / 1000);
            setTimeLeft(Math.max(0, remaining));
          } else {
            console.warn('[timer] 시간 정보 부족, null 유지');
            setTimeLeft(null);
          }

          const withRetry = async <T,>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> => {
            let lastErr: any;
            for (let i = 0; i < maxAttempts; i++) {
              try { return await fn(); } catch (e) {
                lastErr = e;
                const wait = 300 * Math.pow(2, i);
                console.warn(`[fetch retry] ${label} attempt ${i + 1} failed, retry in ${wait}ms`, e);
                await new Promise(r => setTimeout(r, wait));
              }
            }
            throw lastErr;
          };

          let eqsRes: any, ansRes: any;
          try {
            [eqsRes, ansRes] = await Promise.all([
              withRetry(async () => {
                const r = await supabase.from('exam_questions').select('question_id, order_num').eq('exam_id', sess.exam_id).order('order_num');
                if (r.error) throw r.error;
                return r;
              }, 'exam_questions'),
              withRetry(async () => {
                const r = await supabase.from('answers').select('question_id, content, slot_values, file_url').eq('session_id', sessionId);
                if (r.error) throw r.error;
                return r;
              }, 'answers'),
            ]);
          } catch (e: any) {
            console.error('[ExamPage] exam_questions/answers fetch failed', e);
            toast({ title: '문제 목록을 불러오지 못했습니다', description: e?.message || '네트워크 오류. 새로고침 해 주세요.', variant: 'destructive' });
            return;
          }

          const eqs = eqsRes?.data;
          const existingAnswers = ansRes?.data;

          if (eqs && eqs.length > 0) {
            let qs: any[] | null = null;
            try {
              const qsRes = await withRetry(async () => {
                const r = await supabase.rpc('get_exam_questions_for_session', { _session_id: sessionId });
                if (r.error) throw r.error;
                return r;
              }, 'questions');
              qs = qsRes.data as any[] | null;
            } catch (e: any) {
              console.error('[ExamPage] questions RPC failed', e);
              toast({ title: '문제 데이터를 불러오지 못했습니다', description: e?.message || '잠시 후 다시 시도해 주세요.', variant: 'destructive' });
              return;
            }
            if (qs) {
              const orderMap = new Map<string, number>(eqs.map((eq: any) => [eq.question_id, eq.order_num as number]));
              qs.sort((a: any, b: any) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
              const sanitized = qs.map((q: any) => ({ ...q, correct_answer: null }));
              setQuestions(sanitized);

              const setIds = Array.from(new Set(qs.map((q: any) => q.set_id).filter(Boolean))) as string[];
              if (setIds.length > 0) {
                const { data: rawSets } = await supabase.from('question_sets').select('*').in('id', setIds);
                if (rawSets) {
                  const map: Record<string, QuestionSet> = {};
                  rawSets.forEach((s: any) => {
                    map[s.id] = {
                      id: s.id,
                      exam_id: s.exam_id ?? null,
                      title: s.title ?? '',
                      scenario: s.scenario ?? '',
                      attachments: Array.isArray(s.attachments) ? s.attachments : [],
                      total_score: s.total_score ?? 0,
                      computed_score: s.total_score ?? 0,
                      order_num: s.order_num ?? 1,
                      category: s.category ?? null,
                      grade: s.grade ?? null,
                      difficulty: s.difficulty ?? 'medium',
                      tags: Array.isArray(s.tags) ? s.tags : [],
                      proctoring_disabled: !!s.proctoring_disabled,
                    };
                  });
                  setSetsById(map);
                }
              }
            }
          }

          if (existingAnswers) {
            const ans: Record<string, string> = {};
            const sv: Record<string, Record<string, string>> = {};
            existingAnswers.forEach((a: any) => {
              ans[a.question_id] = a.content || '';
              if (a.slot_values && typeof a.slot_values === 'object') {
                const m: Record<string, string> = {};
                Object.entries(a.slot_values).forEach(([k, v]) => { m[k] = v == null ? '' : String(v); });
                sv[a.question_id] = m;
              }
            });
            setAnswers(ans);
            setSlotValues(sv);
          }
        }
      } catch (e: any) {
        console.error('[ExamPage] fetchData unexpected error', e);
        toast({ title: '시험 데이터 로딩 중 오류', description: e?.message || '새로고침 해 주세요.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [sessionId]);

  // [1] Timer with server-time drift correction
  // - 매초 1씩 차감 (UI smoothness)
  // - 매 30초 + visibilitychange 시 서버 기준(start_time/absolute_end)으로 재계산
  // - start_time 누락 등 데이터 이상 시: 즉시 0으로 강제하지 않고 최대 3회 재시도(누락 카운트)
  const missingTimeRetryRef = useRef(0);
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // session 의존성을 제거 — ref로 항상 최신 값 참조
  const recomputeTimeLeft = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    const exam = (sess as any).exams;
    if (!exam) return;
    const durationMinutes = exam.duration_minutes || 90;
    let remaining: number | null = null;
    // 서버 시간 기준으로 보정 (PC 시계 조작/오차 무관)
    const correctedNow = Date.now() + serverOffsetRef.current;
    let naturalEnd: number | null = null;
    if (exam.use_absolute_end) {
      const examTime = new Date(exam.exam_date).getTime();
      if (Number.isFinite(examTime)) naturalEnd = examTime + durationMinutes * 60 * 1000;
    } else if (sess.start_time) {
      const startMs = new Date(sess.start_time).getTime();
      if (Number.isFinite(startMs)) naturalEnd = startMs + durationMinutes * 60 * 1000;
    }
    let endMs: number | null = naturalEnd;
    if (exam.phased_enabled && (sess as any).phase1_completed_at) {
      const phase1Min = (exam as any).phase1_minutes ?? 10;
      const phase2Sec = Math.max(0, (durationMinutes - phase1Min) * 60);
      const earlyEnd = new Date((sess as any).phase1_completed_at).getTime() + phase2Sec * 1000;
      endMs = naturalEnd == null ? earlyEnd : Math.min(naturalEnd, earlyEnd);
    }
    if (endMs != null && Number.isFinite(endMs)) {
      remaining = Math.floor((endMs - correctedNow) / 1000);
    }
    if (remaining == null) {
      missingTimeRetryRef.current += 1;
      if (missingTimeRetryRef.current <= 3) {
        console.warn('[timer] start_time/exam_date 누락, 재시도', missingTimeRetryRef.current);
        return;
      }
      remaining = 0;
    } else {
      missingTimeRetryRef.current = 0;
    }
    setTimeLeft(Math.max(0, remaining));
  }, []); // deps 빈 배열 — 함수가 한 번만 만들어지고 ref로 최신 session 참조


  useEffect(() => {
    const tick = setInterval(() => setTimeLeft(t => (t === null ? null : Math.max(0, t - 1))), 1000);
    const resync = setInterval(recomputeTimeLeft, 30000);
    const onVisible = () => {
      if (!document.hidden) recomputeTimeLeft();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', recomputeTimeLeft);
    return () => {
      clearInterval(tick);
      clearInterval(resync);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', recomputeTimeLeft);
    };
  }, [recomputeTimeLeft]);

  useEffect(() => {
    if (timeLeft === 0) handleSubmit('timeout');
  }, [timeLeft]);

  // 최후 방어선: 절대 종료 시각 + 10분 grace 지나면 무조건 강제 제출
  // (UI 타이머가 멈춰도 동작)
  useEffect(() => {
    if (!session) return;
    const exam = (session as any).exams;
    if (!exam || exam.is_test_mode) return;
    const durationMinutes = exam.duration_minutes || 90;
    let endMs: number | null = null;
    if (exam.use_absolute_end) {
      endMs = new Date(exam.exam_date).getTime() + durationMinutes * 60_000;
    } else if (session.start_time) {
      endMs = new Date(session.start_time).getTime() + durationMinutes * 60_000;
    } else {
      return;
    }
    if (exam.phased_enabled && (session as any).phase1_completed_at) {
      const phase1Min = exam.phase1_minutes ?? 10;
      const phase2Sec = Math.max(0, (durationMinutes - phase1Min) * 60);
      const earlyEnd = new Date((session as any).phase1_completed_at).getTime() + phase2Sec * 1000;
      endMs = endMs == null ? earlyEnd : Math.min(endMs, earlyEnd);
    }
    if (endMs == null || !Number.isFinite(endMs)) return;
    const forceEndMs = endMs + 10 * 60_000;
    const correctedNow = Date.now() + serverOffsetRef.current;
    const msUntilForceEnd = forceEndMs - correctedNow;
    if (msUntilForceEnd <= 0) {
      handleSubmit('timeout');
      return;
    }
    const timer = setTimeout(() => {
      console.warn('[timer] 절대 종료 시간 도달 — 강제 제출');
      handleSubmit('timeout');
    }, Math.min(msUntilForceEnd, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [session]);

  // 다단 자동제출 경고 (5분 / 3분 / 1분 / 30초)
  // - 각 임계값에서 1회만 토스트 발생 (ref로 중복 방지)
  // - 새로고침 시에도 timeLeft 가 임계값보다 작으면 이미 표시된 것으로 간주
  const warnedRef = useRef<Record<number, boolean>>({});
  useEffect(() => {
    if (!session) return;
    const thresholds: { sec: number; title: string; desc: string; variant?: 'default' | 'destructive' }[] = [
      { sec: 300, title: '⏰ 5분 남았습니다', desc: '시간이 종료되면 자동으로 제출됩니다. 마무리해 주세요.' },
      { sec: 180, title: '⏰ 3분 남았습니다', desc: '곧 자동 제출됩니다. 답안을 점검해 주세요.', variant: 'destructive' },
      { sec: 60,  title: '⚠️ 1분 남았습니다', desc: '잠시 후 자동 제출됩니다.', variant: 'destructive' },
      { sec: 30,  title: '⚠️ 30초 남았습니다', desc: '곧 자동 제출됩니다.', variant: 'destructive' },
    ];
    for (const t of thresholds) {
      if (timeLeft !== null && timeLeft <= t.sec && timeLeft > 0 && !warnedRef.current[t.sec]) {
        warnedRef.current[t.sec] = true;
        toast({ title: t.title, description: t.desc, variant: t.variant, duration: 8000 });
      }
    }
  }, [timeLeft, session, toast]);

  // [7] Track question view (when current question changes)
  useEffect(() => {
    if (!sessionId || questions.length === 0) return;
    const q = questions[currentQ];
    if (!q) return;
    trackAction('question_view', { questionId: q.id, index: currentQ }, sessionId);
  }, [currentQ, questions, sessionId]);

  // Feature 1: Realtime announcement listener + fetch history
  useEffect(() => {
    if (!session?.exam_id) return;
    // 기존 공지 로드
    (async () => {
      const { data } = await supabase
        .from('exam_announcements' as any)
        .select('id, message, created_at')
        .eq('exam_id', session.exam_id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (data) setAnnouncementHistory(data as any);
    })();
    const channel = supabase
      .channel('exam-announcements')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'exam_announcements',
        filter: `exam_id=eq.${session.exam_id}`,
      }, (payload) => {
        const ann = payload.new as any;
        setAnnouncement(ann.message);
        setAnnouncementHistory(prev => {
          if (prev.some(a => a.id === ann.id)) return prev;
          return [{ id: ann.id, message: ann.message, created_at: ann.created_at }, ...prev].slice(0, 50);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.exam_id]);

  // Feature 7: Navigation lock - prevent back/forward and beforeunload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const handlePopState = (e: PopStateEvent) => {
      // Push state back to prevent navigation
      window.history.pushState(null, '', window.location.href);
    };
    // Push an initial state to trap popstate
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // 캡쳐 방지 / 복사·드래그 잠금 — 메모장에 직접 타이핑 유도
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node || !node.tagName) return false;
      const tag = node.tagName.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (node.isContentEditable) return true;
      return !!node.closest?.('input, textarea, select, [contenteditable="true"], [data-allow-select]');
    };

    const block = (e: Event) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const onCopyLike = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
      try { e.clipboardData?.setData('text/plain', ''); } catch {}
      if (sessionId) trackAction('violation', { kind: 'copy_blocked', type: e.type }, sessionId);
      toast({ title: '복사가 제한되었습니다', description: '문제를 직접 타이핑하여 풀어 주세요.', variant: 'destructive' });
    };

    const clearClipboard = async () => {
      try { await navigator.clipboard?.writeText(''); } catch {}
    };

    const alertCapture = (key: string) => {
      if (sessionId) trackAction('violation', { kind: 'screenshot_attempt', key }, sessionId);
      toast({ title: '화면 캡쳐가 감지되었습니다', description: '응시 중 캡쳐는 부정행위로 기록됩니다.', variant: 'destructive' });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const isDown = e.type === 'keydown';

      // PrintScreen — 클립보드 즉시 비움 (keydown/keyup 모두)
      if (e.key === 'PrintScreen') {
        clearClipboard();
        if (isDown) alertCapture('PrintScreen');
        e.preventDefault();
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey || e.getModifierState('Meta');

      // 차단: Ctrl/⌘ + C/X/A/P/S/U
      if (ctrl && ['c', 'x', 'a', 'p', 's', 'u'].includes(e.key.toLowerCase())) {
        if (isEditable(e.target) && ['a', 'x', 'c'].includes(e.key.toLowerCase())) return; // 입력창 내 편집은 허용
        e.preventDefault();
        if (isDown && sessionId) trackAction('violation', { kind: 'shortcut_blocked', key: e.key }, sessionId);
        return;
      }

      // 차단: Ctrl/⌘+Shift+S/I/C/P 및 스크린샷 단축키 (macOS 3/4/5, Windows S)
      if (ctrl && e.shiftKey && ['s', 'i', 'c', 'p', '3', '4', '5'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        if (isDown) alertCapture(`Ctrl+Shift+${e.key}`);
        return;
      }

      // F12 개발자 도구 (임시 진단 — 종료 후 복구)
      // if (e.key === 'F12') { e.preventDefault(); }
    };

    document.addEventListener('contextmenu', block);
    document.addEventListener('selectstart', block);
    document.addEventListener('dragstart', block);
    document.addEventListener('drop', block);
    document.addEventListener('copy', onCopyLike as EventListener);
    document.addEventListener('cut', onCopyLike as EventListener);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    window.addEventListener('beforeprint', () => {
      if (sessionId) trackAction('violation', { kind: 'print_attempt', source: 'beforeprint' }, sessionId);
      toast({ title: '인쇄가 제한되었습니다', description: '응시 중 인쇄는 부정행위로 기록됩니다.', variant: 'destructive' });
    });

    // 전역 선택 금지 CSS (입력창은 예외)
    const style = document.createElement('style');
    style.setAttribute('data-exam-lock', '1');
    style.textContent = `
      body, body * { -webkit-user-select: none !important; -moz-user-select: none !important; -ms-user-select: none !important; user-select: none !important; }
      input, textarea, select, [contenteditable="true"], [data-allow-select], [data-allow-select] * {
        -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important;
      }
      body { -webkit-touch-callout: none; }
      img, video, canvas { -webkit-user-drag: none; user-drag: none; pointer-events: auto; }
    `;
    document.head.appendChild(style);

    return () => {
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('selectstart', block);
      document.removeEventListener('dragstart', block);
      document.removeEventListener('drop', block);
      document.removeEventListener('copy', onCopyLike as EventListener);
      document.removeEventListener('cut', onCopyLike as EventListener);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
      style.remove();
    };
  }, [sessionId, toast]);



  const saveAnswer = useCallback(async (questionId: string, content: string) => {
    if (!sessionId) return;
    const payload = {
      session_id: sessionId,
      question_id: questionId,
      content,
      submitted_at: new Date().toISOString(),
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { error } = await supabase
          .from('answers')
          .upsert(payload, { onConflict: 'session_id,question_id' });
        if (!error) {
          trackAction('answer_save', { questionId, length: content.length }, sessionId);
          return;
        }
        throw error;
      } catch {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        try {
          const key = `pendingAnswers_${sessionId}`;
          const list = JSON.parse(localStorage.getItem(key) || '[]');
          const idx = list.findIndex((it: any) => it.kind === 'text' && it.question_id === questionId);
          const item = { kind: 'text', ...payload };
          if (idx >= 0) list[idx] = item; else list.push(item);
          localStorage.setItem(key, JSON.stringify(list.slice(-200)));
          toast({
            title: '답안 임시 저장됨',
            description: '서버 연결 불안정으로 답안을 임시 보관 중입니다. 자동으로 재전송됩니다.',
            variant: 'destructive',
          });
        } catch { /* localStorage 가득 차도 무시 */ }
      }
    }
  }, [sessionId, toast]);

  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const clearAllSaveTimeouts = () => {
    Object.values(saveTimeoutRef.current).forEach(t => clearTimeout(t));
    saveTimeoutRef.current = {};
  };
  const handleAnswerChange = (questionId: string, content: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: content }));
    const map = saveTimeoutRef.current;
    if (map[questionId]) clearTimeout(map[questionId]);
    map[questionId] = setTimeout(() => {
      delete map[questionId];
      saveAnswer(questionId, content);
    }, 3000);
  };

  // 슬롯 값 저장 (세트형/슬롯형 문항 전용)
  const saveSlotValues = useCallback(async (questionId: string, sv: Record<string, string>) => {
    if (!sessionId) return;
    const payload = {
      session_id: sessionId,
      question_id: questionId,
      content: '',
      slot_values: sv as any,
      submitted_at: new Date().toISOString(),
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { error } = await supabase
          .from('answers')
          .upsert(payload, { onConflict: 'session_id,question_id' });
        if (!error) {
          trackAction('answer_save', { questionId, slots: Object.keys(sv).length }, sessionId);
          return;
        }
        throw error;
      } catch {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        try {
          const key = `pendingAnswers_${sessionId}`;
          const list = JSON.parse(localStorage.getItem(key) || '[]');
          const idx = list.findIndex((it: any) => it.kind === 'slot' && it.question_id === questionId);
          const item = { kind: 'slot', ...payload };
          if (idx >= 0) list[idx] = item; else list.push(item);
          localStorage.setItem(key, JSON.stringify(list.slice(-200)));
          toast({
            title: '답안 임시 저장됨',
            description: '서버 연결 불안정으로 답안을 임시 보관 중입니다. 자동으로 재전송됩니다.',
            variant: 'destructive',
          });
        } catch { /* silent */ }
      }
    }
  }, [sessionId, toast]);

  // localStorage 백업 답안 flush
  const flushPendingAnswers = useCallback(async () => {
    if (!sessionId) return;
    const key = `pendingAnswers_${sessionId}`;
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { return; }
    if (!Array.isArray(list) || list.length === 0) return;
    const remaining: any[] = [];
    for (const item of list) {
      try {
        const { kind, ...payload } = item;
        const { error } = await supabase
          .from('answers')
          .upsert(payload, { onConflict: 'session_id,question_id' });
        if (error) remaining.push(item);
      } catch {
        remaining.push(item);
      }
    }
    if (remaining.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(remaining));
    }
  }, [sessionId]);

  // 마운트 시 1회 + 30초마다 자동 재전송
  useEffect(() => {
    if (!sessionId) return;
    flushPendingAnswers();
    const interval = setInterval(flushPendingAnswers, 30000);
    return () => clearInterval(interval);
  }, [sessionId, flushPendingAnswers]);

  const slotSaveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const handleSlotChange = (questionId: string, slotId: string, value: string) => {
    setSlotValues(prev => {
      const next = { ...prev, [questionId]: { ...(prev[questionId] || {}), [slotId]: value } };
      const merged = next[questionId];
      clearTimeout(slotSaveTimeoutRef.current[questionId]);
      // 파일 슬롯은 storage 업로드 직후 즉시 저장, 그 외는 debounce 2s
      const isFile = value.startsWith('slots/'); // SlotAnswerPanel 이 업로드 후 storage path 반환
      const delay = isFile ? 0 : 2000;
      slotSaveTimeoutRef.current[questionId] = setTimeout(() => saveSlotValues(questionId, merged), delay);
      return next;
    });
  };

  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleSubmit = useCallback(async (reason: 'manual' | 'timeout' | 'violation' | 'admin_force' = 'manual') => {
    if (!sessionId) return;
    // Guard: prevent duplicate invocations (timer tick + button click race, etc.)
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);

    // Destroy Daily connection FIRST to stop billing immediately
    dailyDestroyRef.current?.();

    // Save all unsaved answers in parallel (was sequential await loop)
    const pending = Object.entries(answers)
      .filter(([, c]) => c.trim().length > 0)
      .map(([qId, content]) => saveAnswer(qId, content));
    // 슬롯 값도 flush
    const slotPending = Object.entries(slotValues)
      .filter(([, sv]) => sv && Object.values(sv).some(v => (v ?? '').toString().trim().length > 0))
      .map(([qId, sv]) => saveSlotValues(qId, sv));
    const all = [...pending, ...slotPending];
    if (all.length > 0) await Promise.all(all);

    // 백업 큐에 남아있는 답안도 마지막으로 한 번 더 flush
    await flushPendingAnswers();

    // Single UPDATE: status + submit_time + submit_reason together, with retry
    let submitted = false;
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data, error } = await supabase
          .from('exam_sessions')
          .update({
            status: 'submitted',
            submit_time: new Date().toISOString(),
            submit_reason: reason,
          } as any)
          .eq('id', sessionId)
          .select('id');
        if (!error && data && data.length > 0) {
          submitted = true;
          break;
        }
        lastError = error || new Error('제출된 세션을 확인할 수 없습니다');
      } catch (e) {
        lastError = e;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
    }

    if (!submitted) {
      console.error('[submit] failed after retries:', lastError);
      toast({
        title: '제출 실패',
        description: '제출에 실패했습니다. 네트워크를 확인한 뒤 다시 제출해주세요.',
        variant: 'destructive',
        duration: 30000,
      });
      submittingRef.current = false;
      setIsSubmitting(false);
      return;
    }

    // [7] Track submit + flush all queued actions immediately
    trackAction('submit', { reason, answeredCount: pending.length }, sessionId);
    await flushActions();

    // [10] Clear state before navigate to prevent residual question display
    setQuestions([]);
    setAnswers({});
    navigate(`/applicant/submitted/${sessionId}`);
  }, [sessionId, answers, slotValues, saveAnswer, saveSlotValues, navigate, flushPendingAnswers, toast]);

  // 화면공유 종료(true→false) 감지 → monitoring_events 기록 + (알림설정 허용 시) 응시자 토스트
  const prevScreenOnRef = useRef(false);
  const handleProctorStatus = useCallback((status: { camOn: boolean; screenOn: boolean; connected: boolean }) => {
    setProctorStatus(status);
    if (status.screenOn) setScreenSharedOnce(true);

    // 화면공유가 켜져 있다가 꺼진 순간(true → false)만 트리거
    // ⚠️ 제출 중이거나 이미 제출 완료된 세션이면 무시 (정상 종료 시 오감지 차단)
    if (prevScreenOnRef.current && !status.screenOn && sessionId
        && !submittingRef.current
        && session?.status !== 'submitted') {
      const allowed: string[] = Array.isArray((session as any)?.exams?.alert_event_types)
        ? (session as any).exams.alert_event_types
        : [];
      if (allowed.includes('screen_share_off')) {
        supabase.from('monitoring_events').insert({
          session_id: sessionId,
          event_type: 'screen_share_off' as any,
        } as any).then();
        // 부정 의심 flag 는 누락 안 되도록 즉시 await + 실패 시 콘솔 에러
        (async () => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            const { error } = await supabase
              .from('exam_sessions')
              .update({ is_flagged: true })
              .eq('id', sessionId);
            if (!error) return;
            if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
            else console.error('[is_flagged update failed]', error);
          }
        })();
        sonnerToast.warning('⚠️ 화면 공유가 중단되었습니다', {
          description: '우측 패널에서 다시 공유해 주세요. 이 행위는 기록됩니다.',
          duration: 8000,
        });
      }
    }
    prevScreenOnRef.current = status.screenOn;
  }, [sessionId, session]);

  const isTimerLoading = timeLeft === null;
  const mins = timeLeft === null ? 0 : Math.floor(timeLeft / 60);
  const secs = timeLeft === null ? 0 : timeLeft % 60;
  const isWarning = timeLeft !== null && timeLeft <= 600;
  const question = questions[currentQ];

  // ─────────────────────────────────────────────────────────
  // 2단계 시험 (Phase 1: 독립 문항 → Phase 2: 세트 문항)
  // 관리자 설정(exams.phased_enabled, exams.phase1_minutes)으로 제어.
  // timeLeft 에서 유도해서 별도 타이머를 만들지 않는다.
  // ─────────────────────────────────────────────────────────
  const exam = (session as any)?.exams;
  const isPhasedExam = exam?.phased_enabled === true;
  const phase2Seconds = Math.max(0, ((exam?.duration_minutes ?? 0) - (exam?.phase1_minutes ?? 10)) * 60);
  const inPhase1 = isPhasedExam && timeLeft !== null && timeLeft > phase2Seconds;
  const phase1Left = inPhase1 && timeLeft !== null ? timeLeft - phase2Seconds : 0;
  const phase1Mins = Math.floor(phase1Left / 60);
  const phase1Secs = phase1Left % 60;
  const isAllowedQ = useCallback(
    (q: any) => !isPhasedExam || (inPhase1 ? !q?.set_id : !!q?.set_id),
    [isPhasedExam, inPhase1]
  );
  const allowedIndices = useMemo(
    () => questions.map((q: any, i: number) => (isAllowedQ(q) ? i : -1)).filter((i) => i >= 0),
    [questions, isAllowedQ]
  );

  // answeredSet: questions/answers/slotValues 가 바뀔 때만 재계산
  const answeredSet = useMemo(() => {
    const isAnswered = (q: any) => {
      if (!q) return false;
      if ((answers[q.id] || '').trim().length > 0) return true;
      const sv = slotValues[q.id];
      if (!sv) return false;
      return Object.values(sv).some(v => (v ?? '').toString().trim().length > 0);
    };
    return new Set(questions.filter(isAnswered).map((q: any) => q.id));
  }, [questions, answers, slotValues]);

  const isRestrictedQuestion = question?.type === 'multiple_choice' || question?.type === 'short_answer' || question?.type === 'essay';
  const allAnswered = questions.length > 0 && answeredSet.size === questions.length;
  const isLastQuestion = currentQ === questions.length - 1;
  // 미작성 문항 번호 목록 (1-based)
  const unansweredIndexes = useMemo(
    () => questions.map((q: any, i: number) => answeredSet.has(q.id) ? -1 : i + 1).filter(n => n > 0),
    [questions, answeredSet]
  );
  // 2단계 시험: 단계별 표시용 번호(1-based). 실제 questions 인덱스 체계는 그대로 유지.
  const phase1DisplayPos = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    questions.forEach((q: any) => { if (!q?.set_id) { n++; m.set(q.id, n); } });
    return m;
  }, [questions]);
  const phase2DisplayPos = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    questions.forEach((q: any) => { if (q?.set_id) { n++; m.set(q.id, n); } });
    return m;
  }, [questions]);
  // 2단계 시험: 미작성 문항을 1단계(독립 문항) / 작업형(세트 문항)으로 분리 — 단계 내 번호 사용
  const phase1UnansweredIndexes = useMemo(
    () => isPhasedExam
      ? questions.filter((q: any) => !answeredSet.has(q.id) && !q?.set_id).map((q: any) => phase1DisplayPos.get(q.id) || 0).filter(n => n > 0)
      : [],
    [questions, answeredSet, isPhasedExam, phase1DisplayPos]
  );
  const workTypeUnansweredIndexes = useMemo(
    () => isPhasedExam
      ? questions.filter((q: any) => !answeredSet.has(q.id) && !!q?.set_id).map((q: any) => phase2DisplayPos.get(q.id) || 0).filter(n => n > 0)
      : [],
    [questions, answeredSet, isPhasedExam, phase2DisplayPos]
  );
  // 제출 버튼 노출 조건: 모두 작성 완료 OR 마지막 허용 문항 도달. 단, 1단계에서는 노출 금지.
  const lastAllowedIndex = allowedIndices.length > 0 ? allowedIndices[allowedIndices.length - 1] : -1;
  const canShowSubmit = !inPhase1 && (allAnswered || currentQ === lastAllowedIndex || isLastQuestion);
  // 다이얼로그 최종 제출 활성화 조건: 모두 완료했거나, 미완료 인지 체크박스에 동의

  // questionSlots / hasSlots: question 바뀔 때만
  const questionSlots: SubmissionSlot[] = useMemo(
    () => Array.isArray(question?.submission_slots) ? question.submission_slots : [],
    [question]
  );
  const hasSlots = questionSlots.length > 0;

  const currentSet: QuestionSet | null = question?.set_id ? (setsById[question.set_id] ?? null) : null;
  const proctoringDisabledForSet = !!currentSet?.proctoring_disabled;

  const alertEventTypes: string[] = useMemo(
    () => Array.isArray((session as any)?.exams?.alert_event_types)
      ? (session as any).exams.alert_event_types
      : [],
    [session]
  );
  const alertAllow = useCallback((key: string) => alertEventTypes.includes(key), [alertEventTypes]);

  // setPosition: currentSet/question 바뀔 때만
  const setPosition = useMemo(() => {
    if (!currentSet || !question) return undefined as { current: number; total: number } | undefined;
    const inSet = questions.filter((q: any) => q.set_id === currentSet.id);
    const idx = inSet.findIndex((q: any) => q.id === question.id);
    return idx >= 0 ? { current: idx + 1, total: inSet.length } : undefined;
  }, [currentSet, question, questions]);

  // mcOptions: question 바뀔 때만 새 배열 생성
  const mcOptions = useMemo(() => {
    if (question?.type !== 'multiple_choice' || !question?.options) return [];
    const opts = Array.isArray(question.options) ? question.options : [];
    return opts.map((opt: any, i: number) => ({
      label: typeof opt === 'string' ? opt : opt.text || opt.label || `옵션 ${i + 1}`,
      value: typeof opt === 'string' ? opt : opt.id?.toString() || opt.value || `${i}`,
    }));
  }, [question]);

  // ─────────────────────────────────────────────────────────
  // 2단계 시험: 전환 감지 & 현재 문항 스냅 (early return 위에 위치)
  // ─────────────────────────────────────────────────────────
  const prevInPhase1Ref = useRef(false);
  useEffect(() => {
    if (!isPhasedExam) { prevInPhase1Ref.current = inPhase1; return; }
    if (prevInPhase1Ref.current && !inPhase1) {
      // 1단계 종료 순간: debounce 대기 중이던 독립 문항 답안을 즉시 저장
      clearAllSaveTimeouts();
      const pending = questions
        .filter((q: any) => !q.set_id)
        .map((q: any) => {
          const content = (answers[q.id] || '').trim();
          return content ? saveAnswer(q.id, content) : null;
        })
        .filter(Boolean);
      Promise.all(pending as Promise<any>[]).catch(() => { /* silent */ });
      toast({
        title: '1단계 종료',
        description: '작업형 문제로 이동합니다. 1단계 답안은 저장되었습니다. 지금부터 AI 도구를 사용할 수 있습니다.',
      });
    }
    prevInPhase1Ref.current = inPhase1;
  }, [inPhase1, isPhasedExam, questions, answers, saveAnswer, toast]);

  // ─────────────────────────────────────────────────────────
  // 2단계 시험 1단계 전체화면 강제 (가림 + 카운트 + 로그. 자동제출/퇴장 없음)
  // ─────────────────────────────────────────────────────────
  const [phase1FsBlocked, setPhase1FsBlocked] = useState(true);
  const [phase1FsViolations, setPhase1FsViolations] = useState(0);
  const fsGraceUntilRef = useRef(0);

  // 1단계 조기 완료
  const [phase1CompleteOpen, setPhase1CompleteOpen] = useState(false);
  const [phase1CompleteConfirm, setPhase1CompleteConfirm] = useState(false);
  const [phase1Completing, setPhase1Completing] = useState(false);
  const handleCompletePhase1 = async () => {
    if (!isPhasedExam || !inPhase1 || !session || !sessionId) return;
    setPhase1Completing(true);
    try {
      // debounce 대기 중인 1단계 답안 즉시 저장
      clearAllSaveTimeouts();
      const pending = questions
        .filter((q: any) => !q.set_id)
        .map((q: any) => {
          const content = (answers[q.id] || '').trim();
          return content ? saveAnswer(q.id, content) : null;
        })
        .filter(Boolean);
      await Promise.allSettled(pending as Promise<any>[]);
      // 서버 보정 시각으로 기록
      const correctedIso = new Date(Date.now() + serverOffsetRef.current).toISOString();
      const { data, error } = await supabase
        .from('exam_sessions')
        .update({ phase1_completed_at: correctedIso } as any)
        .eq('id', sessionId)
        .is('phase1_completed_at', null)
        .select('*, exams(*)')
        .single();
      if (error || !data) throw error || new Error('업데이트 실패');
      sessionRef.current = data as any;
      setSession(data as any);
      setPhase1CompleteOpen(false);
      setPhase1CompleteConfirm(false);
      recomputeTimeLeft();
      toast({
        title: '1단계 완료',
        description: '지금부터 작업형 시간이 시작됩니다. AI 도구를 사용할 수 있습니다.',
      });
    } catch (e: any) {
      console.error('[phase1 complete] failed', e);
      toast({
        title: '완료 처리 실패',
        description: '네트워크를 확인하고 잠시 후 다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setPhase1Completing(false);
    }
  };


  // 1단계 진입/이탈 시 오버레이 리셋
  useEffect(() => {
    if (isPhasedExam && inPhase1) {
      setPhase1FsBlocked(true);
    } else {
      setPhase1FsBlocked(false);
    }
  }, [isPhasedExam, inPhase1]);

  // 1단계 동안 전체화면/탭 이탈 감시
  useEffect(() => {
    if (!isPhasedExam || !inPhase1 || phase1FsBlocked) return;

    const logViolation = (kind: 'fullscreen_exit' | 'tab_hidden') => {
      if (Date.now() < fsGraceUntilRef.current) return;
      setPhase1FsViolations(prev => prev + 1);
      setPhase1FsBlocked(true);
      if (sessionId) {
        trackAction('violation', { kind, phase: 1 }, sessionId);
      }
    };

    const onFsChange = () => {
      if (!document.fullscreenElement) logViolation('fullscreen_exit');
    };
    const onVisibility = () => {
      if (document.hidden) logViolation('tab_hidden');
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isPhasedExam, inPhase1, phase1FsBlocked, sessionId]);

  const enterPhase1Fullscreen = useCallback(async () => {
    if (!exemptions.allow_no_screen_share && !proctorStatus.screenOn) return;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      fsGraceUntilRef.current = Date.now() + 3000;
      setPhase1FsBlocked(false);
    } catch (err) {
      toast({
        title: '전체화면 진입 실패',
        description: '브라우저에서 전체화면을 허용해주세요. 문제가 지속되면 감독관에게 문의하세요.',
        variant: 'destructive',
      });
    }
  }, [proctorStatus.screenOn, exemptions.allow_no_screen_share, toast]);

  // 현재 문항이 허용되지 않은 단계면 첫 허용 인덱스로 스냅
  useEffect(() => {
    if (!isPhasedExam || questions.length === 0) return;
    const cur = questions[currentQ];
    if (!cur) return;
    if (!isAllowedQ(cur)) {
      const first = allowedIndices[0];
      if (typeof first === 'number' && first !== currentQ) setCurrentQ(first);
    }
  }, [isPhasedExam, inPhase1, currentQ, questions, allowedIndices, isAllowedQ]);

  // ⚠️ Hook 호출이 모두 끝난 후에 early return — Rules of Hooks 준수

  if (loading) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">시험 데이터를 불러오는 중...</p></div>;
  }

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <p className="text-muted-foreground text-[14px]">등록된 문제가 없습니다.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/applicant')}>돌아가기</Button>
      </div>
    );
  }

  return (

    <div className="flex flex-col h-[calc(100vh-7.5rem)] -m-6">
      {/* 2단계 시험 1단계 전체화면 강제 오버레이 */}
      {isPhasedExam && inPhase1 && phase1FsBlocked && (
        <div className="fixed inset-0 z-[9999] bg-background/98 backdrop-blur-md flex items-center justify-center p-8">
          <div className="max-w-lg w-full bg-card border rounded-xl shadow-2xl p-8 text-center space-y-5">
            <div className="flex justify-center">
              <div className="p-3 rounded-full bg-primary/10">
                <Monitor className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h2 className="text-[18px] font-bold">
              {phase1FsViolations === 0 ? '1단계 전체화면 모드 필요' : '전체화면을 이탈했습니다'}
            </h2>
            <p className="text-[14px] text-muted-foreground leading-relaxed whitespace-pre-line">
              {phase1FsViolations === 0
                ? '1단계는 전체화면 모드에서만 응시할 수 있습니다.\nAI 도구 사용이 금지된 구간입니다.'
                : '전체화면 또는 탭을 이탈했습니다.\n아래 버튼을 눌러 전체화면으로 복귀해주세요.'}
            </p>
            {phase1FsViolations > 0 && (
              <div className="text-[13px] font-medium text-destructive">
                이탈 횟수: {phase1FsViolations}회 (기록됨)
              </div>
            )}
            {!exemptions.allow_no_screen_share && !proctorStatus.screenOn && (
              <div className="space-y-3">
                <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-line">
                  화면공유 설정이 완료되면 시작할 수 있습니다.{`\n`}화면공유 요청 창에서 '전체 화면'을 선택해 주세요.
                </p>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  onClick={() => window.dispatchEvent(new CustomEvent('proctor:request-screen-share'))}
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  화면 공유 시작
                </Button>
                {proctorError && (
                  <div className="text-left text-[12px] text-destructive bg-destructive/5 border border-destructive/20 rounded-md p-3 whitespace-pre-line leading-relaxed max-h-40 overflow-auto">
                    {proctorError}
                  </div>
                )}
              </div>
            )}
            <Button size="lg" className="w-full" onClick={enterPhase1Fullscreen} disabled={!exemptions.allow_no_screen_share && !proctorStatus.screenOn}>
              {phase1FsViolations === 0 ? '전체화면으로 시작' : '전체화면 복귀'}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              타이머는 계속 진행됩니다.
            </p>

          </div>
        </div>
      )}

      <ExamBlackScreen
        restricted={isRestrictedQuestion && !proctoringDisabledForSet}
        sessionId={sessionId || ''}
        questionIndex={currentQ + 1}
        onViolation={(count) => setViolationCount(count)}
        maxViolations={5}
        isTaskQuestion={question?.type === 'work_based' || question?.type === 'file_upload'}
        enabled={!proctoringDisabledForSet && !isSubmitting && question?.type !== 'work_based' && question?.type !== 'file_upload'}
      />

      {/* AI 감독: 안면 이탈 감지 (세트 옵션으로 비활성 가능, 시험 알림설정 화이트리스트 적용) */}
      <FaceMonitor
        videoEl={webcamVideoEl}
        sessionId={sessionId || ''}
        questionIndex={currentQ + 1}
        enabled={!skipFaceMatch && proctorStatus.camOn && !proctoringDisabledForSet && !isSubmitting && (alertAllow('face_missing') || alertAllow('multiple_faces'))}
        notifyFaceMissing={alertAllow('face_missing')}
        notifyMultipleFaces={alertAllow('multiple_faces')}
      />




      {/* Feature 1: Announcement modal */}
      <Dialog open={!!announcement} onOpenChange={() => setAnnouncement(null)}>
        <DialogContent className="max-w-[420px] border-primary/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary text-[16px]">
              <Megaphone className="h-5 w-5" />
              📢 전체 공지
            </DialogTitle>
          </DialogHeader>
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <p className="text-[14px] font-medium whitespace-pre-wrap leading-relaxed">{announcement}</p>
          </div>
          <Button onClick={() => setAnnouncement(null)} className="w-full">확인</Button>
        </DialogContent>
      </Dialog>

      {/* Connection warning banner */}
      {!proctorStatus.connected && !loading && !proctoringDisabledForSet && (
        <div className="flex items-center gap-2 px-6 py-2 bg-destructive/10 border-b text-[12px] text-destructive font-medium">
          <WifiOff className="h-4 w-4" />
          온라인 감독 기능이 정상 동작 중이지 않습니다. 우측 패널에서 재연결해 주세요.
        </div>
      )}

      {/* 부정행위 감지 비활성 안내 (세트 옵션) */}
      {proctoringDisabledForSet && (
        <div className="flex items-center gap-2 px-6 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-800 font-medium">
          <AlertTriangle className="h-4 w-4" />
          이 문제는 외부 도구(생성형 AI 등) 사용이 허용된 구간으로, 부정행위 감지(전체화면/얼굴/음성)가 일시 비활성화되어 있습니다.
        </div>
      )}

      {/* All answered banner */}
      {allAnswered && (
        <div className="flex items-center justify-between px-6 py-2 bg-success/10 border-b">
          <span className="text-[12px] text-success font-medium">✅ 모든 문제 작성 완료! 최종 제출해 주세요.</span>
          <Button size="sm" variant="destructive" className="h-7 text-[11px] gap-1" onClick={() => { setConfirmUnanswered(false); setSubmitOpen(true); }}>
            <SendHorizontal className="h-3 w-3" /> 최종 제출
          </Button>
        </div>
      )}

      {/* 2단계 시험: 1단계 안내 배너 */}
      {inPhase1 && (
        <div className="flex items-center gap-2 px-6 py-2 bg-blue-50 border-b border-blue-200 text-[12px] text-blue-900 font-medium">
          <AlertTriangle className="h-4 w-4" />
          <span className="flex-1">
            1단계: 객관식·단답형 ({(exam as any)?.phase1_minutes ?? 10}분) — 시간 종료 시 자동으로 작업형으로 전환되며, 이후 1단계 답안은 수정할 수 없습니다.
          </span>
        </div>
      )}

      {/* Top timer bar */}
      <div className={cn("flex items-center justify-between px-6 py-2 border-b shrink-0", isWarning ? "bg-destructive/10" : "bg-card")}>
        <span className="text-[13px] font-medium">{examTitle}</span>
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center gap-2 text-[13px] font-mono font-bold", isWarning && "text-destructive")}>
            <Clock className="h-4 w-4" />
            {isTimerLoading
              ? '준비중...'
              : inPhase1
                ? `1단계 ${String(phase1Mins).padStart(2, '0')}:${String(phase1Secs).padStart(2, '0')}`
                : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
            {isWarning && <AlertTriangle className="h-4 w-4" />}
          </div>
          {/* [1] 절대종료 모드: 고정 종료 시각 명시 표시 (오해 방지) */}
          {(session as any)?.exams?.use_absolute_end && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              종료 시각: {new Date(new Date((session as any).exams.exam_date).getTime() + ((session as any).exams.duration_minutes || 90) * 60000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })} KST (고정)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Connection status icons */}
          <div className="flex items-center gap-1.5">
            {proctorStatus.camOn ? <Video className="h-3.5 w-3.5 text-success" /> : <VideoOff className="h-3.5 w-3.5 text-destructive" />}
            {proctorStatus.screenOn ? <Monitor className="h-3.5 w-3.5 text-success" /> : <MonitorOff className="h-3.5 w-3.5 text-destructive" />}
          </div>
          <RecordingStatusBadge status={recStatus} onRetry={recRetry} />
          {violationCount > 0 && <span className="text-[11px] text-destructive font-medium">부정행위 감지: {violationCount}회</span>}
          <span className="text-[12px] text-muted-foreground">
            {isPhasedExam
              ? `${inPhase1 ? '1단계' : '작업형'} 문항 ${Math.max(1, allowedIndices.indexOf(currentQ) + 1)} / ${allowedIndices.length}`
              : `문제 ${currentQ + 1} / ${questions.length}`}
          </span>

          {/* 공지사항 히스토리 (상시 재확인) */}
          <Popover open={announcementPopoverOpen} onOpenChange={setAnnouncementPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="relative text-[11px] gap-1 h-7 px-2">
                <Bell className="h-3.5 w-3.5" />
                공지
                {announcementHistory.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary text-primary-foreground text-[9px] px-1.5 py-0.5 leading-none">
                    {announcementHistory.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0" align="end">
              <div className="px-3 py-2 border-b flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-primary" />
                <span className="text-[12px] font-semibold">전체 공지 내역</span>
              </div>
              <div className="max-h-[320px] overflow-auto p-2 space-y-1.5">
                {announcementHistory.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-6">등록된 공지가 없습니다.</p>
                ) : announcementHistory.map(a => (
                  <div key={a.id} className="rounded-md border bg-primary/5 border-primary/20 px-3 py-2">
                    <p className="text-[12px] font-medium whitespace-pre-wrap leading-snug">{a.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(a.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                    </p>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {sessionId && currentUserId && (
            <ExamChatPanel sessionId={sessionId} currentUserId={currentUserId} currentRole="applicant" />
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left - question area */}
        <div className="flex-[7] overflow-auto p-6 border-r">
          <div className="max-w-[800px] space-y-4">
            {currentSet && (
              <SetScenarioCard set={currentSet} questionPosition={setPosition} />
            )}
            <ExamPolicyBanner questionType={question.type} customTexts={examCustomTexts} />

            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("text-[11px]", categoryColors[question.category])}>
                {questionTypeLabels[question.type] || question.type}
              </Badge>
              <span className="text-[11px] text-muted-foreground">배점: {question.max_score}점</span>
            </div>

            <div className="bg-card border rounded-lg px-5 py-4">
              <MarkdownView content={question.content} variant="question" className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
            </div>


            {/* 문제 첨부파일 다운로드 */}
            {question.attachments && (question.attachments as any[]).length > 0 && (
              <div className="space-y-1.5 p-3 rounded-md bg-muted/50 border">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-muted-foreground">📎 첨부파일</p>
                  {(question.attachments as any[]).length > 1 && (
                    <button
                      type="button"
                      onClick={() => downloadAttachmentsAsZip(question.attachments as any[], `문제_${currentQ + 1}_첨부.zip`).catch((err) => toast({ title: '다운로드 실패', description: err.message, variant: 'destructive' }))}
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" />ZIP 전체 다운로드
                    </button>
                  )}
                </div>
                {(question.attachments as any[]).map((att: any, idx: number) => {
                  const name = att.name || `첨부파일 ${idx + 1}`;
                  return (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => downloadAttachment(att, idx).catch((err) => toast({ title: '다운로드 실패', description: err.message, variant: 'destructive' }))}
                      className="flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {name}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="space-y-3 pt-5 mt-2 border-t-2 border-primary/30">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold text-foreground">📝 답안 작성</h3>
                <span className="text-[11.5px] text-muted-foreground">아래 항목을 채워 제출하세요</span>
              </div>



              {hasSlots ? (
                <SlotAnswerPanel
                  questionId={question.id}
                  sessionId={sessionId || ''}
                  slots={questionSlots}
                  values={slotValues[question.id] || {}}
                  onChange={(slotId, val) => handleSlotChange(question.id, slotId, val)}
                />
              ) : question.type === 'multiple_choice' && mcOptions.length > 0 ? (
                <McAnswerSelector
                  options={mcOptions}
                  selected={answers[question.id] || ''}
                  onChange={(val) => handleAnswerChange(question.id, val)}
                />
              ) : question.type === 'multiple_choice' && mcOptions.length === 0 ? (
                /* MC question with no structured options — fallback to text input */
                <Textarea
                  value={answers[question.id] || ''}
                  onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                  placeholder="보기 중 정답을 입력하세요 (예: A, B, C, D)"
                  className="min-h-[80px] text-[13px]"
                />
              ) : question.type === 'short_answer' ? (
                <Input
                  value={answers[question.id] || ''}
                  onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                  placeholder="답안을 입력하세요..."
                  className="text-[13px]"
                />
              ) : (
                <>
                  <Textarea
                    value={answers[question.id] || ''}
                    onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                    placeholder="답안을 작성하세요..."
                    className="min-h-[200px] text-[13px]"
                  />
                  <div className="space-y-2">
                    <input
                      type="file"
                      id={`file-upload-${question.id}`}
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.zip,.py,.ipynb"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !sessionId) return;
                        if (file.size > 10 * 1024 * 1024) {
                          toast({ title: '파일 크기 초과', description: '최대 10MB까지 업로드 가능합니다.', variant: 'destructive' });
                          return;
                        }
                        const ext = file.name.split('.').pop();
                        const path = `answers/${sessionId}/${question.id}_${Date.now()}.${ext}`;

                        // [6] 재시도 3회 + 지수백오프 (네트워크 일시 장애 대응)
                        toast({ title: '업로드 중...', description: file.name });
                        let uploadError: any = null;
                        for (let attempt = 1; attempt <= 3; attempt++) {
                          const { error } = await (await import('@/integrations/supabase/anonStorageClient')).anonStorage.storage.from('answer-files').upload(path, file, { upsert: false });
                          if (!error) { uploadError = null; break; }
                          uploadError = error;
                          console.warn(`[upload retry] attempt ${attempt} failed`, error);
                          if (attempt < 3) {
                            toast({ title: `업로드 재시도 (${attempt}/3)`, description: '잠시만 기다려 주세요...' });
                            await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
                          }
                        }
                        if (uploadError) {
                          toast({ title: '파일 업로드 실패', description: `${uploadError.message} (3회 시도 후 실패)`, variant: 'destructive' });
                          return;
                        }
                        await supabase
                          .from('answers')
                          .upsert(
                            { session_id: sessionId, question_id: question.id, content: answers[question.id] || '', file_url: path, submitted_at: new Date().toISOString() },
                            { onConflict: 'session_id,question_id' }
                          );
                        toast({ title: '파일 업로드 완료', description: file.name });
                        setAnswers(prev => ({ ...prev, [`__file_${question.id}`]: file.name }));
                      }}
                    />
                    <Button variant="outline" size="sm" className="text-[12px]" onClick={() => document.getElementById(`file-upload-${question.id}`)?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-1" /> 파일 첨부 (PDF, PNG, XLSX, PY, IPYNB 등, 최대 10MB)
                    </Button>
                    {answers[`__file_${question.id}`] && (
                      <p className="text-[11px] text-muted-foreground">📎 {answers[`__file_${question.id}`]}</p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-between items-center pt-4">
              {(() => {
                const curPos = allowedIndices.indexOf(currentQ);
                const prevIdx = curPos > 0 ? allowedIndices[curPos - 1] : null;
                const nextIdx = curPos >= 0 && curPos < allowedIndices.length - 1 ? allowedIndices[curPos + 1] : null;
                return (
                  <>
                    <Button variant="outline" disabled={prevIdx === null} onClick={() => prevIdx !== null && setCurrentQ(prevIdx)}>
                      <ChevronLeft className="h-4 w-4 mr-1" /> 이전 문제
                    </Button>
                    {canShowSubmit ? (
                      <Button variant="destructive" size="lg" className="gap-2 text-[14px] font-bold px-8" onClick={() => { setConfirmUnanswered(false); setSubmitOpen(true); }}>
                        <SendHorizontal className="h-5 w-5" />
                        ✅ 최종 제출하기
                      </Button>
                    ) : (
                      <Button variant="outline" disabled={nextIdx === null} onClick={() => nextIdx !== null && setCurrentQ(nextIdx)}>
                        다음 문제 <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-[3] flex flex-col p-4 bg-muted/20 min-h-0">
          <div className="flex-1 overflow-y-auto space-y-4 min-h-0 pr-1">
            {session?.exam_id && (
              <DailyProctor
                examId={session.exam_id}
                userName={profileName || '응시자'}
                sessionId={sessionId || ''}
                preferredVideoDeviceId={preferredVideoDeviceId}
                onStatusChange={handleProctorStatus}
                destroyRef={dailyDestroyRef}
                onVideoElement={setWebcamVideoEl}
                onWebcamStream={(s) => { setWebcamStream(s); setWebcamStreamState(s); }}
                onScreenStream={setScreenStream}
                onError={setProctorError}
                allowNoScreenShare={exemptions.allow_no_screen_share}
                allowNoWebcam={exemptions.allow_no_webcam}

              />
            )}

            <Card>
              <CardContent className="p-3">
                <h3 className="mb-3 text-[12px]">
                  {isPhasedExam ? (inPhase1 ? '1단계 문항' : '작업형 문항') : '문제 목록'}
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {questions.map((q: any, i: number) => {
                    const allowed = isAllowedQ(q);
                    if (isPhasedExam && !allowed) return null;
                    const label = isPhasedExam
                      ? (inPhase1 ? phase1DisplayPos.get(q.id) : phase2DisplayPos.get(q.id)) ?? (i + 1)
                      : (i + 1);
                    return (
                      <Button
                        key={q.id}
                        variant={currentQ === i ? 'default' : 'outline'}
                        size="sm"
                        disabled={!allowed}
                        className={cn("h-10 text-[13px] font-medium", answeredSet.has(q.id) && currentQ !== i && allowed && "bg-success/10 border-success/30 text-success")}
                        onClick={() => allowed && setCurrentQ(i)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
                <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary" /> 현재</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-success/30" /> 작성됨</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border" /> 미작성</span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  작성 현황: {answeredSet.size}/{questions.length}문제
                </p>
              </CardContent>
            </Card>
          </div>

          {(inPhase1 || canShowSubmit) && (
            <div className="pt-3 mt-3 border-t bg-muted/20 space-y-2 shrink-0">
              {inPhase1 && (
                <>
                  <Button
                    className="w-full"
                    disabled={phase1FsBlocked || phase1Completing}
                    onClick={() => { setPhase1CompleteConfirm(false); setPhase1CompleteOpen(true); }}
                  >
                    1단계 완료하고 작업형 시작
                  </Button>
                  <p className="text-[11px] text-muted-foreground text-center">
                    완료하면 1단계 답안은 수정할 수 없습니다
                  </p>
                </>
              )}
              {canShowSubmit && (
                <Button
                  variant="destructive"
                  size="lg"
                  className="w-full gap-2 text-[14px] font-bold"
                  onClick={() => { setConfirmUnanswered(false); setSubmitOpen(true); }}
                >
                  <SendHorizontal className="h-5 w-5" />
                  최종 제출
                </Button>
              )}
            </div>
          )}
        </div>

      </div>

      {/* 1단계 조기 완료 확인 다이얼로그 */}
      <Dialog open={phase1CompleteOpen} onOpenChange={(o) => { setPhase1CompleteOpen(o); if (!o) setPhase1CompleteConfirm(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>1단계를 완료하시겠습니까?</DialogTitle>
            <DialogDescription>
              완료하면 1단계 답안은 수정할 수 없으며, 지금부터 작업형 시간({Math.max(0, ((exam as any)?.duration_minutes ?? 0) - ((exam as any)?.phase1_minutes ?? 10))}분)이 시작됩니다. 이 결정은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          {phase1UnansweredIndexes.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="text-[13px] font-semibold">1단계 미작성 {phase1UnansweredIndexes.length}개</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {phase1UnansweredIndexes.map(n => (
                  <span key={n} className="inline-flex items-center rounded-md bg-destructive/10 text-destructive text-[11px] font-medium px-1.5 py-0.5 border border-destructive/20">
                    1단계 {n}번
                  </span>
                ))}
              </div>
              <label className="flex items-start gap-2 pt-1 cursor-pointer">
                <Checkbox
                  checked={phase1CompleteConfirm}
                  onCheckedChange={(v) => setPhase1CompleteConfirm(v === true)}
                  className="mt-0.5"
                />
                <span className="text-[12px] leading-snug">
                  미작성 문항은 0점 처리되며, 1단계 종료 후에는 수정할 수 없음을 확인했습니다.
                </span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhase1CompleteOpen(false)} disabled={phase1Completing}>
              취소
            </Button>
            <Button
              onClick={handleCompletePhase1}
              disabled={phase1Completing || (phase1UnansweredIndexes.length > 0 && !phase1CompleteConfirm)}
            >
              {phase1Completing ? '처리 중...' : '1단계 완료'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={submitOpen} onOpenChange={(o) => { setSubmitOpen(o); if (!o) setConfirmUnanswered(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>답안을 제출하시겠습니까?</DialogTitle>
            <DialogDescription>
              제출 후에는 답안을 수정할 수 없습니다. 작성 현황: {answeredSet.size}/{questions.length}문제 완료
              {violationCount > 0 && ` | 부정행위 감지: ${violationCount}회`}
            </DialogDescription>
          </DialogHeader>

          {isPhasedExam ? (
            <div className="space-y-3">
              {workTypeUnansweredIndexes.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                  <div className="flex items-start gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="text-[13px] font-semibold">
                      작업형 미작성 {workTypeUnansweredIndexes.length}개
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {workTypeUnansweredIndexes.map(n => (
                      <span key={n} className="inline-flex items-center rounded-md bg-destructive/10 text-destructive text-[11px] font-medium px-1.5 py-0.5 border border-destructive/20">
                        작업형 {n}번
                      </span>
                    ))}
                  </div>
                  <label className="flex items-start gap-2 pt-1 cursor-pointer">
                    <Checkbox
                      checked={confirmUnanswered}
                      onCheckedChange={(v) => setConfirmUnanswered(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-[12px] leading-snug">
                      미제출 문항이 있는 상태로 완료하겠습니다. (이후 수정 불가)
                    </span>
                  </label>
                </div>
              )}
            </div>
          ) : (
            unansweredIndexes.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="text-[13px] font-semibold">
                    미작성 문항이 {unansweredIndexes.length}개 있습니다
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {unansweredIndexes.map(n => (
                    <span key={n} className="inline-flex items-center rounded-md bg-destructive/10 text-destructive text-[11px] font-medium px-1.5 py-0.5 border border-destructive/20">
                      {n}번
                    </span>
                  ))}
                </div>
                <label className="flex items-start gap-2 pt-1 cursor-pointer">
                  <Checkbox
                    checked={confirmUnanswered}
                    onCheckedChange={(v) => setConfirmUnanswered(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-[12px] leading-snug">
                    미제출 문항이 있는 상태로 완료하겠습니다. (이후 수정 불가)
                  </span>
                </label>
              </div>
            )
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>취소</Button>
            <Button
              variant="destructive"
              onClick={() => handleSubmit('manual')}
              disabled={isSubmitting || ((isPhasedExam ? workTypeUnansweredIndexes : unansweredIndexes).length > 0 && !confirmUnanswered)}
            >
              {isSubmitting ? '제출 중...' : '제출하기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
