// 시험 에이전트 패널 — 응시자가 시험 중 쓰는 AI 작업 공간.
//
// 랜딩에서 약속한 "과정까지 평가"의 응시자 쪽 화면이다. 대화·명령 실행·생성 파일이
// 전부 서버(exam-agent)에 기록되고, 그 기록이 채점 근거가 된다.
//
// 화면 규칙
//   · 플로팅 창. 문제를 보면서 쓰도록 접었다 펼 수 있고 크기를 조절한다.
//   · 기본 크기는 넓고 길게 — 응시자가 코드·출력을 읽어야 한다.
//   · 샌드박스가 죽으면(수명 만료) 다시 시작 버튼을 내보낸다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, ChevronDown, Loader2, Maximize2, Minimize2, Play, RefreshCw, Send, Upload,
} from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; text: string };
type SandboxFile = { path: string; name: string; bytes: number; isDir: boolean };

interface Props {
  sessionId: string;
  questionId: string;
  /** 문항이 바뀌면 작업 공간도 바뀐다 */
  questionLabel?: string;
}

const GREETING: Msg = {
  role: 'assistant',
  text:
    '작업 공간이 열렸습니다. 과제를 어떻게 풀지 말씀해 주시면 제가 샌드박스에서 직접 실행해 드립니다.\n' +
    '예) "data.csv 열 구조부터 확인해 줘" · "시간대별 오류율을 계산하는 파이썬 코드를 만들어 돌려 줘"\n\n' +
    '만든 파일은 아래 목록에 나타나고, [제출]을 누르면 답안으로 올라갑니다.',
};

export default function ExamAgentPanel({ sessionId, questionId, questionLabel }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [expired, setExpired] = useState(false);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [turnsLeft, setTurnsLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const [dims, setDims] = useState(() => ({
    w: 520,
    h: typeof window !== 'undefined' ? Math.min(760, window.innerHeight - 96) : 640,
  }));
  const [maximized, setMaximized] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // 문항이 바뀌면 이 문항의 작업 공간으로 갈아탄다.
  useEffect(() => {
    setAgentId(null);
    setMsgs([]);
    setFiles([]);
    setTurnsLeft(null);
    setExpired(false);
  }, [questionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('exam-agent', {
        body: { session_id: sessionId, question_id: questionId, ...body },
      });
      if (error) {
        // 엣지 함수가 본문에 담아 보낸 사유를 살린다 — "Edge Function returned a
        // non-2xx status code" 만 보여 주면 응시자가 할 수 있는 조치가 없다.
        let detail = '';
        try {
          const res = (error as { context?: Response }).context;
          if (res) {
            const parsed = await res.clone().json().catch(() => null);
            detail = parsed?.error ?? '';
            if (parsed?.expired) setExpired(true);
          }
        } catch { /* 본문이 없으면 메시지만 쓴다 */ }
        throw new Error(detail || error.message);
      }
      if (data?.expired) setExpired(true);
      if (data?.error) throw new Error(data.error);
      return data as Record<string, unknown>;
    },
    [sessionId, questionId],
  );

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const data = await call({ action: 'start' });
      setAgentId(String(data.agent_id));
      setExpired(false);
      setMsgs((m) => (m.length ? m : [GREETING]));
      const f = await call({ action: 'files' }).catch(() => null);
      if (f?.files) setFiles(f.files as SandboxFile[]);
    } catch (e) {
      toast({
        title: '작업 공간을 열지 못했습니다',
        description: e instanceof Error ? e.message : '잠시 후 다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setStarting(false);
    }
  }, [call, toast]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !agentId) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const data = await call({ action: 'chat', message: text });
      setMsgs((m) => [...m, { role: 'assistant', text: String(data.reply ?? '') }]);
      if (Array.isArray(data.files)) setFiles(data.files as SandboxFile[]);
      if (typeof data.turns_left === 'number') setTurnsLeft(data.turns_left);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '요청이 실패했습니다.';
      setMsgs((m) => [...m, { role: 'assistant', text: `[오류] ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }, [agentId, busy, call, input]);

  const submitFile = useCallback(
    async (path: string) => {
      setSubmitting(path);
      try {
        await call({ action: 'submit', path });
        toast({ title: '제출됨', description: `${path} 를 답안 파일로 올렸습니다.` });
      } catch (e) {
        toast({
          title: '제출 실패',
          description: e instanceof Error ? e.message : '다시 시도해 주세요.',
          variant: 'destructive',
        });
      } finally {
        setSubmitting(null);
      }
    },
    [call, toast],
  );

  // 드래그로 크기 조절. 창 밖으로 나가지 않도록 상한을 둔다.
  const onResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const sw = dims.w;
    const sh = dims.h;
    const move = (ev: PointerEvent) => {
      setDims({
        w: Math.max(360, Math.min(window.innerWidth - 40, sw + (sx - ev.clientX))),
        h: Math.max(320, Math.min(window.innerHeight - 40, sh + (sy - ev.clientY))),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!agentId) void start();
        }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[#0f1117] px-5 py-3 text-[13px] font-semibold text-white shadow-xl ring-1 ring-white/10 hover:bg-[#191c25]"
      >
        <Bot className="h-4 w-4 text-indigo-300" />
        AI 작업 공간 열기
      </button>
    );
  }

  const w = maximized ? Math.min(1100, window.innerWidth - 32) : dims.w;
  const h = maximized ? window.innerHeight - 32 : dims.h;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col overflow-hidden rounded-2xl bg-[#0f1117] text-slate-100 shadow-2xl ring-1 ring-white/10"
      style={{ width: w, height: h }}
    >
      {/* 크기 조절 손잡이 (좌상단) */}
      {!maximized && (
        <div
          onPointerDown={onResize}
          className="absolute left-0 top-0 z-10 h-5 w-5 cursor-nwse-resize"
          title="크기 조절"
        />
      )}

      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#15171f] px-4 py-2.5">
        <Bot className="h-4 w-4 text-indigo-300" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">AI 작업 공간</div>
          <div className="truncate text-[11px] text-slate-400">
            {questionLabel ? `${questionLabel} · ` : ''}
            {expired ? '샌드박스 만료' : agentId ? '샌드박스 연결됨' : '준비 중'}
            {turnsLeft !== null ? ` · 남은 대화 ${turnsLeft}회` : ''}
          </div>
        </div>
        <button type="button" onClick={() => setMaximized((v) => !v)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          <ChevronDown className="h-4 w-4" />
        </button>
      </header>

      <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!agentId && !starting && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-[13px] text-slate-300">
            이 문항은 샌드박스에서 직접 작업합니다. 아래 버튼으로 작업 공간을 엽니다.
            <Button onClick={() => void start()} className="mt-3 w-full gap-2" size="sm">
              <Play className="h-4 w-4" /> 작업 공간 열기
            </Button>
          </div>
        )}
        {starting && (
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 샌드박스를 준비하고 있습니다…
          </div>
        )}
        {expired && agentId && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[12.5px] text-amber-200">
            샌드박스 수명이 끝났습니다. 대화 기록은 남아 있고 작업 폴더는 비워집니다.
            <Button onClick={() => void start()} size="sm" variant="secondary" className="mt-2 w-full gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> 다시 열기
            </Button>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex gap-2'}>
            {m.role === 'assistant' && (
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20">
                <Bot className="h-3.5 w-3.5 text-indigo-300" />
              </div>
            )}
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2.5 text-[13px] leading-relaxed'
                  : 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white/[0.07] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-200'
              }
            >
              {m.text}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[12.5px] text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 샌드박스에서 작업 중…
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="shrink-0 border-t border-white/10 bg-[#12141b] px-4 py-2.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            생성 파일
          </div>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {files.filter((f) => !f.isDir).map((f) => (
              <div key={f.path} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-slate-300">{f.name}</span>
                <span className="shrink-0 text-slate-500">{f.bytes}B</span>
                <button
                  type="button"
                  onClick={() => void submitFile(f.path)}
                  disabled={submitting === f.path}
                  className="flex shrink-0 items-center gap-1 rounded bg-emerald-600/80 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {submitting === f.path
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Upload className="h-3 w-3" />}
                  제출
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-white/10 bg-[#15171f] p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={agentId ? '무엇을 하면 될지 적어 주세요 (Shift+Enter 줄바꿈)' : '작업 공간을 먼저 열어 주세요'}
            disabled={!agentId || busy}
            rows={2}
            className="min-h-[52px] resize-none border-white/10 bg-white/5 text-[13px] text-slate-100 placeholder:text-slate-500"
          />
          <Button onClick={() => void send()} disabled={!agentId || busy || !input.trim()} size="icon" className="h-[52px] w-11 shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
          대화와 실행 과정은 모두 기록되어 채점에 함께 반영됩니다.
        </p>
      </div>
    </div>
  );
}
