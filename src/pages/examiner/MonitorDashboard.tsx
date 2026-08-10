import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, User, Flag, Video, Users, Megaphone, Bell, StopCircle, IdCard, CircleDot, CloudOff } from 'lucide-react';
import { MonitoringEventType } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import DailyMonitorGrid from '@/components/DailyMonitorGrid';
import ExamChatPanel from '@/components/exam/ExamChatPanel';
import { Input } from '@/components/ui/input';
import { Send, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useMonitorPerfMetrics } from '@/hooks/useMonitorPerfMetrics';
import MonitorPerfPanel from '@/components/examiner/MonitorPerfPanel';

const eventTypeLabels: Record<string, string> = {
  face_missing: '얼굴 이탈',
  multiple_faces: '복수 인원',
  tab_switch: '탭 전환',
  window_blur: '창 이탈',
  screen_share_off: '화면공유 해제',
  screen_share_picker: '공유 선택창',
  voice_detected: '음성 감지',
};

const filterOptions = ['전체', '진행중만', '이상징후만'] as const;

interface SessionWithProfile {
  id: string;
  exam_id: string;
  applicant_id: string;
  status: string;
  start_time: string | null;
  is_flagged: boolean;
  profile_name: string;
  profile_org: string;
  id_card_url: string | null;
}

interface ChatMessage {
  id: string;
  session_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  created_at: string;
}

export default function MonitorDashboard() {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState('');
  const [filter, setFilter] = useState<(typeof filterOptions)[number]>('전체');
  const [sessions, setSessions] = useState<SessionWithProfile[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [quickMsg, setQuickMsg] = useState<Record<string, string>>({});
  const [invitationCount, setInvitationCount] = useState(0);

  // Feature 1: Global announcement
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceText, setAnnounceText] = useState('');

  // Feature 2: Unread message badges + last-chat timestamp (신규 채팅 발생 응시자 상단 정렬)
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const [lastChatAt, setLastChatAt] = useState<Record<string, number>>({});
  // 알림 중복 방지: 같은 message.id는 한 번만 처리
  const notifiedMsgIds = useRef<Set<string>>(new Set());

  // [통합] 세션별 채팅 메시지 맵 — 단일 realtime 채널이 여기 쌓고, ExamChatPanel은 props로 받아 렌더링만 함
  const [chatMessagesBySession, setChatMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const chatLoadedSessions = useRef<Set<string>>(new Set());
  const lastChatCreatedAtRef = useRef<string | null>(null);
  const sessionsRef = useRef<SessionWithProfile[]>([]);

  // Feature 5: Batch end exam
  const [batchEndOpen, setBatchEndOpen] = useState(false);

  // Feature 6: ID card zoom modal
  const [idCardZoomUrl, setIdCardZoomUrl] = useState<string | null>(null);

  // 녹화 청크 통계: sessionId → {webcam, screen, lastAt}
  const [recStats, setRecStats] = useState<Record<string, { webcam: number; screen: number; lastAt: string | null }>>({});

  // 성능 지표 추적
  const { metrics: perfMetrics, trackQuery, trackEvent, reset: resetPerf } = useMonitorPerfMetrics();

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const mergeChatMessages = (sessionId: string, newMsgs: ChatMessage[]) => {
    if (!newMsgs.length) return;
    setChatMessagesBySession(prev => {
      const existing = prev[sessionId] || [];
      const seen = new Set(existing.map(m => m.id));
      const combined = [...existing];
      for (const m of newMsgs) {
        if (!seen.has(m.id)) {
          combined.push(m);
          seen.add(m.id);
        }
      }
      combined.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { ...prev, [sessionId]: combined };
    });
    for (const m of newMsgs) {
      if (!lastChatCreatedAtRef.current || m.created_at > lastChatCreatedAtRef.current) {
        lastChatCreatedAtRef.current = m.created_at;
      }
    }
  };

  const loadChatHistory = async (sessionId: string) => {
    if (chatLoadedSessions.current.has(sessionId)) return;
    chatLoadedSessions.current.add(sessionId);
    const { data } = await supabase
      .from('exam_chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (data) mergeChatMessages(sessionId, data as ChatMessage[]);
  };

  const fetchChatGap = async () => {
    const sessionIds = sessionsRef.current.map(s => s.id);
    if (!sessionIds.length) return;
    let q = supabase.from('exam_chat_messages').select('*').in('session_id', sessionIds);
    if (lastChatCreatedAtRef.current) {
      q = q.gt('created_at', lastChatCreatedAtRef.current);
    } else {
      // 초기 gap 없음 (히스토리는 패널 열 때 lazy 로드)
      return;
    }
    const { data } = await q.order('created_at', { ascending: true });
    if (data && data.length) {
      const grouped: Record<string, ChatMessage[]> = {};
      for (const m of data as ChatMessage[]) {
        (grouped[m.session_id] ||= []).push(m);
      }
      for (const [sid, msgs] of Object.entries(grouped)) mergeChatMessages(sid, msgs);
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, []);

  useEffect(() => {
    fetchExams();
  }, []);

  useEffect(() => {
    if (!selectedExam) return;
    fetchSessions();
    // 선택된 시험에서 알림 허용된 이벤트 타입 집합 (저장된 배열, 기본 빈 배열)
    const allowedEvents = new Set<string>(
      (exams.find(e => e.id === selectedExam)?.alert_event_types as string[] | undefined) ?? []
    );

    // 재구독 가능한 채널 팩토리 헬퍼
    type Cleanup = () => void;
    const makeChannel = (
      factory: () => ReturnType<typeof supabase.channel>,
      onReconnect?: () => void,
    ): Cleanup => {
      let ch: ReturnType<typeof supabase.channel> | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;
      let firstSubscribe = true;

      const connect = () => {
        if (cancelled) return;
        ch = factory();
        ch.subscribe((status: string) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            if (!firstSubscribe) onReconnect?.();
            firstSubscribe = false;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (retryTimer) return;
            retryTimer = setTimeout(() => {
              retryTimer = null;
              if (ch) supabase.removeChannel(ch);
              connect();
            }, 3000);
          }
        });
      };
      connect();

      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
        if (ch) supabase.removeChannel(ch);
      };
    };

    // Realtime: monitoring_events INSERT — 화이트리스트에 포함된 타입만 토스트
    const cleanupAlerts = makeChannel(() =>
      supabase
        .channel('monitoring-alerts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'monitoring_events' }, (payload) => {
          const newEvent = payload.new as any;
          trackEvent(newEvent.detected_at || newEvent.created_at || (payload as any).commit_timestamp);
          setSessions(curSessions => {
            const isOurs = curSessions.some(s => s.id === newEvent.session_id);
            if (!isOurs) return curSessions;
            setEvents(prev => [newEvent, ...prev].slice(0, 100));
            if (allowedEvents.has(newEvent.event_type)) {
              const label = eventTypeLabels[newEvent.event_type] || newEvent.event_type;
              const session = curSessions.find(s => s.id === newEvent.session_id);
              toast.error(`🚨 부정행위 감지: ${session?.profile_name || '응시자'}`, {
                description: `${label} 이벤트가 발생했습니다.`,
                duration: 10000,
              });
            }
            return curSessions;
          });
        })
    );

    // [통합] 유일한 채팅 실시간 채널 — 모든 세션 메시지를 맵에 쌓고 응시자 발신만 알림 표시
    const cleanupChat = makeChannel(
      () => supabase
        .channel('chat-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_chat_messages' }, (payload) => {
          const msg = payload.new as ChatMessage;
          const session = sessionsRef.current.find(s => s.id === msg.session_id);
          if (!session) return;

          // 세션별 메시지 맵에 병합 (dedupe by id)
          mergeChatMessages(msg.session_id, [msg]);

          // 알림 및 상단 정렬은 응시자 발신 메시지에 한함
          if (msg.sender_role !== 'applicant') return;
          if (notifiedMsgIds.current.has(msg.id)) return;
          notifiedMsgIds.current.add(msg.id);
          if (notifiedMsgIds.current.size > 500) {
            const arr = Array.from(notifiedMsgIds.current);
            notifiedMsgIds.current = new Set(arr.slice(-300));
          }

          setUnreadSessions(prev => new Set(prev).add(msg.session_id));
          setLastChatAt(prev => ({ ...prev, [msg.session_id]: Date.now() }));

          const lastKey = `lastChatToast_${msg.session_id}`;
          const lastTime = (window as any)[lastKey] || 0;
          if (Date.now() - lastTime > 3000) {
            (window as any)[lastKey] = Date.now();

            toast.info(`💬 ${session.profile_name}님 메시지`, {
              description: msg.message.length > 50 ? msg.message.slice(0, 50) + '...' : msg.message,
              duration: 15000,
              position: 'bottom-left',
              style: {
                background: '#3b82f6',
                color: 'white',
                border: '2px solid #1e40af',
              },
            });

            try {
              const audio = new Audio('https://cdn.jsdelivr.net/gh/web-platform-tests/wpt@master/webaudio/the-audio-api/the-audiobuffersourcenode-interface/notification.wav');
              audio.volume = 0.4;
              audio.play().catch(() => {});
            } catch {}
          }
        }),
      // 재구독 시 놓친 메시지 보정
      () => { fetchChatGap(); },
    );

    // [개선] exam_sessions 변경: INSERT는 신규 응시자만 추가, UPDATE는 해당 row만 머지
    const cleanupSessions = makeChannel(() =>
      supabase
        .channel('session-updates')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_sessions', filter: `exam_id=eq.${selectedExam}` }, async (payload) => {
          const row = payload.new as any;
          trackEvent(row.created_at || (payload as any).commit_timestamp);
          if (!['waiting', 'in_progress', 'submitted'].includes(row.status)) return;
          trackQuery();
          const { data: prof } = await (supabase.from('profiles') as any).select('*').eq('id', row.applicant_id).maybeSingle();
          setSessions(prev => {
            if (prev.some(s => s.id === row.id)) return prev;
            return [...prev, {
              id: row.id,
              exam_id: row.exam_id,
              applicant_id: row.applicant_id,
              status: row.status,
              start_time: row.start_time,
              is_flagged: !!row.is_flagged,
              profile_name: (prof as any)?.name || '알 수 없음',
              profile_org: (prof as any)?.organization || '',
              id_card_url: row.id_card_url || null,
            }];
          });
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'exam_sessions', filter: `exam_id=eq.${selectedExam}` }, (payload) => {
          const row = payload.new as any;
          trackEvent(row.updated_at || (payload as any).commit_timestamp);
          setSessions(prev => prev.map(s => s.id === row.id ? {
            ...s,
            status: row.status,
            start_time: row.start_time,
            is_flagged: !!row.is_flagged,
            id_card_url: row.id_card_url || s.id_card_url,
          } : s));
        })
    );

    // 녹화 청크 업로드 실시간 반영
    const cleanupRec = makeChannel(() =>
      supabase
        .channel('recording-chunks')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'recording_chunks' }, (payload) => {
          const c = payload.new as any;
          setSessions(curSessions => {
            if (!curSessions.some(s => s.id === c.session_id)) return curSessions;
            setRecStats(prev => {
              const cur = prev[c.session_id] || { webcam: 0, screen: 0, lastAt: null };
              return {
                ...prev,
                [c.session_id]: {
                  webcam: cur.webcam + (c.kind === 'webcam' ? 1 : 0),
                  screen: cur.screen + (c.kind === 'screen' ? 1 : 0),
                  lastAt: c.created_at,
                },
              };
            });
            return curSessions;
          });
        })
    );

    // 탭이 다시 활성화될 때 채팅 gap 보정
    const onVis = () => { if (document.visibilityState === 'visible') fetchChatGap(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cleanupAlerts();
      cleanupChat();
      cleanupSessions();
      cleanupRec();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [selectedExam, exams]);

  const fetchExams = async () => {
    trackQuery();
    const { data } = await supabase.from('exams').select('*').order('exam_date', { ascending: false });
    if (data && data.length > 0) {
      setExams(data);
      setSelectedExam((prev) => prev || data[0].id);
    }
  };

  const fetchSessions = async () => {
    trackQuery();
    const { count: invCount } = await supabase
      .from('exam_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('exam_id', selectedExam);
    setInvitationCount(invCount || 0);

    trackQuery();

    const { data: sessData } = await supabase
      .from('exam_sessions')
      .select('*, exams(duration_minutes)')
      .eq('exam_id', selectedExam)
      .in('status', ['waiting', 'in_progress', 'submitted'])
      .order('created_at', { ascending: true });

    if (!sessData) return;

    const now = Date.now();
    const expiredIds: string[] = [];
    const validSessions = sessData.filter((session) => {
      if (session.status === 'in_progress' && session.start_time) {
        const durationMin = (session as any).exams?.duration_minutes || 90;
        const elapsed = (now - new Date(session.start_time).getTime()) / 60000;
        if (elapsed > durationMin + 10) {
          expiredIds.push(session.id);
          return false;
        }
      }
      return true;
    });

    if (expiredIds.length > 0) {
      expiredIds.forEach((id) => {
        supabase.from('exam_sessions').update({ status: 'submitted', submit_time: new Date().toISOString() }).eq('id', id).then();
      });
    }

    const userIds = validSessions.map((session) => session.applicant_id);
    trackQuery();
    const { data: profiles } = await (supabase.from('profiles') as any).select('*').in('id', userIds);
    const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));

    const enriched: SessionWithProfile[] = validSessions.map((session) => ({
      id: session.id,
      exam_id: session.exam_id,
      applicant_id: session.applicant_id,
      status: session.status,
      start_time: session.start_time,
      is_flagged: session.is_flagged,
      profile_name: (profileMap.get(session.applicant_id) as any)?.name || '알 수 없음',
      profile_org: (profileMap.get(session.applicant_id) as any)?.organization || '',
      id_card_url: (session as any).id_card_url || null,
    }));

    setSessions(enriched);

    const sessionIds = sessData.map((session) => session.id);
    if (sessionIds.length === 0) {
      setEvents([]);
      return;
    }

    trackQuery();
    const { data: eventData } = await supabase
      .from('monitoring_events')
      .select('*')
      .in('session_id', sessionIds)
      .order('detected_at', { ascending: false });

    setEvents((eventData || []).slice(0, 100));

    // 녹화 청크 통계 집계
    trackQuery();
    const { data: chunks } = await supabase
      .from('recording_chunks')
      .select('session_id, kind, created_at')
      .in('session_id', sessionIds);
    const next: Record<string, { webcam: number; screen: number; lastAt: string | null }> = {};
    (chunks || []).forEach((c: any) => {
      const s = (next[c.session_id] ||= { webcam: 0, screen: 0, lastAt: null });
      if (c.kind === 'webcam') s.webcam += 1; else if (c.kind === 'screen') s.screen += 1;
      if (!s.lastAt || c.created_at > s.lastAt) s.lastAt = c.created_at;
    });
    setRecStats(next);
  };

  // Feature 1: Send global announcement
  const sendAnnouncement = async () => {
    if (!announceText.trim() || !selectedExam || !currentUserId) return;
    await supabase.from('exam_announcements' as any).insert({
      exam_id: selectedExam,
      sender_id: currentUserId,
      message: announceText.trim(),
    });
    toast.success('전체 공지가 전송되었습니다.');
    setAnnounceText('');
    setAnnounceOpen(false);
  };

  // Feature 5: Batch end all in_progress sessions
  const handleBatchEnd = async () => {
    const activeSess = sessions.filter(s => s.status === 'in_progress');
    if (activeSess.length === 0) return;
    const ids = activeSess.map(s => s.id);
    for (const id of ids) {
      await supabase.from('exam_sessions').update({ status: 'submitted', submit_time: new Date().toISOString() }).eq('id', id);
    }
    toast.success(`${ids.length}명의 시험이 일괄 종료되었습니다.`);
    setBatchEndOpen(false);
    fetchSessions();
  };

  const filteredSessions = (() => {
    let list = sessions;
    if (filter === '이상징후만') list = sessions.filter((s) => s.is_flagged);
    else if (filter === '진행중만') list = sessions.filter((s) => s.status === 'in_progress');
    return list.slice().sort((a, b) => {
      // 1) 미확인 채팅 응시자 최상단 (그중에서도 최신 채팅이 위)
      const ua = unreadSessions.has(a.id) ? 1 : 0;
      const ub = unreadSessions.has(b.id) ? 1 : 0;
      if (ua !== ub) return ub - ua;
      if (ua === 1 && ub === 1) return (lastChatAt[b.id] || 0) - (lastChatAt[a.id] || 0);
      // 2) 상태 순
      const order: Record<string, number> = { in_progress: 0, waiting: 1, submitted: 2 };
      const diff = (order[a.status] ?? 3) - (order[b.status] ?? 3);
      if (diff !== 0) return diff;
      // 3) 플래그 우선
      return a.is_flagged === b.is_flagged ? 0 : a.is_flagged ? -1 : 1;
    });
  })();
  const activeSessions = sessions.filter((session) => session.status === 'in_progress');
  const selectedExamInfo = exams.find((exam) => exam.id === selectedExam);

  const getSessionEvents = (sessionId: string) => events.filter((event) => event.session_id === sessionId);

  // 응시자별 이벤트 종류별 카운트 (의심 응시자 시각화)
  const getSessionEventCounts = (sessionId: string) => {
    const sessionEvents = events.filter((event) => event.session_id === sessionId);
    return {
      face_missing: sessionEvents.filter(e => e.event_type === 'face_missing').length,
      voice_detected: sessionEvents.filter(e => e.event_type === 'voice_detected').length,
      multiple_faces: sessionEvents.filter(e => e.event_type === 'multiple_faces').length,
      screen_share: sessionEvents.filter(e => e.event_type === 'screen_share_stopped' || e.event_type === 'screen_share_picker').length,
      total: sessionEvents.length,
    };
  };

  const getElapsed = (startTime?: string | null) => {
    if (!startTime) return '-';
    const diff = Math.floor((Date.now() - new Date(startTime).getTime()) / 60000);
    return `${diff}분`;
  };

  const handleFlag = async (sessionId: string) => {
    await supabase.from('exam_sessions').update({ is_flagged: true }).eq('id', sessionId);
    fetchSessions();
  };

  const sessionProfileMap = new Map(sessions.map(s => [s.applicant_id, s.profile_name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1>실시간 모니터링</h1>
        <div className="flex items-center gap-2">
          {/* Feature 1: Global announcement button */}
          <Button variant="outline" size="sm" className="text-[12px] gap-1" onClick={() => setAnnounceOpen(true)}>
            <Megaphone className="h-3.5 w-3.5" /> 전체 공지
          </Button>
          {/* Feature 5: Batch end button */}
          <Button variant="destructive" size="sm" className="text-[12px] gap-1" onClick={() => setBatchEndOpen(true)} disabled={activeSessions.length === 0}>
            <StopCircle className="h-3.5 w-3.5" /> 전체 시험 종료
          </Button>
          <Select value={selectedExam} onValueChange={setSelectedExam}>
            <SelectTrigger className="w-[300px] text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {exams.map((exam) => (
                <SelectItem key={exam.id} value={exam.id} className="text-[12px]">
                  {exam.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        {filterOptions.map((item) => (
          <Button key={item} variant={filter === item ? 'default' : 'outline'} size="sm" className="text-[12px]" onClick={() => setFilter(item)}>
            {item}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" />진행중 {activeSessions.length}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground" />대기 {sessions.filter((session) => session.status === 'waiting').length}</span>
          <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" />이상징후 {sessions.filter((session) => session.is_flagged).length}</span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <Video className="h-4 w-4" />
              시험 전체 갤러리 모니터링
            </CardTitle>
            <p className="text-[12px] text-muted-foreground">
              {selectedExamInfo?.title || '선택된 시험'}의 응시자들이 Daily.co 화상 회의에 입장하며, 감독관은 여기서 전체 갤러리로 모니터링합니다.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <DailyMonitorGrid
              examId={selectedExam}
              roomName={selectedExamInfo?.daily_room_name}
              roomUrl={selectedExamInfo?.daily_room_url}
              sessionProfiles={sessionProfileMap}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px]">모니터링 요약</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[12px]">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">선택 시험</span>
              <span className="font-medium">{selectedExamInfo?.title || '-'}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">초대 인원</span>
              <span className="font-medium">{invitationCount}명</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">접속 현황</span>
              <span className="font-medium">
                {sessions.length}/{invitationCount}명
                {invitationCount > 0 && (
                  <span className="text-muted-foreground ml-1">({Math.round((sessions.length / invitationCount) * 100)}%)</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">현재 진행중</span>
              <span className="font-medium">{activeSessions.length}명</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">제출 완료</span>
              <span className="font-medium">{sessions.filter(s => s.status === 'submitted').length}명</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">대기중</span>
              <span className="font-medium">{sessions.filter(s => s.status === 'waiting').length}명</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">이상징후 세션</span>
              <span className="font-medium text-destructive">{sessions.filter(s => s.is_flagged).length}건</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {(() => {
        const activeList = filteredSessions.filter(s => s.status === 'in_progress');
        const inactiveList = filteredSessions.filter(s => s.status !== 'in_progress');

        const sendQuickMsg = async (sessionId: string) => {
          const text = quickMsg[sessionId]?.trim();
          if (!text || !currentUserId) return;
          const { data, error } = await supabase
            .from('exam_chat_messages')
            .insert({
              session_id: sessionId,
              sender_id: currentUserId,
              sender_role: 'examiner',
              message: text,
            } as any)
            .select()
            .single();
          if (error) {
            toast.error('메시지 전송 실패');
            return;
          }
          if (data) mergeChatMessages(sessionId, [data as ChatMessage]);
          setQuickMsg(prev => ({ ...prev, [sessionId]: '' }));
        };

        const renderCard = (session: SessionWithProfile) => {
          const sessionEvents = getSessionEvents(session.id);
          const eventCounts = getSessionEventCounts(session.id);
          const isActive = session.status === 'in_progress';
          const isFlagged = session.is_flagged;
          const hasUnread = unreadSessions.has(session.id);

          return (
            <Card key={session.id} className={cn(
              'transition-all',
              isActive && !isFlagged && 'border-success/60 bg-success/5 ring-1 ring-success/30',
              isFlagged && 'border-destructive/50 bg-destructive/5 ring-1 ring-destructive/30',
              !isActive && !isFlagged && 'opacity-60'
            )}>
              <CardContent className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[12px] font-medium truncate">{session.profile_name}</span>
                    {session.profile_org && <span className="text-[10px] text-muted-foreground truncate">({session.profile_org})</span>}
                    {/* Feature 2: Unread badge */}
                    {hasUnread && (
                      <span className="w-2 h-2 rounded-full bg-destructive shrink-0 animate-pulse" />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Feature 6: ID card indicator */}
                    {session.id_card_url && (
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const { data } = await supabase.storage.from('id-cards').createSignedUrl(session.id_card_url!, 300);
                          if (data?.signedUrl) {
                            setIdCardZoomUrl(data.signedUrl);
                          } else {
                            toast.error('신분증 이미지를 불러올 수 없습니다.');
                          }
                        }}
                      >
                        <IdCard className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <Badge variant={isActive ? 'default' : 'secondary'} className="text-[9px] px-1.5 py-0">
                      {isActive ? '진행중' : session.status === 'submitted' ? '제출' : '대기'}
                    </Badge>
                  </div>
                </div>

                {/* 이벤트 종류별 카운트 뱃지 (의심 응시자 시각화) */}
                {eventCounts.total > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {eventCounts.multiple_faces > 0 && (
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                        👥 {eventCounts.multiple_faces}
                      </Badge>
                    )}
                    {eventCounts.face_missing > 0 && (
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                        👤 {eventCounts.face_missing}
                      </Badge>
                    )}
                    {eventCounts.voice_detected > 0 && (
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                        🔊 {eventCounts.voice_detected}
                      </Badge>
                    )}
                    {eventCounts.screen_share > 0 && (
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                        🖥️ {eventCounts.screen_share}
                      </Badge>
                    )}
                  </div>
                )}

                <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">응시 경과</span>
                    <span className="font-medium">{getElapsed(session.start_time)}</span>
                  </div>
                  {(() => {
                    const rs = recStats[session.id];
                    const cam = rs?.webcam ?? 0;
                    const scr = rs?.screen ?? 0;
                    const lastAgo = rs?.lastAt ? Math.max(0, Math.floor((Date.now() - new Date(rs.lastAt).getTime()) / 1000)) : null;
                    const stale = isActive && (lastAgo === null || lastAgo > 90);
                    return (
                      <div className="flex items-center justify-between text-[11px]" title={rs?.lastAt ? `최근 업로드: ${new Date(rs.lastAt).toLocaleTimeString('ko-KR')}` : '업로드 없음'}>
                        <span className="text-muted-foreground flex items-center gap-1">
                          {stale ? <CloudOff className="h-3 w-3 text-destructive" /> : <CircleDot className={cn('h-3 w-3', isActive ? 'text-success animate-pulse' : 'text-muted-foreground')} />}
                          녹화
                        </span>
                        <span className={cn('font-mono', stale && 'text-destructive')}>
                          캠 {cam} · 화면 {scr}
                          {lastAgo !== null && <span className="text-muted-foreground ml-1">({lastAgo < 60 ? `${lastAgo}초` : `${Math.floor(lastAgo / 60)}분`} 전)</span>}
                        </span>
                      </div>
                    );
                  })()}
                </div>


                {sessionEvents.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {sessionEvents.slice(0, 4).map((event) => (
                      <Badge key={event.id} variant="destructive" className="text-[8px] px-1 py-0">
                        {eventTypeLabels[event.event_type] || event.event_type}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">이상징후 없음</p>
                )}

                {/* Inline quick chat */}
                {isActive && currentUserId && (
                  <div className="flex gap-1">
                    <Input
                      value={quickMsg[session.id] || ''}
                      onChange={e => setQuickMsg(prev => ({ ...prev, [session.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendQuickMsg(session.id); } }}
                      placeholder="메시지 보내기..."
                      className="h-7 text-[10px] flex-1"
                    />
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => sendQuickMsg(session.id)}
                      disabled={!quickMsg[session.id]?.trim()}
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                <div className="flex items-center gap-1">
                  {currentUserId && (
                    <ExamChatPanel
                      sessionId={session.id}
                      currentUserId={currentUserId}
                      currentRole="examiner"
                      applicantName={session.profile_name}
                      messages={chatMessagesBySession[session.id] || []}
                      onMessageSent={(m) => mergeChatMessages(session.id, [m])}
                      onOpen={() => {
                        loadChatHistory(session.id);
                        setUnreadSessions(prev => {
                          const next = new Set(prev);
                          next.delete(session.id);
                          return next;
                        });
                      }}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px] gap-1"
                    onClick={() => handleFlag(session.id)}
                  >
                    <Flag className="h-3 w-3" /> 플래그
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        };

        return (
          <>
            {sessions.length === 0 ? (
              <p className="text-center text-[12px] text-muted-foreground py-12">응시자가 없습니다.</p>
            ) : (
              <div className="space-y-4">
                {activeList.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[13px] font-semibold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-success" />
                      진행중 ({activeList.length}명)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {activeList.map(renderCard)}
                    </div>
                  </div>
                )}
                {activeList.length === 0 && filter !== '진행중만' && (
                  <p className="text-center text-[12px] text-muted-foreground py-4">진행 중인 응시자가 없습니다.</p>
                )}

                {inactiveList.length > 0 && filter !== '진행중만' && (
                  <Collapsible open={inactiveOpen} onOpenChange={setInactiveOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="text-[12px] gap-2 text-muted-foreground hover:text-foreground w-full justify-start">
                        {inactiveOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        대기/제출 ({inactiveList.length}명)
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-2">
                        {inactiveList.map(renderCard)}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </>
        );
      })()}

      {/* Feature 1: Announcement dialog */}
      <Dialog open={announceOpen} onOpenChange={setAnnounceOpen}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[14px]">
              <Megaphone className="h-4 w-4" /> 전체 공지 전송
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={announceText}
            onChange={(e) => setAnnounceText(e.target.value)}
            placeholder="모든 응시자에게 전달할 공지 내용을 입력하세요..."
            className="min-h-[120px] text-[13px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnounceOpen(false)}>취소</Button>
            <Button onClick={sendAnnouncement} disabled={!announceText.trim()}>
              <Megaphone className="h-3.5 w-3.5 mr-1" /> 전체 전송
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feature 5: Batch end dialog */}
      <Dialog open={batchEndOpen} onOpenChange={setBatchEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[14px]">전체 시험 종료</DialogTitle>
          </DialogHeader>
          <p className="text-[13px]">
            현재 진행 중인 <strong>{activeSessions.length}명</strong>의 시험을 모두 강제 종료하시겠습니까?
            응시자의 답안은 현재 상태 그대로 제출 처리됩니다.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchEndOpen(false)}>취소</Button>
            <Button variant="destructive" onClick={handleBatchEnd}>
              <StopCircle className="h-3.5 w-3.5 mr-1" /> 전체 종료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feature 6: ID card zoom modal */}
      <Dialog open={!!idCardZoomUrl} onOpenChange={(open) => { if (!open) setIdCardZoomUrl(null); }}>
        <DialogContent className="max-w-[700px] max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[14px]">
              <IdCard className="h-4 w-4" /> 신분증 확인
            </DialogTitle>
          </DialogHeader>
          {idCardZoomUrl && (
            <div className="flex items-center justify-center overflow-auto">
              <img
                src={idCardZoomUrl}
                alt="신분증"
                className="max-w-full max-h-[70vh] object-contain rounded-md"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '';
                  toast.error('신분증 이미지를 불러올 수 없습니다.');
                  setIdCardZoomUrl(null);
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 성능 지표 패널 (우하단 고정, Ctrl+Shift+P 토글) */}
      <MonitorPerfPanel
        metrics={perfMetrics}
        sessionsCached={sessions.length}
        onReset={resetPerf}
      />
    </div>
  );
}
