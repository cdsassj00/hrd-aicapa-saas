import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, Send, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ExamChatPanelProps {
  sessionId: string;
  currentUserId: string;
  currentRole: 'applicant' | 'examiner' | 'admin';
  applicantName?: string;
  onOpen?: () => void;
  /** 외부에서 메시지를 관리하는 경우(감독관 대시보드). 지정 시 내부 fetch/subscribe를 건너뛴다. */
  messages?: ChatMessage[];
  /** 외부 관리 모드에서 낙관적 추가를 상위에 알리는 콜백. */
  onMessageSent?: (msg: ChatMessage) => void;
}

interface ChatMessage {
  id: string;
  session_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  created_at: string;
}

const QUICK_WARNINGS = [
  { label: '🚨 부정행위 경고', message: '🚨 [경고] 부정행위가 감지되었습니다. 즉시 중단하지 않으면 시험이 강제 종료됩니다.' },
  { label: '📷 카메라 확인', message: '📷 [안내] 카메라가 꺼져 있거나 얼굴이 보이지 않습니다. 카메라를 확인해주세요.' },
  { label: '🖥️ 화면공유 확인', message: '🖥️ [안내] 화면 공유가 중단되었습니다. 화면 공유를 다시 시작해주세요.' },
  { label: '⚠️ 탭 전환 경고', message: '⚠️ [경고] 허용되지 않은 탭 전환이 감지되었습니다. 반복 시 시험이 자동 제출됩니다.' },
  { label: '📢 주의사항 안내', message: '📢 [안내] 시험 중 외부 자료 참조는 금지되어 있습니다. 유의해주세요.' },
];

export default function ExamChatPanel({
  sessionId,
  currentUserId,
  currentRole,
  applicantName,
  onOpen,
  messages: externalMessages,
  onMessageSent,
}: ExamChatPanelProps) {
  const isExternal = externalMessages !== undefined;
  const [internalMessages, setInternalMessages] = useState<ChatMessage[]>([]);
  const messages = isExternal ? externalMessages! : internalMessages;
  const [input, setInput] = useState('');
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessagesCountRef = useRef(0);

  // open / currentRole 는 ref 로 처리해서 채널 재구독을 막는다
  const openRef = useRef(open);
  const currentRoleRef = useRef(currentRole);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { currentRoleRef.current = currentRole; }, [currentRole]);

  // 외부 관리 모드가 아닐 때만: 자체 fetch + realtime 구독 (응시자 화면 등 단일 세션 사용처)
  useEffect(() => {
    if (isExternal) return;
    if (!sessionId) return;

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('exam_chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (data) setInternalMessages(data as ChatMessage[]);
    };
    fetchMessages();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let firstSubscribe = true;

    const fetchGap = async () => {
      const last = internalMessagesRef.current[internalMessagesRef.current.length - 1]?.created_at;
      let q = supabase.from('exam_chat_messages').select('*').eq('session_id', sessionId);
      if (last) q = q.gt('created_at', last);
      const { data } = await q.order('created_at', { ascending: true });
      if (data && data.length) {
        setInternalMessages(prev => {
          const seen = new Set(prev.map(m => m.id));
          const merged = [...prev];
          for (const m of data as ChatMessage[]) {
            if (!seen.has(m.id)) merged.push(m);
          }
          return merged;
        });
      }
    };

    const connect = () => {
      if (cancelled) return;
      channel = supabase
        .channel(`chat-${sessionId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'exam_chat_messages',
          filter: `session_id=eq.${sessionId}`,
        }, (payload) => {
          const msg = payload.new as ChatMessage;
          setInternalMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          if (msg.sender_id !== currentUserId) {
            if (!openRef.current) setUnread(prev => prev + 1);
            if (currentRoleRef.current === 'applicant' && msg.sender_role !== 'applicant') {
              setAlertMsg(msg);
            }
          }
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            if (!firstSubscribe) fetchGap();
            firstSubscribe = false;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (retryTimer) return;
            retryTimer = setTimeout(() => {
              retryTimer = null;
              if (channel) supabase.removeChannel(channel);
              connect();
            }, 3000);
          }
        });
    };
    connect();

    const onVis = () => { if (document.visibilityState === 'visible') fetchGap(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [sessionId, currentUserId, isExternal]);

  // internalMessages를 ref로 미러링 (gap fetch에서 최신 lastAt 참조)
  const internalMessagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { internalMessagesRef.current = internalMessages; }, [internalMessages]);

  // 외부 관리 모드에서도 감독관 → 응시자 알림 다이얼로그 트리거 (신규 메시지 감지)
  useEffect(() => {
    if (!isExternal) return;
    const prev = prevMessagesCountRef.current;
    prevMessagesCountRef.current = messages.length;
    if (messages.length <= prev) return;
    const newMsgs = messages.slice(prev);
    for (const msg of newMsgs) {
      if (msg.sender_id === currentUserId) continue;
      if (!openRef.current) setUnread(u => u + 1);
      if (currentRoleRef.current === 'applicant' && msg.sender_role !== 'applicant') {
        setAlertMsg(msg);
      }
    }
  }, [messages, isExternal, currentUserId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      onOpen?.();
    }
  }, [open]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || !sessionId) return;
    const { data, error } = await supabase
      .from('exam_chat_messages')
      .insert({
        session_id: sessionId,
        sender_id: currentUserId,
        sender_role: currentRole,
        message: msg,
      } as any)
      .select()
      .single();
    if (error) {
      console.error('[ExamChatPanel] send failed', error);
      return;
    }
    const inserted = data as ChatMessage;
    if (isExternal) {
      onMessageSent?.(inserted);
    } else {
      setInternalMessages(prev => prev.some(m => m.id === inserted.id) ? prev : [...prev, inserted]);
    }
    if (!text) setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isExaminer = currentRole === 'examiner' || currentRole === 'admin';

  return (
    <>
      {/* Prominent alert dialog for applicants when examiner sends a message */}
      {currentRole === 'applicant' && alertMsg && (
        <Dialog open={!!alertMsg} onOpenChange={() => setAlertMsg(null)}>
          <DialogContent className="max-w-[420px] border-destructive/50">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive text-[16px]">
                <AlertTriangle className="h-5 w-5" />
                감독관 메시지
              </DialogTitle>
            </DialogHeader>
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4">
              <p className="text-[14px] font-medium whitespace-pre-wrap leading-relaxed">{alertMsg.message}</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                {new Date(alertMsg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            </div>
            <Button onClick={() => { setAlertMsg(null); setOpen(true); }} className="w-full">
              확인 및 채팅 열기
            </Button>
          </DialogContent>
        </Dialog>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="relative text-[11px] gap-1">
            <MessageCircle className="h-3.5 w-3.5" />
            {currentRole === 'applicant' ? '감독관 채팅' : (applicantName || '채팅')}
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center">
                {unread}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent className={cn(
          "flex flex-col p-0",
          isExaminer ? "w-[420px] sm:w-[480px]" : "w-[340px] sm:w-[380px]"
        )}>
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="text-[14px]">
              {currentRole === 'applicant' ? '감독관 채팅' : `${applicantName || '응시자'} 채팅`}
            </SheetTitle>
          </SheetHeader>

          {/* Quick warning buttons for examiner */}
          {isExaminer && (
            <div className="px-3 py-2 border-b bg-muted/30 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">빠른 경고 전송</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_WARNINGS.map((w) => (
                  <Button
                    key={w.label}
                    variant="outline"
                    size="sm"
                    className="text-[10px] h-7 px-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => sendMessage(w.message)}
                  >
                    {w.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-center text-[11px] text-muted-foreground py-8">메시지가 없습니다</p>
            )}
            {messages.map((msg) => {
              const isMine = msg.sender_id === currentUserId;
              const isWarning = msg.message.startsWith('🚨') || msg.message.startsWith('⚠️');
              const senderIsExaminer = msg.sender_role === 'examiner' || msg.sender_role === 'admin';
              const senderLabel = senderIsExaminer ? '🛡️ 감독관' : '👤 응시자';
              return (
                <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-[12px] border",
                    isMine && "bg-primary text-primary-foreground border-primary",
                    !isMine && isWarning && "bg-destructive/10 border-destructive/40 text-destructive",
                    !isMine && !isWarning && senderIsExaminer && "bg-primary/10 border-primary/40 text-foreground",
                    !isMine && !isWarning && !senderIsExaminer && "bg-muted border-border"
                  )}>
                    <p className={cn(
                      "text-[9px] font-semibold mb-0.5 tracking-wide",
                      isMine ? "text-primary-foreground/80" : senderIsExaminer ? "text-primary" : "text-muted-foreground"
                    )}>
                      {senderLabel}
                    </p>
                    <p className={cn("whitespace-pre-wrap", isWarning && !isMine && "font-semibold")}>{msg.message}</p>
                    <p className={cn("text-[8px] mt-1", isMine ? "text-primary-foreground/60" : "text-muted-foreground")}>
                      {new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요..."
              className="text-[12px] h-9"
            />
            <Button size="sm" className="h-9 px-3" onClick={() => sendMessage()} disabled={!input.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
