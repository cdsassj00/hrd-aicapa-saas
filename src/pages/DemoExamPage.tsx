import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles, FileText, Bot, User, Lock, Paperclip, Download,
  Upload, Terminal, CheckCircle2, FileSpreadsheet, MessageSquare, Minus,
} from 'lucide-react';

/**
 * 공개 응시자 화면 미리보기 (/demo)
 * 로그인·승인 없이 "응시자가 보는 시험 화면"을 그대로 체험. 채점·저장 없음.
 * 실제 응시에서는 플로팅 AI 창에서 E2B 샌드박스 에이전트와 대화하며
 * 파일을 생성·다운로드하고, 그 결과물을 제출합니다.
 */

// 플로팅 AI 창 목업 대화 — 프롬프트·대화 로그가 평가 대상임을 보여준다.
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

// E2B 샌드박스가 남긴 작업 과정(코드 실행 로그) 목업.
const STEPS = [
  { label: 'orders_2026Q2.csv 로드 (320행)' },
  { label: 'amount 통화기호 제거 · 숫자 변환, status 결측 4건 제외' },
  { label: "status == '완료' 필터 → 271건" },
  { label: 'category별 매출·평균 ship_days groupby 집계' },
  { label: 'customer_id 기준 재구매(2회+) 비율 산출 = 34.7%' },
  { label: 'summary.md · category_stats.csv 파일 생성' },
];

const FILES = [
  { name: 'category_stats.csv', size: '2.1 KB', icon: FileSpreadsheet },
  { name: 'summary.md', size: '1.4 KB', icon: FileText },
];

export default function DemoExamPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const allDownloaded = FILES.every((f) => downloaded[f.name]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 상단 바 */}
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Sparkles className="h-3 w-3" /> 응시자 화면 미리보기
          </Badge>
          <span className="hidden text-[12.5px] text-muted-foreground md:inline">
            실제 시험 화면입니다 · 체험용이라 채점·저장은 되지 않습니다
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
        <div className="mb-4">
          <h1 className="text-[18px] font-semibold tracking-tight">AI 활용 역량평가 — 체험 문항</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            오른쪽 아래 <b>AI 대화 버튼</b>을 눌러 AI에게 파일을 열어 분석시키고, 결과 파일을 <b>다운로드</b>한 뒤
            아래에 <b>업로드해 제출</b>합니다. (예시: 민간 · 데이터 분석)
          </p>
        </div>

        {/* 과제 */}
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
            <FileText className="h-4 w-4 text-primary" /> 과제
          </div>
          <p className="text-[13.5px] leading-relaxed">
            당신은 이커머스 회사의 담당자입니다. 첨부된 <b>2분기 주문 데이터(320행)</b>는 통화기호·결측이 섞여
            있어 그대로는 계산할 수 없습니다. AI에게 데이터를 <b>정제·집계</b>시켜 아래 3가지를 산출하고,
            <b>집계표(.csv)와 요약 리포트(.md)</b>를 만들어 제출하세요.
            <span className="mt-1 block text-[12.5px] text-muted-foreground">
              (파이썬을 몰라도 됩니다. AI에게 무엇을·왜 시키는지가 평가 대상입니다.)
            </span>
          </p>

          <ol className="mt-3 space-y-1.5 text-[13px]">
            <li className="flex gap-2"><span className="font-semibold text-primary">1.</span> ‘완료’ 주문만 대상으로 <b>카테고리별 매출 합계 · 평균 배송일</b></li>
            <li className="flex gap-2"><span className="font-semibold text-primary">2.</span> 매출 1위 카테고리와 <b>가장 빠른 배송 카테고리</b></li>
            <li className="flex gap-2"><span className="font-semibold text-primary">3.</span> <b>재구매(2회 이상) 고객 비율</b> — 산출 기준을 리포트에 명시</li>
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[12.5px]">
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">orders_2026Q2.csv</span>
              <span className="text-muted-foreground">· 320행 · 24 KB</span>
            </div>
            <span className="text-[12px] text-muted-foreground">← 첨부파일. AI 창에서 열어 분석하세요.</span>
          </div>
        </Card>

        {/* 작업 과정 (E2B 샌드박스 로그) */}
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
            <Terminal className="h-4 w-4 text-primary" /> AI 작업 과정
            <span className="text-[11.5px] font-normal text-muted-foreground">· E2B 안전 샌드박스에서 실행된 코드 단계</span>
          </div>
          <div className="space-y-1.5">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-[12.5px]">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span className="text-muted-foreground"><span className="mr-1.5 font-mono text-[11px] text-foreground/70">#{i + 1}</span>{s.label}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* 생성된 파일 → 다운로드 */}
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
            <Download className="h-4 w-4 text-primary" /> AI가 생성한 파일
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {FILES.map((f) => {
              const Ico = f.icon;
              const done = downloaded[f.name];
              return (
                <button
                  key={f.name}
                  onClick={() => setDownloaded((d) => ({ ...d, [f.name]: true }))}
                  className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 text-left transition hover:border-primary/50 hover:bg-muted/40"
                >
                  <Ico className="h-5 w-5 shrink-0 text-primary" />
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
        </Card>

        {/* 제출 (업로드) */}
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
            <Upload className="h-4 w-4 text-primary" /> 제출
          </div>
          <div className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${allDownloaded ? 'border-primary/50 bg-primary/5' : 'border-muted bg-muted/20'}`}>
            <Upload className={`h-6 w-6 ${allDownloaded ? 'text-primary' : 'text-muted-foreground'}`} />
            <div className="text-[13px] font-medium">
              {allDownloaded ? 'AI가 만든 파일을 여기에 올려 제출합니다' : '먼저 위에서 생성 파일을 다운로드하세요'}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> 체험 미리보기 — 실제 제출·채점은 승인된 응시에서 진행됩니다
            </div>
            <Button size="sm" disabled className="mt-1 text-[13px]">
              파일 선택 후 제출 (미리보기 비활성)
            </Button>
          </div>
        </Card>

        {/* 하단 CTA — 가독성 개선(솔리드/시크리티 버튼) */}
        <Card className="mt-6 flex flex-col items-center gap-3 border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-6 text-center">
          <div className="text-[15px] font-semibold">
            이 화면으로 지원자의 <span className="text-primary">AI 활용 역량</span>을 평가합니다
          </div>
          <p className="max-w-xl text-[13px] text-muted-foreground">
            정답만이 아니라 <b className="text-foreground">AI에게 던진 프롬프트와 대화 흐름, 작업 과정</b>까지 함께 봅니다.
            도입은 회원가입 후 담당자 승인을 거쳐 진행됩니다.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/login?tab=signup"><Button className="text-[13px] font-medium">회원가입</Button></Link>
            <a href="https://ai-hrd.com/#contact"><Button variant="secondary" className="text-[13px] font-medium">도입 문의</Button></a>
            <Link to="/login"><Button variant="outline" className="text-[13px] font-medium">로그인</Button></Link>
          </div>
        </Card>
      </main>

      {/* 플로팅 AI 대화창 — 독립적인 위젯, 열고/접기 */}
      {chatOpen ? (
        <div className="fixed bottom-4 right-4 z-30 flex w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15">
              <Bot className="h-4 w-4 text-primary" />
            </span>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">생성형 AI</div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 샌드박스 연결됨
              </div>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="AI 창 접기"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>

          <div className="flex max-h-[52vh] min-h-[240px] flex-1 flex-col gap-3 overflow-y-auto bg-muted/10 p-3">
            {CHAT.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.who === 'user' ? 'flex-row-reverse' : ''}`}>
                {m.who === 'user'
                  ? <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  : <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${m.who === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-background'}`}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t p-3">
            <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-[12px] text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" /> 실제 응시에서는 여기서 AI와 실시간으로 대화합니다
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-[13px] font-medium text-primary-foreground shadow-xl transition hover:brightness-110"
          aria-label="AI 대화창 열기"
        >
          <MessageSquare className="h-4 w-4" /> AI에게 물어보기
        </button>
      )}
    </div>
  );
}
