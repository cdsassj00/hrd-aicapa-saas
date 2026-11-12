import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList, Monitor, Plus, ArrowRight, CalendarClock, Users, Inbox, CreditCard,
  TrendingUp, TrendingDown, Minus, Gauge, CheckCircle2, AlertTriangle, FileClock, Ticket,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * 관리자 홈 (/admin) — 운영 대시보드.
 *
 *   머리말   : 조직 · 요금제 · 응시권 + 주요 행동
 *   지표 4개 : 진행 중 시험 · 이번 달 응시(전월 대비) · 채점 대기 · 평균 점수(합격률)
 *   추이     : 최근 8주 주간 응시 수 (단일 계열 막대)
 *   처리할 일: 채점 대기 · 오늘 시험 · 준비 중 회차 · 응시권 부족
 *   최근 회차: 회차별 응시 · 제출 · 평균 · 합격률
 * 숫자는 전부 현재 조직(activeOrgId)으로 좁힌다 — 여러 조직 소속이면 RLS 상 모두 보이기 때문.
 */

// subscriptions·plans 조인은 생성 타입의 관계 추론에 걸리지 않아 느슨한 클라이언트로 읽는다(BillingPage 와 같은 방식).
const db = supabase as unknown as SupabaseClient;

type Exam = { id: string; title: string; status: string; exam_date: string | null; duration_minutes: number; is_test_mode: boolean | null };
type Session = { id: string; exam_id: string; status: string; score_total: number | null; created_at: string; submit_time: string | null };
type Plan = { name: string; code: string } | null;
type Sub = { status: string; current_period_end: string | null; plans: Plan | Plan[] } | null;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: '준비 중', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  open: { label: '접수 중', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  closed: { label: '종료', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

const DAY = 86_400_000;
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '일정 미정';

/** 이번 주 월요일 0시 기준으로 최근 n주 구간 */
function weekBuckets(n: number) {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(monday.getTime() - (n - 1 - i) * 7 * DAY);
    return { start, end: new Date(start.getTime() + 7 * DAY), label: `${start.getMonth() + 1}/${start.getDate()}` };
  });
}

export default function AdminHomePage() {
  const { user, activeOrg, activeOrgId } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<Exam[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sub, setSub] = useState<Sub>(null);
  const [seats, setSeats] = useState<number | null>(null);

  useEffect(() => {
    if (!activeOrgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [examsRes, sessRes, subRes, orgRes, seatRes] = await Promise.all([
        supabase.from('exams').select('id, title, status, exam_date, duration_minutes, is_test_mode')
          .eq('org_id', activeOrgId).order('exam_date', { ascending: false }),
        supabase.from('exam_sessions').select('id, exam_id, status, score_total, created_at, submit_time')
          .eq('org_id', activeOrgId).order('created_at', { ascending: false }).limit(5000),
        db.from('subscriptions').select('status, current_period_end, plans(name, code)')
          .eq('org_id', activeOrgId).maybeSingle(),
        db.from('organizations').select('seat_enforced').eq('id', activeOrgId).maybeSingle(),
        db.rpc('org_seat_balance', { _org_id: activeOrgId }),
      ]);
      if (cancelled) return;
      setExams((examsRes.data ?? []) as Exam[]);
      setSessions(((sessRes.data ?? []) as Session[]).map((s) => ({ ...s, score_total: s.score_total == null ? null : Number(s.score_total) })));
      setSub((subRes.data as unknown as Sub) ?? null);
      // 응시권으로 과금되는 조직만 남은 수량을 보여 준다(0044). 아니면 숨긴다.
      setSeats((orgRes.data as { seat_enforced?: boolean } | null)?.seat_enforced ? ((seatRes.data as number | null) ?? 0) : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeOrgId]);

  const m = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonth = sessions.filter((s) => new Date(s.created_at) >= monthStart).length;
    const lastMonth = sessions.filter((s) => { const d = new Date(s.created_at); return d >= prevMonthStart && d < monthStart; }).length;
    const toGrade = sessions.filter((s) => s.status === 'submitted');
    const oldestWait = toGrade.reduce<number | null>((acc, s) => {
      const t = new Date(s.submit_time ?? s.created_at).getTime();
      return acc == null || t < acc ? t : acc;
    }, null);
    const graded = sessions.filter((s) => (s.status === 'passed' || s.status === 'failed') && s.score_total != null);
    const avg = graded.length ? Math.round((graded.reduce((a, s) => a + (s.score_total ?? 0), 0) / graded.length) * 10) / 10 : null;
    const passRate = graded.length ? Math.round((graded.filter((s) => s.status === 'passed').length / graded.length) * 100) : null;
    const open = exams.filter((e) => e.status === 'open');
    const upcoming = open
      .filter((e) => e.exam_date && new Date(e.exam_date).getTime() > now.getTime() - 3 * 3600_000)
      .sort((a, b) => new Date(a.exam_date!).getTime() - new Date(b.exam_date!).getTime())[0];
    const todayStr = now.toDateString();
    const today = exams.filter((e) => e.exam_date && new Date(e.exam_date).toDateString() === todayStr && e.status !== 'closed');
    const drafts = exams.filter((e) => e.status === 'draft');

    const weeks = weekBuckets(8).map((w) => ({
      label: w.label,
      count: sessions.filter((s) => { const d = new Date(s.created_at); return d >= w.start && d < w.end; }).length,
    }));

    const byExam = new Map<string, Session[]>();
    for (const s of sessions) byExam.set(s.exam_id, [...(byExam.get(s.exam_id) ?? []), s]);
    const recent = exams.slice(0, 6).map((e) => {
      const ss = byExam.get(e.id) ?? [];
      const done = ss.filter((s) => ['submitted', 'passed', 'failed'].includes(s.status));
      const g = ss.filter((s) => (s.status === 'passed' || s.status === 'failed') && s.score_total != null);
      return {
        ...e,
        applied: ss.length,
        submitted: done.length,
        avg: g.length ? Math.round(g.reduce((a, s) => a + (s.score_total ?? 0), 0) / g.length) : null,
        pass: g.length ? Math.round((g.filter((s) => s.status === 'passed').length / g.length) * 100) : null,
      };
    });

    return { thisMonth, lastMonth, toGrade: toGrade.length, oldestWait, avg, passRate, gradedCount: graded.length, open, upcoming, today, drafts, weeks, recent };
  }, [exams, sessions]);

  const planRow = Array.isArray(sub?.plans) ? sub?.plans[0] : sub?.plans;
  const planName = sub?.status === 'active' ? (planRow?.name ?? 'Pro') : 'Free';
  const firstName = user?.name || user?.email?.split('@')[0] || '';
  const seatLow = seats !== null && sub?.status !== 'active' && seats <= 5;

  const delta = m.thisMonth - m.lastMonth;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const waitDays = m.oldestWait ? Math.floor((Date.now() - m.oldestWait) / DAY) : null;

  const kpis = [
    {
      label: '진행 중 시험', value: m.open.length, unit: '개', icon: CalendarClock, to: '/admin/exams',
      sub: m.upcoming ? `다음: ${fmtDate(m.upcoming.exam_date)}` : '예정된 회차 없음',
    },
    {
      label: '이번 달 응시', value: m.thisMonth, unit: '명', icon: Users, to: '/admin/stats',
      sub: (
        <span className={cn('inline-flex items-center gap-1', delta > 0 && 'text-emerald-600', delta < 0 && 'text-rose-600')}>
          <DeltaIcon className="h-3 w-3" /> 전월 대비 {delta > 0 ? '+' : ''}{delta}명
        </span>
      ),
    },
    {
      label: '채점 대기', value: m.toGrade, unit: '건', icon: Inbox, to: '/admin/grading', alert: m.toGrade > 0,
      sub: m.toGrade > 0 ? `가장 오래된 제출 ${waitDays === 0 ? '오늘' : `${waitDays}일 전`}` : '모두 채점 완료',
    },
    {
      label: '평균 점수', value: m.avg ?? '–', unit: m.avg != null ? '점' : '', icon: Gauge, to: '/admin/stats',
      sub: m.passRate != null ? `합격률 ${m.passRate}% · 채점 ${m.gradedCount}건` : '채점된 응시 없음',
    },
  ];

  const todos = [
    m.toGrade > 0 && { icon: Inbox, tone: 'amber', title: `채점 대기 ${m.toGrade}건`, desc: 'AI 채점 후 실무형 문항을 확정하세요', to: '/admin/grading', cta: '채점하기' },
    m.today.length > 0 && { icon: Monitor, tone: 'indigo', title: `오늘 시험 ${m.today.length}개`, desc: m.today.map((e) => e.title).join(', '), to: '/examiner/monitor', cta: '모니터링' },
    m.drafts.length > 0 && { icon: FileClock, tone: 'slate', title: `준비 중 회차 ${m.drafts.length}개`, desc: '문항 배정과 응시자 초대를 마무리하세요', to: '/admin/exams', cta: '열기' },
    seatLow && { icon: Ticket, tone: seats === 0 ? 'rose' : 'amber', title: seats === 0 ? '응시권 소진' : `응시권 ${seats}명분 남음`, desc: '새 응시자를 받으려면 응시권을 충전하세요', to: '/admin/billing', cta: '충전' },
  ].filter(Boolean) as { icon: typeof Inbox; tone: string; title: string; desc: string; to: string; cta: string }[];

  const toneCls: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300',
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* 머리말 */}
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{activeOrg?.orgName ?? '조직'}</span>
            <span>·</span>
            <Link to="/admin/billing" className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold hover:bg-muted">
              <CreditCard className="h-3 w-3" /> {planName}
            </Link>
            {seats !== null && sub?.status !== 'active' && (
              <Link
                to="/admin/billing"
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold hover:bg-muted',
                  seats === 0 && 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
                )}
              >
                <Ticket className="h-3 w-3" /> 응시권 {seats}명분 남음
              </Link>
            )}
            <span>·</span>
            <span>{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</span>
          </div>
          <h1 className="mt-1.5 text-[22px] font-semibold tracking-tight">운영 대시보드</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {firstName ? `${firstName}님, ` : ''}응시 현황과 처리할 일을 한눈에 확인하세요.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline" className="h-9 text-[13px]">
            <Link to="/examiner/monitor"><Monitor className="mr-1.5 h-4 w-4" /> 실시간 모니터링</Link>
          </Button>
          <Button asChild className="h-9 text-[13px]">
            <Link to="/admin/exams"><Plus className="mr-1.5 h-4 w-4" /> 시험 만들기</Link>
          </Button>
        </div>
      </header>

      {/* 지표 */}
      <section className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card lg:grid-cols-4" data-testid="admin-kpis">
        {kpis.map((k, i) => (
          <Link
            key={k.label}
            to={k.to}
            className={cn(
              'group p-4 transition-colors hover:bg-muted/40',
              i % 2 === 1 && 'border-l',
              i >= 2 && 'border-t lg:border-t-0',
              i === 2 && 'lg:border-l',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-muted-foreground">{k.label}</span>
              <k.icon className={cn('h-4 w-4 text-muted-foreground/60', k.alert && 'text-amber-500')} />
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-16" />
            ) : (
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className={cn('text-[26px] font-semibold tabular-nums tracking-tight', k.alert && 'text-amber-600')}>{k.value}</span>
                <span className="text-[12.5px] text-muted-foreground">{k.unit}</span>
              </div>
            )}
            <div className="mt-1 truncate text-[11.5px] text-muted-foreground">{loading ? ' ' : k.sub}</div>
          </Link>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* 추이 */}
        <section className="rounded-xl border bg-card lg:col-span-2">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold">주간 응시 추이</h2>
              <p className="text-[11.5px] text-muted-foreground">최근 8주 · 응시 신청 기준</p>
            </div>
            <Link to="/admin/stats" className="inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline">
              통계 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="h-[220px] px-2 pb-2 pt-4" role="img" aria-label={`주간 응시 수: ${m.weeks.map((w) => `${w.label} ${w.count}명`).join(', ')}`}>
            {loading ? (
              <Skeleton className="mx-2 h-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.weeks} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }}
                    contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', fontSize: 12 }}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(v: number) => [`${v}명`, '응시']}
                    labelFormatter={(l) => `${l} 주`}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* 처리할 일 */}
        <section className="rounded-xl border bg-card" data-testid="admin-todos">
          <div className="border-b px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">처리할 일</h2>
            <p className="text-[11.5px] text-muted-foreground">지금 확인이 필요한 항목</p>
          </div>
          <div className="divide-y">
            {loading ? (
              [0, 1, 2].map((i) => <div key={i} className="p-4"><Skeleton className="h-9 w-full" /></div>)
            ) : todos.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                <div className="text-[13px] font-medium">처리할 일이 없습니다</div>
                <div className="text-[12px] text-muted-foreground">새 회차를 만들어 응시자를 초대해 보세요</div>
              </div>
            ) : (
              todos.map((t) => (
                <Link key={t.title} to={t.to} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', toneCls[t.tone])}>
                    <t.icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{t.title}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{t.desc}</div>
                  </div>
                  <span className="shrink-0 text-[12px] font-medium text-primary">{t.cta}</span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {/* 최근 회차 */}
      <section className="rounded-xl border bg-card" data-testid="admin-recent">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-[13.5px] font-semibold">최근 회차</h2>
            <p className="text-[11.5px] text-muted-foreground">회차별 응시 · 제출 · 성적</p>
          </div>
          <Link to="/admin/exams" className="inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline">
            전체 보기 <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : m.recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <ClipboardList className="h-6 w-6 text-muted-foreground/40" />
            <div className="text-[13px] text-muted-foreground">아직 만든 회차가 없습니다</div>
            <Button asChild size="sm" variant="outline" className="mt-1 text-[12.5px]"><Link to="/admin/exams">첫 시험 만들기</Link></Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-[11.5px] font-medium text-muted-foreground">
                  <th className="px-4 py-2 font-medium">회차</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">일시</th>
                  <th className="px-3 py-2 text-right font-medium">응시</th>
                  <th className="px-3 py-2 text-right font-medium">제출</th>
                  <th className="px-3 py-2 text-right font-medium">평균</th>
                  <th className="px-4 py-2 text-right font-medium">합격률</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {m.recent.map((e) => {
                  const st = STATUS_LABEL[e.status] ?? STATUS_LABEL.draft;
                  return (
                    <tr key={e.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate('/admin/exams')}>
                      <td className="max-w-[280px] px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{e.title}</span>
                          {e.is_test_mode && <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">테스트</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium', st.cls)}>{st.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{fmtDate(e.exam_date)} · {e.duration_minutes}분</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{e.applied}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{e.submitted}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{e.avg ?? '–'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{e.pass != null ? `${e.pass}%` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {m.toGrade > 0 && waitDays != null && waitDays >= 3 && (
        <p className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> 3일 넘게 채점되지 않은 제출이 있습니다. 응시자 안내 일정을 확인하세요.
        </p>
      )}
    </div>
  );
}
