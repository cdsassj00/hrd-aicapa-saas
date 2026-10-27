import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles, FileText, Lock, Paperclip, Download, Upload, Terminal, Clock,
  CheckCircle2, Circle, FileSpreadsheet, MessageSquare, ArrowUp, X, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { DemoSwitch } from '@/components/demo/DemoSwitch';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

/**
 * 공개 응시자 화면 미리보기 (/demo)
 * 로그인·승인 없이 "응시자가 보는 시험 화면"을 그대로 체험. 채점·저장 없음.
 *
 * 레이아웃 (Mobbin 레퍼런스: Gemini Notebook 3단 · Turo 진행 목록/하단 진행률 · Sana 라이트 채팅)
 *   왼쪽  : 진행 단계 목록 + 체크 (접기 가능)
 *   가운데: 과제 → 작업 과정 → 생성 파일 → 제출
 *   오른쪽: AI 어시스턴트 — 고정 칸(폭 드래그 조절). 좁은 화면에선 아래에서 올라오는 시트.
 *   하단  : 진행률 바 + 제출
 */

const MAX_TURNS = 3;

type Msg = { role: 'user' | 'assistant'; content: string };

// 첫 인사 — 방문자가 바로 무엇을 시켜볼지 알 수 있게 과제를 짚어 준다.
const GREETING: Msg = {
  role: 'assistant',
  content:
    '안녕하세요. 가운데 과제(orders_2026Q2.csv · 320행)를 함께 풀어 볼게요.\n' +
    '아래 예시를 누르거나 직접 지시해 보세요. 체험은 3턴까지 가능합니다.',
};

// 첫 입력을 돕는 예시 지시 — 빈 입력창 앞에서 멈추는 방문자가 많다.
const SUGGESTIONS = [
  '완료 주문만 카테고리별 매출과 평균 배송일 구해줘',
  '데이터에 어떤 정제가 필요한지 먼저 알려줘',
  '재구매 고객 비율은 어떤 기준으로 계산하면 좋을까?',
];

const STEPS = [
  'orders_2026Q2.csv 로드 (320행)',
  'amount 통화기호 제거 · 숫자 변환, status 결측 4건 제외',
  "status == '완료' 필터 → 271건",
  'category별 매출·평균 ship_days groupby 집계',
  'customer_id 기준 재구매(2회+) 비율 산출 = 34.7%',
  'summary.md · category_stats.csv 파일 생성',
];

const FILES = [
  { name: 'category_stats.csv', size: '2.1 KB', icon: FileSpreadsheet },
  { name: 'summary.md', size: '1.4 KB', icon: FileText },
];

const CHAT_MIN = 320;
const CHAT_MAX = 640;

export default function DemoExamPage() {
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const allDownloaded = FILES.every((f) => downloaded[f.name]);
  const [navOpen, setNavOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false); // 좁은 화면 전용 채팅 시트

  // 오른쪽 채팅 칸 폭 — 왼쪽 가장자리 드래그로 조절
  const [chatW, setChatW] = useState(400);
  const dragRef = useRef<{ sx: number; sw: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sw: chatW };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const w = dragRef.current.sw + (dragRef.current.sx - ev.clientX);
      setChatW(Math.min(Math.max(w, CHAT_MIN), CHAT_MAX));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 실제 3턴 대화 — 공개 엔드포인트(demo-chat)가 서버에서도 턴/IP 상한을 강제한다.
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState('');
  const turnsUsed = msgs.filter((m) => m.role === 'user').length;
  const turnsLeft = Math.max(0, MAX_TURNS - turnsUsed);

  const sendMsg = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || sending || turnsLeft === 0) return;
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next);
    setInput('');
    setChatErr('');
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('demo-chat', {
        // 첫 인사는 서버 턴 계산에서 빼고 보낸다
        body: { messages: next.slice(1).map((m) => ({ role: m.role, content: m.content })) },
      });
      const res = (data ?? {}) as { reply?: string; error?: string };
      if (error || res.error || !res.reply) {
        setChatErr(res.error || '지금은 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setMsgs((cur) => [...cur, { role: 'assistant', content: res.reply as string }]);
    } catch {
      setChatErr('네트워크 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  };

  // 진행 단계 — 실제 응시의 "문항 목록 + 완료 체크" 자리. 체험에선 과업 단계로 보여준다.
  const progress = [
    { label: '과제 확인', done: true },
    { label: 'AI에게 분석 지시', done: turnsUsed > 0 },
    { label: '생성 파일 받기', done: allDownloaded },
    { label: '결과 제출', done: false },
  ];
  const doneCount = progress.filter((p) => p.done).length;
  const pct = Math.round((doneCount / progress.length) * 100);

  const chat = (
    <ChatPanel
      msgs={msgs}
      sending={sending}
      chatErr={chatErr}
      input={input}
      setInput={setInput}
      onSend={sendMsg}
      turnsUsed={turnsUsed}
      turnsLeft={turnsLeft}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-foreground">
      {/* 상단 바 */}
      <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-white px-4">
        <Badge variant="secondary" className="gap-1 text-[11px]">
          <Sparkles className="h-3 w-3" /> 응시자 화면 미리보기
        </Badge>
        <div className="hidden md:block"><DemoSwitch current="applicant" /></div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[12.5px] font-medium tabular-nums text-slate-700 sm:flex">
            <Clock className="h-3.5 w-3.5 text-slate-500" /> 남은 시간 52:10
          </span>
          <a href="https://ai-hrd.com/#contact">
            <Button variant="outline" size="sm" className="text-[13px] font-medium">도입 문의</Button>
          </a>
          <Link to="/login?tab=signup">
            <Button size="sm" className="text-[13px] font-medium">회원가입</Button>
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 왼쪽 — 진행 단계 */}
        <aside
          className={cn(
            'hidden shrink-0 flex-col border-r bg-white transition-[width] duration-200 md:flex',
            navOpen ? 'w-60' : 'w-12',
          )}
        >
          <div className="flex h-12 items-center justify-between px-3">
            {navOpen && <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">진행 단계</span>}
            <button
              onClick={() => setNavOpen((v) => !v)}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={navOpen ? '진행 단계 접기' : '진행 단계 펼치기'}
            >
              {navOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
          </div>
          {navOpen && (
            <nav className="flex-1 space-y-0.5 px-2">
              <div className="px-2 pb-2 text-[13px] font-medium text-slate-800">문항 1 · 데이터 분석</div>
              {progress.map((p, i) => {
                const current = !p.done && progress.slice(0, i).every((x) => x.done);
                return (
                  <div
                    key={p.label}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px]',
                      current ? 'bg-indigo-50 font-medium text-indigo-700' : p.done ? 'text-slate-700' : 'text-slate-400',
                    )}
                  >
                    {p.done
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      : <Circle className={cn('h-4 w-4 shrink-0', current ? 'text-indigo-500' : 'text-slate-300')} />}
                    {p.label}
                  </div>
                );
              })}
            </nav>
          )}
        </aside>

        {/* 가운데 — 과제 · 작업 과정 · 생성 파일 · 제출 */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-6">
            <div className="mb-4 md:hidden"><DemoSwitch current="applicant" /></div>
            <div className="mb-4">
              <div className="text-[12px] font-medium text-indigo-600">문항 1 / 1</div>
              <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-slate-900">AI 활용 역량평가 — 체험 문항</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                오른쪽 <b className="text-slate-700">AI 어시스턴트</b>로 파일을 분석시키고, 결과 파일을 받아 아래에 제출합니다. (예시: 민간 · 데이터 분석)
              </p>
            </div>

            {/* 과제 */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <FileText className="h-4 w-4 text-indigo-500" />
                <span className="text-[13.5px] font-semibold text-slate-900">과제</span>
                <span className="ml-auto flex gap-1">
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-medium text-indigo-700">민간</span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-medium text-indigo-700">데이터 분석</span>
                </span>
              </div>
              <div className="p-5">
                <p className="text-[13.5px] leading-relaxed text-slate-700">
                  당신은 이커머스 회사의 담당자입니다. 첨부된 <b className="text-slate-900">2분기 주문 데이터(320행)</b>는 통화기호·결측이 섞여
                  있어 그대로는 계산할 수 없습니다. AI에게 데이터를 <b className="text-slate-900">정제·집계</b>시켜 아래 3가지를 산출하고,
                  <b className="text-slate-900"> 집계표(.csv)와 요약 리포트(.md)</b>를 만들어 제출하세요.
                  <span className="mt-1 block text-[12.5px] text-slate-500">
                    (파이썬을 몰라도 됩니다. AI에게 무엇을·왜 시키는지가 평가 대상입니다.)
                  </span>
                </p>

                <ol className="mt-4 space-y-2">
                  {[
                    '‘완료’ 주문만 대상으로 카테고리별 매출 합계 · 평균 배송일',
                    '매출 1위 카테고리와 가장 빠른 배송 카테고리',
                    '재구매(2회 이상) 고객 비율 — 산출 기준을 리포트에 명시',
                  ].map((t, i) => (
                    <li key={i} className="flex gap-2.5 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">{i + 1}</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px]">
                    <Paperclip className="h-3.5 w-3.5 text-indigo-500" />
                    <span className="font-medium text-slate-800">orders_2026Q2.csv</span>
                    <span className="text-slate-400">· 320행 · 24 KB</span>
                  </div>
                  <span className="text-[12px] text-slate-400">첨부파일 — AI 어시스턴트가 열어 분석합니다</span>
                </div>
              </div>
            </section>

            {/* 작업 과정 */}
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <Terminal className="h-4 w-4 text-emerald-600" />
                <span className="text-[13px] font-semibold text-slate-900">AI 작업 과정</span>
                <span className="text-[11.5px] text-slate-400">· 안전 샌드박스 실행 로그</span>
              </div>
              <div className="space-y-1.5 p-5">
                {STEPS.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12.5px]">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="text-slate-600"><span className="mr-1.5 font-mono text-[11px] text-slate-400">#{i + 1}</span>{s}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 생성 파일 → 다운로드 */}
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <Download className="h-4 w-4 text-sky-600" />
                <span className="text-[13px] font-semibold text-slate-900">AI가 생성한 파일</span>
              </div>
              <div className="grid gap-2 p-5 sm:grid-cols-2">
                {FILES.map((f) => {
                  const Ico = f.icon;
                  const done = downloaded[f.name];
                  return (
                    <button
                      key={f.name}
                      onClick={() => setDownloaded((d) => ({ ...d, [f.name]: true }))}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-sky-300 hover:bg-sky-50/60"
                    >
                      <Ico className="h-5 w-5 shrink-0 text-sky-600" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-slate-800">{f.name}</div>
                        <div className="text-[11.5px] text-slate-400">{f.size}</div>
                      </div>
                      {done ? (
                        <span className="flex items-center gap-1 text-[11.5px] font-medium text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> 받음
                        </span>
                      ) : (
                        <Download className="h-4 w-4 text-slate-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 제출 */}
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <Upload className="h-4 w-4 text-amber-600" />
                <span className="text-[13px] font-semibold text-slate-900">제출</span>
              </div>
              <div className="p-5">
                <div className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition',
                  allDownloaded ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-slate-50',
                )}>
                  <Upload className={cn('h-6 w-6', allDownloaded ? 'text-amber-600' : 'text-slate-400')} />
                  <div className="text-[13px] font-medium text-slate-800">
                    {allDownloaded ? 'AI가 만든 파일을 여기에 올려 제출합니다' : '먼저 위에서 생성 파일을 받으세요'}
                  </div>
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                    <Lock className="h-3.5 w-3.5" /> 체험 미리보기 — 실제 제출·채점은 승인된 응시에서 진행됩니다
                  </div>
                </div>
              </div>
            </section>

            {/* 하단 CTA */}
            <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-6 text-center">
              <div className="text-[15px] font-semibold text-slate-900">
                이 화면으로 지원자의 <span className="text-indigo-600">AI 활용 역량</span>을 평가합니다
              </div>
              <p className="max-w-xl text-[13px] text-slate-500">
                정답만이 아니라 <b className="text-slate-800">AI에게 던진 지시와 대화 흐름, 작업 과정</b>까지 함께 봅니다.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/login?tab=signup"><Button className="text-[13px] font-medium">회원가입</Button></Link>
                <a href="https://ai-hrd.com/#contact"><Button variant="secondary" className="text-[13px] font-medium">도입 문의</Button></a>
                <Link to="/login"><Button variant="outline" className="text-[13px] font-medium">로그인</Button></Link>
              </div>
            </div>
          </div>
        </main>

        {/* 오른쪽 — AI 어시스턴트 고정 칸 (lg 이상) */}
        <aside
          style={{ width: chatW }}
          className="relative hidden shrink-0 border-l border-slate-200 bg-white lg:flex lg:flex-col"
        >
          <div
            onPointerDown={onResizeDown}
            title="드래그해서 폭 조절"
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-indigo-200/60"
          />
          {chat}
        </aside>
      </div>

      {/* 하단 — 진행률 + 제출 (Turo) */}
      <footer className="flex h-14 shrink-0 items-center gap-4 border-t bg-white px-4">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">진행</span>
        <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[12px] tabular-nums text-slate-500">{doneCount}/{progress.length}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSheetOpen(true)}
          className="ml-auto gap-1.5 text-[13px] lg:hidden"
        >
          <MessageSquare className="h-4 w-4" /> AI 어시스턴트
        </Button>
        <Button size="sm" disabled className="text-[13px] lg:ml-auto">최종 제출</Button>
      </footer>

      {/* 좁은 화면 — 채팅 시트 */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-slate-900/30 lg:hidden" onClick={() => setSheetOpen(false)}>
          <div
            className="flex h-[78vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <button
                onClick={() => setSheetOpen(false)}
                className="absolute right-3 top-2.5 z-10 rounded-md p-1 text-slate-400 hover:bg-slate-100"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {chat}
          </div>
        </div>
      )}
    </div>
  );
}

/** AI 어시스턴트 — 고정 칸과 모바일 시트가 같이 쓴다. 라이트 채팅(Sana·Base44 참고):
 *  AI 답은 말풍선 없이 본문처럼, 응시자 메시지만 연회색 말풍선. */
function ChatPanel(props: {
  msgs: Msg[];
  sending: boolean;
  chatErr: string;
  input: string;
  setInput: (v: string) => void;
  onSend: (preset?: string) => void;
  turnsUsed: number;
  turnsLeft: number;
}) {
  const { msgs, sending, chatErr, input, setInput, onSend, turnsUsed, turnsLeft } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, sending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-100 px-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </span>
        <span className="text-[13px] font-semibold text-slate-900">AI 어시스턴트</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 ring-1 ring-emerald-600/15">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 샌드박스 연결됨
        </span>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500">
                <Sparkles className="h-3 w-3 text-white" />
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{m.content}</div>
            </div>
          ),
        )}
        {sending && (
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500">
              <Sparkles className="h-3 w-3 text-white" />
            </span>
            <span className="flex items-center gap-1 pt-2">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: '120ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: '240ms' }} />
            </span>
          </div>
        )}
        {chatErr && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{chatErr}</div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3">
        {turnsLeft > 0 ? (
          <>
            {turnsUsed === 0 && !sending && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => onSend(s)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-[12px] text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                disabled={sending}
                maxLength={1000}
                rows={2}
                placeholder="AI에게 지시를 입력하세요…"
                className="min-w-0 flex-1 resize-none bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => onSend()}
                disabled={sending || !input.trim()}
                aria-label="보내기"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 text-center text-[11px] text-slate-400">
              체험 <b className="text-slate-600">{turnsLeft}턴</b> 남음 · 실제 응시에서는 제한 없이 AI와 대화하며 파일을 만듭니다
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-center">
            <div className="text-[13px] font-medium text-slate-900">체험 3턴을 모두 사용했습니다</div>
            <p className="mt-0.5 text-[11.5px] text-slate-500">실제 응시에서는 제한 없이 AI와 대화하며 산출물을 만들어 제출합니다.</p>
            <div className="mt-2 flex justify-center gap-2">
              <Link to="/login?tab=signup"><Button size="sm" className="h-7 text-[12px]">회원가입</Button></Link>
              <a href="https://ai-hrd.com/#contact"><Button size="sm" variant="secondary" className="h-7 text-[12px]">도입 문의</Button></a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
