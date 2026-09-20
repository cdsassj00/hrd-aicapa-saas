import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles, FileText, Lock, Paperclip, Download, Upload, Terminal,
  CheckCircle2, FileSpreadsheet, MessageSquare, Minus, ArrowUp, Maximize2, Minimize2,
} from 'lucide-react';
import { DemoSwitch } from '@/components/demo/DemoSwitch';

/**
 * 공개 응시자 화면 미리보기 (/demo)
 * 로그인·승인 없이 "응시자가 보는 시험 화면"을 그대로 체험. 채점·저장 없음.
 * 실제 응시에서는 플로팅 AI 창에서 E2B 샌드박스 에이전트와 대화하며
 * 파일을 생성·다운로드하고, 그 결과물을 제출합니다.
 */

const CHAT = [
  { who: 'user', text: '첨부된 orders_2026Q2.csv 열어서 컬럼이랑 행 수부터 확인해줘.' },
  {
    who: 'ai',
    text: '파일을 읽었습니다. 320행 · 9개 컬럼(order_id, order_date, category, amount, status, region, ship_days, customer_id, coupon). status에 결측 4건, amount에 통화기호가 섞여 있어 정제가 필요합니다.',
  },
  { who: 'user', text: "‘완료’ 주문만 대상으로 카테고리별 매출·평균 배송일 구하고, 재구매 고객 비율까지 계산해서 요약해줘." },
  {
    who: 'ai',
    text: 'pandas로 정제 후 집계했습니다. 완료 주문 271건 기준 — 가전이 매출 1위(1억 2,430만원), 평균 배송일은 패션이 1.8일로 가장 빠릅니다. 재구매(2회 이상 구매) 고객 비율은 34.7%입니다. 집계표와 요약 리포트를 파일로 만들었습니다.',
  },
  { who: 'user', text: '재구매 비율은 어떤 기준으로 잡았어? 근거 남겨서 메모에 넣어줘.' },
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

export default function DemoExamPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const allDownloaded = FILES.every((f) => downloaded[f.name]);

  // 챗 창 크기 조절 — 좌상단 모서리 드래그 + 확대/기본 토글.
  // 기본값을 세로로 길게(화면 높이 거의 가득) 잡는다.
  const [dims, setDims] = useState(() => ({
    w: 440,
    h: typeof window !== 'undefined' ? Math.min(760, window.innerHeight - 96) : 640,
  }));
  const dragRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, sw: dims.w, sh: dims.h };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const w = Math.min(Math.max(dragRef.current.sw + (dragRef.current.sx - ev.clientX), 300), window.innerWidth - 24);
      const h = Math.min(Math.max(dragRef.current.sh + (dragRef.current.sy - ev.clientY), 300), window.innerHeight - 80);
      setDims({ w, h });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const toggleExpand = () =>
    setDims((d) =>
      d.w > 520
        ? { w: 410, h: 480 }
        : { w: Math.min(760, window.innerWidth - 24), h: Math.min(760, window.innerHeight - 80) },
    );

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 via-background to-background text-foreground">
      {/* 상단 바 */}
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Sparkles className="h-3 w-3" /> 응시자 화면 미리보기
          </Badge>
          <span className="hidden text-[12.5px] text-muted-foreground md:inline">
            체험용 · 채점·저장은 되지 않습니다
          </span>
          <div className="ml-auto flex items-center gap-2">
            <a href="https://ai-hrd.com/#contact">
              <Button variant="outline" size="sm" className="text-[13px] font-medium">도입 문의</Button>
            </a>
            <Link to="/login?tab=signup">
              <Button size="sm" className="text-[13px] font-medium">회원가입</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 pb-28">
        <DemoSwitch current="applicant" />

        <div className="mb-4 mt-4">
          <h1 className="text-[19px] font-semibold tracking-tight">AI 활용 역량평가 — 체험 문항</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            오른쪽 아래 <b>AI 대화 버튼</b>으로 AI에게 파일을 분석시키고, 결과 파일을 <b>다운로드</b>한 뒤
            아래에 <b>업로드해 제출</b>합니다. (예시: 민간 · 데이터 분석)
          </p>
        </div>

        {/* 과제 — 컬러 헤더 + 좌측 강조선 */}
        <div className="overflow-hidden rounded-2xl border border-indigo-500/20 bg-card shadow-sm">
          <div className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 text-white">
            <FileText className="h-4 w-4" />
            <span className="text-[13.5px] font-semibold">과제</span>
            <span className="ml-auto flex gap-1">
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10.5px]">민간</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10.5px]">데이터 분석</span>
            </span>
          </div>
          <div className="p-5">
            <p className="text-[13.5px] leading-relaxed">
              당신은 이커머스 회사의 담당자입니다. 첨부된 <b>2분기 주문 데이터(320행)</b>는 통화기호·결측이 섞여
              있어 그대로는 계산할 수 없습니다. AI에게 데이터를 <b>정제·집계</b>시켜 아래 3가지를 산출하고,
              <b>집계표(.csv)와 요약 리포트(.md)</b>를 만들어 제출하세요.
              <span className="mt-1 block text-[12.5px] text-muted-foreground">
                (파이썬을 몰라도 됩니다. AI에게 무엇을·왜 시키는지가 평가 대상입니다.)
              </span>
            </p>

            <ol className="mt-4 space-y-2">
              {[
                '‘완료’ 주문만 대상으로 카테고리별 매출 합계 · 평균 배송일',
                '매출 1위 카테고리와 가장 빠른 배송 카테고리',
                '재구매(2회 이상) 고객 비율 — 산출 기준을 리포트에 명시',
              ].map((t, i) => (
                <li key={i} className="flex gap-2.5 rounded-lg bg-indigo-500/5 px-3 py-2 text-[13px]">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-[12.5px]">
                <Paperclip className="h-3.5 w-3.5 text-indigo-500" />
                <span className="font-medium">orders_2026Q2.csv</span>
                <span className="text-muted-foreground">· 320행 · 24 KB</span>
              </div>
              <span className="text-[12px] text-muted-foreground">← 첨부파일. AI 창에서 열어 분석하세요.</span>
            </div>
          </div>
        </div>

        {/* 작업 과정 */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-500/20 bg-card">
          <div className="flex items-center gap-2 bg-emerald-500/10 px-5 py-3">
            <Terminal className="h-4 w-4 text-emerald-600" />
            <span className="text-[13px] font-semibold">AI 작업 과정</span>
            <span className="text-[11.5px] text-muted-foreground">· E2B 안전 샌드박스 실행 로그</span>
          </div>
          <div className="space-y-1.5 p-5">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-[12.5px]">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span className="text-muted-foreground"><span className="mr-1.5 font-mono text-[11px] text-foreground/70">#{i + 1}</span>{s}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 생성 파일 → 다운로드 */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-sky-500/20 bg-card">
          <div className="flex items-center gap-2 bg-sky-500/10 px-5 py-3">
            <Download className="h-4 w-4 text-sky-600" />
            <span className="text-[13px] font-semibold">AI가 생성한 파일</span>
          </div>
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            {FILES.map((f) => {
              const Ico = f.icon;
              const done = downloaded[f.name];
              return (
                <button
                  key={f.name}
                  onClick={() => setDownloaded((d) => ({ ...d, [f.name]: true }))}
                  className="flex items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2.5 text-left transition hover:border-sky-500/50 hover:bg-sky-500/5"
                >
                  <Ico className="h-5 w-5 shrink-0 text-sky-600" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{f.name}</div>
                    <div className="text-[11.5px] text-muted-foreground">{f.size}</div>
                  </div>
                  {done ? (
                    <span className="flex items-center gap-1 text-[11.5px] font-medium text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> 받음
                    </span>
                  ) : (
                    <Download className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 제출 */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-amber-500/25 bg-card">
          <div className="flex items-center gap-2 bg-amber-500/10 px-5 py-3">
            <Upload className="h-4 w-4 text-amber-600" />
            <span className="text-[13px] font-semibold">제출</span>
          </div>
          <div className="p-5">
            <div className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${allDownloaded ? 'border-amber-500/50 bg-amber-500/5' : 'border-muted bg-muted/20'}`}>
              <Upload className={`h-6 w-6 ${allDownloaded ? 'text-amber-600' : 'text-muted-foreground'}`} />
              <div className="text-[13px] font-medium">
                {allDownloaded ? 'AI가 만든 파일을 여기에 올려 제출합니다' : '먼저 위에서 생성 파일을 다운로드하세요'}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> 체험 미리보기 — 실제 제출·채점은 승인된 응시에서 진행됩니다
              </div>
              <Button size="sm" disabled className="mt-1 text-[13px]">파일 선택 후 제출 (미리보기 비활성)</Button>
            </div>
          </div>
        </div>

        {/* 하단 CTA */}
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/10 to-transparent p-6 text-center">
          <div className="text-[15px] font-semibold">
            이 화면으로 지원자의 <span className="text-primary">AI 활용 역량</span>을 평가합니다
          </div>
          <p className="max-w-xl text-[13px] text-muted-foreground">
            정답만이 아니라 <b className="text-foreground">AI에게 던진 프롬프트와 대화 흐름, 작업 과정</b>까지 함께 봅니다.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/login?tab=signup"><Button className="text-[13px] font-medium">회원가입</Button></Link>
            <a href="https://ai-hrd.com/#contact"><Button variant="secondary" className="text-[13px] font-medium">도입 문의</Button></a>
            <Link to="/login"><Button variant="outline" className="text-[13px] font-medium">로그인</Button></Link>
          </div>
        </div>
      </main>

      {/* 플로팅 AI 창 — 독립 AI 서비스(ChatGPT) 같은 느낌 */}
      {chatOpen ? (
        <div
          style={{ width: dims.w, height: dims.h, maxWidth: 'calc(100vw - 1.5rem)', maxHeight: 'calc(100vh - 5rem)' }}
          className="fixed bottom-4 right-4 z-30 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1117] text-slate-100 shadow-2xl ring-1 ring-black/40"
        >
          {/* 좌상단 크기조절 핸들 */}
          <div
            onPointerDown={onResizeDown}
            title="드래그해서 크기 조절"
            className="absolute left-0 top-0 z-10 flex h-5 w-5 cursor-nwse-resize items-start justify-start p-1"
          >
            <span className="h-2 w-2 rounded-full border-l-2 border-t-2 border-slate-500" />
          </div>

          {/* 창 크롬 (신호등 + 타이틀 + 모델칩) */}
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#171922] px-4 py-2.5 pl-6">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </span>
            <div className="ml-1 flex items-center gap-1.5 text-[12.5px] font-medium">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" /> AI 어시스턴트
            </div>
            <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300 sm:inline">샌드박스 연결됨</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                onClick={toggleExpand}
                className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
                aria-label="넓게 보기 / 기본 크기"
              >
                {dims.w > 520 ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setChatOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
                aria-label="AI 창 접기"
              >
                <Minus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 대화 본문 */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            {CHAT.map((m, i) => (
              m.who === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-indigo-600 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-white">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-[11px] font-bold text-[#0f1117]">AI</span>
                  <div className="max-w-[82%] rounded-2xl rounded-tl-sm bg-[#1c1f2a] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-slate-100">
                    {m.text}
                  </div>
                </div>
              )
            ))}
          </div>

          {/* 입력 바 (ChatGPT 느낌) */}
          <div className="border-t border-white/10 bg-[#171922] p-3">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0f1117] px-3 py-2">
              <input
                disabled
                placeholder="AI에게 지시를 입력하세요…  (미리보기 비활성)"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-200 placeholder:text-slate-500 focus:outline-none"
              />
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white">
                <ArrowUp className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-1 text-[10.5px] text-slate-500">
              <Lock className="h-3 w-3" /> 실제 응시에서는 여기서 AI와 실시간으로 대화합니다
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-[13px] font-medium text-white shadow-xl transition hover:brightness-110"
          aria-label="AI 대화창 열기"
        >
          <MessageSquare className="h-4 w-4" /> AI에게 물어보기
        </button>
      )}
    </div>
  );
}
