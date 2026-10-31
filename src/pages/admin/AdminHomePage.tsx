import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, BookOpen, Monitor, CheckSquare, UserCog, BarChart3,
  Plus, ArrowRight, CalendarClock, Users, Inbox, CreditCard,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * 관리자 홈 (/admin) — 로그인 직후 첫 화면.
 *
 * 레이아웃 (Mobbin 레퍼런스: Grok 대시보드를 라이트 톤으로)
 *   상단 띠 : 인사 · 조직명 · 요금제 + 주요 행동(시험 만들기)
 *   요약 카드 : 진행 중 시험 · 이번 달 응시 · 채점 대기 · 멤버
 *   바로가기 : 자주 쓰는 6개 화면
 *   최근 회차 : 일정·상태 한눈에
 * 숫자는 전부 현재 조직(activeOrgId)으로 좁힌다 — 여러 조직 소속이면 RLS 상 모두 보이기 때문.
 */

// subscriptions·plans 조인은 생성 타입의 관계 추론에 걸리지 않아 느슨한 클라이언트로 읽는다(BillingPage 와 같은 방식).
const db = supabase as unknown as SupabaseClient;

type RecentExam = { id: string; title: string; status: string; exam_date: string | null; duration_minutes: number };
type Plan = { name: string; code: string } | null;
type Sub = { status: string; current_period_end: string | null; plans: Plan | Plan[] } | null;

const SHORTCUTS = [
  { title: '시험 관리', desc: '회차 만들기 · 문항 배정', url: '/admin/exams', icon: ClipboardList, tint: 'bg-indigo-50 text-indigo-600' },
  { title: '문제은행', desc: '문항 · 세트 · AI 생성', url: '/admin/questions', icon: BookOpen, tint: 'bg-violet-50 text-violet-600' },
  { title: '실시간 모니터링', desc: '응시 화면 · 이상 행동', url: '/examiner/monitor', icon: Monitor, tint: 'bg-sky-50 text-sky-600' },
  { title: '채점 관리', desc: 'AI 채점 · 결과 확정', url: '/admin/grading', icon: CheckSquare, tint: 'bg-emerald-50 text-emerald-600' },
  { title: '멤버 · 초대', desc: '감독관 · 관리자 권한', url: '/admin/members', icon: UserCog, tint: 'bg-amber-50 text-amber-600' },
  { title: '통계', desc: '역량별 결과 리포트', url: '/admin/stats', icon: BarChart3, tint: 'bg-rose-50 text-rose-600' },
];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: '준비 중', cls: 'bg-slate-100 text-slate-600' },
  open: { label: '접수 중', cls: 'bg-emerald-50 text-emerald-700' },
  closed: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
};

export default function AdminHomePage() {
  const { user, activeOrg, activeOrgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ openExams: 0, monthSessions: 0, toGrade: 0, members: 0 });
  const [recent, setRecent] = useState<RecentExam[]>([]);
  const [sub, setSub] = useState<Sub>(null);
  const [seats, setSeats] = useState<number | null>(null);

  useEffect(() => {
    if (!activeOrgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [examsRes, monthRes, gradeRes, memberRes, subRes, orgRes, seatRes] = await Promise.all([
        supabase.from('exams').select('id, title, status, exam_date, duration_minutes')
          .eq('org_id', activeOrgId).order('created_at', { ascending: false }),
        supabase.from('exam_sessions').select('id', { count: 'exact', head: true })
          .eq('org_id', activeOrgId).gte('created_at', monthStart.toISOString()),
        supabase.from('exam_sessions').select('id', { count: 'exact', head: true })
          .eq('org_id', activeOrgId).eq('status', 'submitted'),
        supabase.from('org_members').select('user_id', { count: 'exact', head: true })
          .eq('org_id', activeOrgId).eq('status', 'active'),
        db.from('subscriptions').select('status, current_period_end, plans(name, code)')
          .eq('org_id', activeOrgId).maybeSingle(),
        db.from('organizations').select('seat_enforced').eq('id', activeOrgId).maybeSingle(),
        db.rpc('org_seat_balance', { _org_id: activeOrgId }),
      ]);
      if (cancelled) return;
      const exams = (examsRes.data ?? []) as RecentExam[];
      setStats({
        openExams: exams.filter((e) => e.status === 'open').length,
        monthSessions: monthRes.count ?? 0,
        toGrade: gradeRes.count ?? 0,
        members: memberRes.count ?? 0,
      });
      setRecent(exams.slice(0, 5));
      setSub((subRes.data as unknown as Sub) ?? null);
      // 응시권으로 과금되는 조직만 남은 수량을 보여 준다(0044). 아니면 숨긴다.
      setSeats((orgRes.data as { seat_enforced?: boolean } | null)?.seat_enforced ? ((seatRes.data as number | null) ?? 0) : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeOrgId]);

  const planRow = Array.isArray(sub?.plans) ? sub?.plans[0] : sub?.plans;
  const planName = sub?.status === 'active' ? (planRow?.name ?? 'Pro') : 'Free';
  const firstName = user?.name || user?.email?.split('@')[0] || '';

  const kpis = [
    { label: '진행 중 시험', value: stats.openExams, unit: '개', icon: CalendarClock, to: '/admin/exams' },
    { label: '이번 달 응시', value: stats.monthSessions, unit: '명', icon: Users, to: '/admin/stats' },
    { label: '채점 대기', value: stats.toGrade, unit: '건', icon: Inbox, to: '/admin/grading', alert: stats.toGrade > 0 },
    { label: '활성 멤버', value: stats.members, unit: '명', icon: UserCog, to: '/admin/members' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 상단 띠 */}
      <section className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-6 py-6 sm:px-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-violet-200/40 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-medium text-indigo-600">
              <span>{activeOrg?.orgName ?? '조직'}</span>
              <span className="text-indigo-300">·</span>
              <Link to="/admin/billing" className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-white">
                <CreditCard className="h-3 w-3" /> {planName}
              </Link>
              {seats !== null && sub?.status !== 'active' && (
                <Link to="/admin/billing" className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 hover:bg-white ${seats > 0 ? 'bg-white/80 text-indigo-700 ring-indigo-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>
                  응시권 {seats}명분 남음
                </Link>
              )}
            </div>
            <h1 className="mt-1.5 text-[22px] font-semibold tracking-tight text-slate-900">
              안녕하세요{firstName ? `, ${firstName}님` : ''}
            </h1>
            <p className="mt-1 text-[13.5px] text-slate-500">
              오늘의 진단 현황입니다. 새 회차를 만들거나, 진행 중인 시험을 지켜보세요.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/examiner/monitor">
              <Button variant="outline" className="bg-white/80 text-[13px]">
                <Monitor className="mr-1.5 h-4 w-4" /> 모니터링
              </Button>
            </Link>
            <Link to="/admin/exams">
              <Button className="text-[13px]">
                <Plus className="mr-1.5 h-4 w-4" /> 시험 만들기
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 요약 카드 */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            to={k.to}
            className="group rounded-2xl border bg-card p-4 transition hover:border-indigo-200 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-muted-foreground">{k.label}</span>
              <k.icon className={cn('h-4 w-4', k.alert ? 'text-amber-500' : 'text-slate-400')} />
            </div>
            {loading ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <div className="mt-2 flex items-baseline gap-1">
                <span className={cn('text-[28px] font-semibold tabular-nums tracking-tight', k.alert && 'text-amber-600')}>
                  {k.value}
                </span>
                <span className="text-[13px] text-muted-foreground">{k.unit}</span>
              </div>
            )}
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* 바로가기 6 */}
        <section className="lg:col-span-3">
          <h2 className="mb-3 text-[13px] font-semibold text-slate-700">바로가기</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SHORTCUTS.map((s) => (
              <Link
                key={s.url}
                to={s.url}
                className="group flex flex-col gap-3 rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-sm"
              >
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', s.tint)}>
                  <s.icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-[13.5px] font-semibold text-slate-900">{s.title}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{s.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 최근 회차 */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-slate-700">최근 회차</h2>
            <Link to="/admin/exams" className="inline-flex items-center gap-0.5 text-[12px] text-indigo-600 hover:underline">
              전체 보기 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y rounded-2xl border bg-card">
            {loading ? (
              [0, 1, 2].map((i) => <div key={i} className="p-4"><Skeleton className="h-5 w-full" /></div>)
            ) : recent.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <ClipboardList className="h-6 w-6 text-slate-300" />
                <div className="text-[13px] text-muted-foreground">아직 만든 회차가 없습니다</div>
                <Link to="/admin/exams"><Button size="sm" variant="outline" className="mt-1 text-[12.5px]">첫 시험 만들기</Button></Link>
              </div>
            ) : (
              recent.map((e) => {
                const st = STATUS_LABEL[e.status] ?? STATUS_LABEL.draft;
                return (
                  <Link key={e.id} to="/admin/exams" className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-slate-900">{e.title}</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        {e.exam_date
                          ? new Date(e.exam_date).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '일정 미정'}
                        {' · '}{e.duration_minutes}분
                      </div>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', st.cls)}>{st.label}</span>
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
