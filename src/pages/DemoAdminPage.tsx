import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles, LayoutDashboard, Library, ClipboardList, Video, CheckSquare,
  Award, ChevronRight, ChevronLeft, X, Users, TrendingUp, FileText, MessageSquare,
} from 'lucide-react';
import { DemoSwitch } from '@/components/demo/DemoSwitch';

/**
 * 공개 관리자 화면 미리보기 (/demo/admin)
 * 로그인·승인 없이 "관리자(교육/채용 담당자)가 보는 화면"을 가이드 투어로 소개.
 * 실제 데이터·기능은 없고, 하이라이팅 온보딩으로 각 영역을 설명한다.
 */

type NavKey = 'dashboard' | 'questions' | 'exams' | 'proctor' | 'grading' | 'certs';

const NAV: { key: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: '대시보드', icon: LayoutDashboard },
  { key: 'questions', label: '문제은행', icon: Library },
  { key: 'exams', label: '시험 관리', icon: ClipboardList },
  { key: 'proctor', label: '실시간 감독', icon: Video },
  { key: 'grading', label: '채점', icon: CheckSquare },
  { key: 'certs', label: '결과 · 인증', icon: Award },
];

interface Step {
  key: NavKey;
  title: string;
  desc: string;
}

const STEPS: Step[] = [
  { key: 'dashboard', title: '한눈에 보는 진행 현황', desc: '응시 인원, 진행 중 시험, 평균 역량 점수를 대시보드에서 바로 확인합니다.' },
  { key: 'questions', title: '문제은행 — 역량·섹터·직무로 관리', desc: '6대 역량과 민간/공공 섹터, 직무 태그로 문항을 분류하고, 준비된 문제세트를 골라 씁니다.' },
  { key: 'exams', title: '시험 만들기', desc: '문제세트를 선택해 회차를 만들고, 응시자를 초대합니다. 감독 On/Off도 세트 단위로 설정합니다.' },
  { key: 'proctor', title: '실시간 감독 · 녹화', desc: '응시 중 화면·웹캠을 실시간으로 보고, 부정행위 의심 신호를 이벤트로 기록합니다.' },
  { key: 'grading', title: '채점 — 결과 + 과정까지', desc: '산출물 자동채점에 더해, 응시자의 프롬프트·대화 로그로 AI 활용 과정을 함께 평가합니다.' },
  { key: 'certs', title: '결과 리포트 · 인증서', desc: '6축 역량 프로파일 리포트와 인증서를 발급합니다. 발급 시점 등급은 동결 저장됩니다.' },
];

export default function DemoAdminPage() {
  const [step, setStep] = useState(0);
  const [tourOn, setTourOn] = useState(true);
  const active = STEPS[step].key;
  const activeKey: NavKey = tourOn ? active : 'dashboard';

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      {/* 상단 바 */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Sparkles className="h-3 w-3" /> 관리자 화면 미리보기
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            {!tourOn && (
              <Button variant="ghost" size="sm" className="text-[13px]" onClick={() => { setStep(0); setTourOn(true); }}>
                가이드 다시 보기
              </Button>
            )}
            <a href="https://ai-hrd.com/#contact"><Button variant="outline" size="sm" className="text-[13px] font-medium">도입 문의</Button></a>
            <Link to="/login?tab=signup"><Button size="sm" className="text-[13px] font-medium">회원가입</Button></Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5">
        <DemoSwitch current="admin" />

        {/* 모의 관리자 콘솔 */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[190px_1fr]">
          {/* 사이드바 */}
          <aside className="rounded-2xl border bg-background p-2">
            <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
              {NAV.map((n) => {
                const Ico = n.icon;
                const on = activeKey === n.key;
                return (
                  <div
                    key={n.key}
                    className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition ${on ? 'bg-primary/10 font-semibold text-primary ring-1 ring-primary/40' : 'text-muted-foreground'}`}
                  >
                    <Ico className="h-4 w-4" /> {n.label}
                  </div>
                );
              })}
            </nav>
          </aside>

          {/* 메인 패널 (활성 영역의 모의 콘텐츠) */}
          <section className="min-h-[360px] rounded-2xl border bg-background p-5">
            <AdminPanel which={activeKey} />
          </section>
        </div>
      </div>

      {/* 하이라이팅 온보딩 코치 카드 */}
      {tourOn && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5">
          <div className="w-full max-w-lg rounded-2xl border bg-card p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[13px] font-bold text-primary">
                {step + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{STEPS[step].title}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{STEPS[step].desc}</p>
              </div>
              <button onClick={() => setTourOn(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="가이드 닫기">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="flex gap-1.5">
                {STEPS.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline" size="sm" className="text-[13px]"
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> 이전
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button size="sm" className="text-[13px]" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                    다음 <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Link to="/login?tab=signup"><Button size="sm" className="text-[13px]">회원가입하고 시작</Button></Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 활성 영역별 모의 콘텐츠. 실제 데이터 아님 — 화면 감만 전달. */
function AdminPanel({ which }: { which: NavKey }) {
  if (which === 'dashboard') {
    return (
      <div>
        <h2 className="text-[15px] font-semibold">대시보드</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Users, label: '응시 인원', value: '128' },
            { icon: ClipboardList, label: '진행 중 시험', value: '3' },
            { icon: TrendingUp, label: '평균 역량점수', value: '72.4' },
            { icon: Award, label: '발급 인증서', value: '96' },
          ].map((s, i) => {
            const Ico = s.icon;
            return (
              <div key={i} className="rounded-xl border bg-muted/20 p-3">
                <Ico className="h-4 w-4 text-primary" />
                <div className="mt-2 text-[20px] font-bold tracking-tight">{s.value}</div>
                <div className="text-[11.5px] text-muted-foreground">{s.label}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl border bg-muted/10 p-4 text-[12.5px] text-muted-foreground">
          최근 회차 · 역량별 평균 · 응시 추이 차트가 여기에 표시됩니다.
        </div>
      </div>
    );
  }
  if (which === 'questions') {
    return (
      <div>
        <h2 className="text-[15px] font-semibold">문제은행</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {['민간', '공공', '자기주도 과업완수', '업무 자동화', '비판적 검증', '데이터 분석', 'chat', 'code_sandbox'].map((t) => (
            <span key={t} className="rounded-full border px-2.5 py-1 text-[11.5px] text-muted-foreground">{t}</span>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { c: 'Q-DA-014', t: '2분기 주문 데이터 정제·집계', cap: '데이터 분석 · 비판적 검증', sec: '민간' },
            { c: 'Q-DOC-007', t: '규정 요약 → 카드뉴스 제작', cap: '산출물 재현·변환', sec: '공공' },
            { c: 'Q-AUTO-021', t: '반복 보고 자동화 방안', cap: '업무 자동화', sec: '민간' },
            { c: 'Q-LIT-003', t: 'AI 리터러시 스크리닝(객관식)', cap: 'AI 리터러시', sec: '공통' },
          ].map((q) => (
            <div key={q.c} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-muted-foreground">{q.c}</span>
                <Badge variant="secondary" className="text-[10.5px]">{q.sec}</Badge>
              </div>
              <div className="mt-1 text-[13px] font-medium">{q.t}</div>
              <div className="mt-0.5 text-[11.5px] text-primary">{q.cap}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (which === 'exams') {
    return (
      <div>
        <h2 className="text-[15px] font-semibold">시험 관리</h2>
        <div className="mt-3 space-y-2">
          {[
            { t: '2026 상반기 신입 채용 — AI 역량평가', s: '진행 중', n: 42 },
            { t: '마케팅팀 재직자 진단', s: '예약', n: 18 },
            { t: '공공기관 위탁 파일럿', s: '완료', n: 30 },
          ].map((e, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3">
              <ClipboardList className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{e.t}</div>
                <div className="text-[11.5px] text-muted-foreground">응시 {e.n}명</div>
              </div>
              <Badge variant={e.s === '진행 중' ? 'default' : 'secondary'} className="text-[10.5px]">{e.s}</Badge>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (which === 'proctor') {
    return (
      <div>
        <h2 className="text-[15px] font-semibold">실시간 감독</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-xl border bg-gradient-to-br from-muted/40 to-muted/10 p-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Video className="h-3.5 w-3.5" /> 응시자 {i + 1}
              </div>
              <div className="mt-2 flex h-[calc(100%-1.5rem)] items-center justify-center rounded-lg bg-background/50 text-[11px] text-muted-foreground">
                실시간 화면
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (which === 'grading') {
    return (
      <div>
        <h2 className="text-[15px] font-semibold">채점</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-[12.5px] font-medium"><FileText className="h-4 w-4 text-primary" /> 산출물 자동채점</div>
            <p className="mt-1 text-[12px] text-muted-foreground">제출된 집계표·리포트를 정답 규격과 대조해 자동 채점합니다.</p>
          </div>
          <div className="rounded-xl border bg-primary/5 p-3 ring-1 ring-primary/20">
            <div className="flex items-center gap-2 text-[12.5px] font-medium"><MessageSquare className="h-4 w-4 text-primary" /> 과정 평가 (프롬프트·대화 로그)</div>
            <p className="mt-1 text-[12px] text-muted-foreground">응시자가 AI에게 무엇을·어떻게 시켰는지 대화 로그로 활용 과정을 함께 평가합니다.</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-[15px] font-semibold">결과 · 인증</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="text-[12.5px] font-medium">6축 역량 프로파일</div>
          <div className="mt-3 space-y-1.5">
            {['자기주도 과업완수', '과업 구조화', '업무 자동화', '산출물 재현·변환', '비판적 검증', '전략기획·커뮤니케이션'].map((c, i) => (
              <div key={c} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-[11px] text-muted-foreground">{c}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${55 + ((i * 7) % 40)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border bg-muted/20 p-4 text-center">
          <Award className="h-8 w-8 text-primary" />
          <div className="mt-2 text-[13px] font-medium">AI 활용 역량 인증서</div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">발급 시점 등급·점수를 동결 저장해 발급합니다.</p>
        </div>
      </div>
    </div>
  );
}
