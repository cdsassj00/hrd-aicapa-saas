import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer } from 'lucide-react';
import { ALERT_EVENT_LABEL_MAP } from '@/lib/alertEventTypes';
import {
  competencyScores, cohortStats, strengthsAndGaps, questionTitle,
  type CompetencyInfo, type QuestionCompetency, type ReportQuestion,
} from '@/lib/candidateReport';

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: '객관식', short_answer: '단답형', essay: '서술형',
  work_based: '실무형', file_upload: '파일 제출', practical: '실습형',
};

interface Row {
  id: string; order: number; title: string; type: string;
  points: number; score: number | null; feedback: string | null; answered: boolean;
}

interface ReportData {
  session: any; exam: any; name: string; email: string;
  member: any; gradeLevel: any; rows: Row[];
  comps: CompetencyInfo[]; links: QuestionCompetency[];
  cohort: number[]; events: Record<string, number>;
  agent: { turns: number; tokens: number; artifacts: number } | null;
  orgName: string;
}

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-');

export default function CandidateReportPage() {
  const { sessionId } = useParams();
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (sessionId) load(sessionId).then(setData).catch(e => setError(String(e?.message ?? e))); }, [sessionId]);

  const computed = useMemo(() => {
    if (!data) return null;
    const qs: ReportQuestion[] = data.rows.map(r => ({ id: r.id, points: r.points, score: r.score }));
    const comp = competencyScores(qs, data.links, data.comps);
    const sg = strengthsAndGaps(comp);
    const my = data.session.score_total != null ? Number(data.session.score_total) : null;
    const cohort = cohortStats(my, data.cohort);
    const earned = data.rows.reduce((a, r) => a + (r.score ?? 0), 0);
    const possible = data.rows.reduce((a, r) => a + r.points, 0);
    const ungraded = data.rows.filter(r => r.score == null).length;
    return { comp, sg, my, cohort, earned, possible, ungraded };
  }, [data]);

  if (error) return <div className="p-10 text-sm text-destructive">리포트를 불러오지 못했습니다: {error}</div>;
  if (!data || !computed) return <div className="p-10 text-sm text-muted-foreground">리포트를 만드는 중...</div>;

  const { session, exam } = data;
  const passScore = Number(exam.pass_score ?? 0);
  const { comp, sg, my, cohort, earned, possible, ungraded } = computed;
  const passed = my != null && my >= passScore;
  const eventTotal = Object.values(data.events).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-secondary/30 print:bg-white">
      <div className="mx-auto max-w-[820px] px-4 py-6 print:p-0 print:max-w-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Button variant="ghost" size="sm" asChild className="gap-1">
            <Link to="/admin/grading"><ArrowLeft className="h-4 w-4" /> 채점 목록</Link>
          </Button>
          <Button size="sm" onClick={() => window.print()} className="gap-1">
            <Printer className="h-4 w-4" /> 인쇄 · PDF 저장
          </Button>
        </div>

        <article className="rounded-lg border bg-background p-8 text-[13px] leading-relaxed shadow-sm print:border-0 print:shadow-none print:p-6">
          {/* 머리말 */}
          <header className="flex items-start justify-between border-b pb-4">
            <div>
              <p className="text-[11px] text-muted-foreground">{data.orgName} · AI 활용 역량평가</p>
              <h1 className="mt-1 text-xl font-bold">응시자 역량 리포트</h1>
              <p className="mt-1 text-muted-foreground">{exam.title}</p>
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              <p>발행 {fmtDate(new Date().toISOString())}</p>
              <p>세션 {session.id.slice(0, 8)}</p>
            </div>
          </header>

          {/* 응시자 + 종합 */}
          <section className="mt-5 grid grid-cols-2 gap-6">
            <dl className="grid grid-cols-[80px_1fr] gap-y-1">
              <dt className="text-muted-foreground">이름</dt><dd className="font-semibold">{data.name}</dd>
              <dt className="text-muted-foreground">이메일</dt><dd>{data.email || '-'}</dd>
              <dt className="text-muted-foreground">소속</dt><dd>{[data.member?.department, data.member?.position].filter(Boolean).join(' · ') || '-'}</dd>
              {data.member?.employee_no && (<><dt className="text-muted-foreground">사번</dt><dd>{data.member.employee_no}</dd></>)}
              <dt className="text-muted-foreground">응시</dt><dd>{fmtDate(session.start_time)}</dd>
              <dt className="text-muted-foreground">제출</dt><dd>{fmtDate(session.submit_time)}</dd>
            </dl>
            <div className="rounded-md border p-4" data-testid="report-summary">
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold tabular-nums">{my ?? '-'}</span>
                <span className="pb-1 text-muted-foreground">/ 100점</span>
                {my != null && (
                  <span className={`ml-auto rounded px-2 py-0.5 text-[12px] font-semibold ${passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    {passed ? '기준 충족' : '기준 미달'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                기준 {passScore}점 · 획득 {fmtNum(earned)} / 배점 {fmtNum(possible)}
                {data.gradeLevel && <> · 등급 <b style={{ color: data.gradeLevel.color ?? undefined }}>{data.gradeLevel.name}</b></>}
              </p>
              {cohort.rank != null && (
                <p className="mt-2 text-[12px]">
                  같은 회차 {cohort.n}명 중 <b>{cohort.rank}위</b> (상위 {cohort.topPercent}%) · 평균 {cohort.avg}점
                </p>
              )}
              {ungraded > 0 && <p className="mt-2 text-[12px] text-amber-700">미채점 문항 {ungraded}개 — 점수가 바뀔 수 있습니다.</p>}
            </div>
          </section>

          {/* 역량별 */}
          <section className="mt-6">
            <h2 className="mb-2 text-[14px] font-bold">역량별 득점률</h2>
            {comp.length === 0 ? (
              <p className="text-muted-foreground">이 회차 문항에 역량 매핑이 없어 역량별 결과를 계산할 수 없습니다. (문제은행에서 문항별 역량을 지정하세요)</p>
            ) : (
              <div className="space-y-2" data-testid="report-competencies">
                {comp.map(c => (
                  <div key={c.id} className="grid grid-cols-[200px_1fr_56px] items-center gap-3">
                    <span className="truncate">{c.name} <span className="text-[11px] text-muted-foreground">({c.questionCount}문항)</span></span>
                    <div className="h-2.5 rounded bg-muted print:border">
                      <div className="h-2.5 rounded bg-primary" style={{ width: `${Math.min(100, c.percent)}%`, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
                    </div>
                    <span className="text-right tabular-nums font-semibold">{c.percent}%</span>
                  </div>
                ))}
              </div>
            )}
            {(sg.strengths.length > 0) && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="rounded-md bg-emerald-50 p-3 print:border">
                  <p className="text-[12px] font-semibold text-emerald-800">강점</p>
                  <p className="mt-1">{sg.strengths.map(s => `${s.name} ${s.percent}%`).join(', ')}</p>
                </div>
                <div className="rounded-md bg-amber-50 p-3 print:border">
                  <p className="text-[12px] font-semibold text-amber-800">보완 필요</p>
                  <p className="mt-1">{sg.gaps.map(s => `${s.name} ${s.percent}%`).join(', ')}</p>
                </div>
              </div>
            )}
          </section>

          {/* 응시 태도 */}
          <section className="mt-6 grid grid-cols-2 gap-6">
            <div>
              <h2 className="mb-2 text-[14px] font-bold">감독 기록</h2>
              {eventTotal === 0 ? <p className="text-muted-foreground">기록된 이상 행동 없음</p> : (
                <ul className="space-y-0.5">
                  {Object.entries(data.events).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <li key={k} className="flex justify-between"><span>{ALERT_EVENT_LABEL_MAP[k] ?? k}</span><span className="tabular-nums">{v}회</span></li>
                  ))}
                </ul>
              )}
              {session.is_flagged && <p className="mt-1 text-[12px] text-red-700">감독관이 검토 표시한 세션입니다.</p>}
              {session.submit_reason && session.submit_reason !== 'manual' && <p className="mt-1 text-[12px] text-muted-foreground">제출 사유: {session.submit_reason}</p>}
            </div>
            <div>
              <h2 className="mb-2 text-[14px] font-bold">AI 에이전트 활용</h2>
              {data.agent ? (
                <ul className="space-y-0.5">
                  <li className="flex justify-between"><span>대화 턴</span><span className="tabular-nums">{data.agent.turns}회</span></li>
                  <li className="flex justify-between"><span>사용 토큰</span><span className="tabular-nums">{data.agent.tokens.toLocaleString()}</span></li>
                  <li className="flex justify-between"><span>제출 산출물</span><span className="tabular-nums">{data.agent.artifacts}개</span></li>
                </ul>
              ) : <p className="text-muted-foreground">에이전트 문항 없음</p>}
            </div>
          </section>

          {/* 문항별 */}
          <section className="mt-6 break-inside-auto">
            <h2 className="mb-2 text-[14px] font-bold">문항별 결과</h2>
            <table className="w-full border-collapse text-[12px]" data-testid="report-questions">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="w-8 py-1">#</th><th>문항</th><th className="w-16">유형</th><th className="w-20 text-right">점수</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} className="border-b align-top break-inside-avoid">
                    <td className="py-1.5">{r.order}</td>
                    <td className="py-1.5 pr-2">
                      <p>{r.title}</p>
                      {r.feedback && <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-3 print:line-clamp-none">{r.feedback}</p>}
                      {!r.answered && <p className="mt-0.5 text-[11px] text-red-700">미응답</p>}
                    </td>
                    <td className="py-1.5">{TYPE_LABEL[r.type] ?? r.type}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.score == null ? '미채점' : `${fmtNum(r.score)} / ${fmtNum(r.points)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <footer className="mt-6 border-t pt-3 text-[10.5px] leading-snug text-muted-foreground">
            이 리포트는 평가 결과를 요약한 참고 자료입니다. 서술형·실무형 문항 점수에는 AI 자동 채점이 포함될 수 있으며,
            채용·배치 등 최종 결정은 담당자가 원 답안과 감독 기록을 함께 검토해 내려야 합니다.
            개인정보가 포함되어 있으므로 평가 목적 외 사용·외부 공유를 금합니다.
          </footer>
        </article>
      </div>
    </div>
  );
}

function fmtNum(n: number) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

async function load(sessionId: string): Promise<ReportData> {
  const { data: session, error } = await supabase.from('exam_sessions').select('*, exams(*)').eq('id', sessionId).single();
  if (error || !session) throw new Error(error?.message ?? '세션을 찾을 수 없습니다');
  const exam = (session as any).exams;

  const [eqsR, ansR, profR, memR, emailR, cohortR, evR, agR, artR, orgR, glR] = await Promise.all([
    supabase.from('exam_questions').select('question_id, order_num, points_override').eq('exam_id', exam.id).order('order_num'),
    supabase.from('answers').select('question_id, score, feedback, content, file_url, file_paths, slot_values').eq('session_id', sessionId),
    supabase.from('profiles').select('name').eq('id', session.applicant_id).maybeSingle(),
    supabase.from('org_members').select('department, position, employee_no, display_name').eq('org_id', session.org_id).eq('user_id', session.applicant_id).maybeSingle(),
    (supabase as any).rpc('get_user_emails'),
    supabase.from('exam_sessions').select('score_total').eq('exam_id', exam.id).not('score_total', 'is', null),
    supabase.from('monitoring_events').select('event_type').eq('session_id', sessionId),
    supabase.from('exam_agent_sessions').select('turn_count, prompt_tokens, completion_tokens').eq('session_id', sessionId),
    supabase.from('exam_agent_artifacts').select('id, exam_agent_sessions!inner(session_id)').eq('exam_agent_sessions.session_id', sessionId).eq('submitted', true),
    supabase.from('organizations').select('name').eq('id', session.org_id).maybeSingle(),
    session.grade_level_id ? supabase.from('grade_levels').select('name, color').eq('id', session.grade_level_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const eqs = eqsR.data ?? [];
  const qIds = eqs.map(e => e.question_id);
  const [qR, linkR] = await Promise.all([
    qIds.length ? supabase.from('questions').select('id, content, type, points').in('id', qIds) : Promise.resolve({ data: [] as any[] }),
    qIds.length ? supabase.from('question_competencies').select('question_id, competency_id, weight').in('question_id', qIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const links = (linkR.data ?? []).map((l: any) => ({ ...l, weight: Number(l.weight ?? 1) }));
  const compIds = [...new Set(links.map((l: any) => l.competency_id))];
  // 상위 역량까지 올라가야 하므로 같은 프레임워크의 역량을 모두 읽는다
  let comps: CompetencyInfo[] = [];
  if (compIds.length) {
    const { data: direct } = await supabase.from('competencies').select('framework_id').in('id', compIds);
    const fwIds = [...new Set((direct ?? []).map(d => d.framework_id))];
    const { data: all } = await supabase.from('competencies').select('id, name, code, parent_id, sort_order').in('framework_id', fwIds);
    comps = (all ?? []) as CompetencyInfo[];
  }

  const qById = new Map((qR.data ?? []).map((q: any) => [q.id, q]));
  const ansByQ = new Map((ansR.data ?? []).map((a: any) => [a.question_id, a]));
  const rows: Row[] = eqs.map((e, i) => {
    const q: any = qById.get(e.question_id) ?? {};
    const a: any = ansByQ.get(e.question_id);
    const answered = !!a && !!(a.content || a.file_url || (Array.isArray(a.file_paths) && a.file_paths.length) || (a.slot_values && Object.keys(a.slot_values).length));
    return {
      id: e.question_id, order: e.order_num ?? i + 1,
      title: questionTitle(q.content, `문항 ${i + 1}`), type: q.type ?? '-',
      points: Number(e.points_override ?? q.points ?? 0),
      score: a?.score != null ? Number(a.score) : null,
      feedback: a?.feedback ?? null, answered,
    };
  });

  const events: Record<string, number> = {};
  for (const ev of evR.data ?? []) events[ev.event_type] = (events[ev.event_type] ?? 0) + 1;

  const ag = agR.data ?? [];
  const agent = ag.length ? {
    turns: ag.reduce((s, x: any) => s + (x.turn_count ?? 0), 0),
    tokens: ag.reduce((s, x: any) => s + (x.prompt_tokens ?? 0) + (x.completion_tokens ?? 0), 0),
    artifacts: (artR.data ?? []).length,
  } : null;

  const emailRow = (emailR.data ?? []).find((e: any) => (e.id ?? e.user_id) === session.applicant_id);
  return {
    session, exam,
    name: memR.data?.display_name || profR.data?.name || '(이름 없음)',
    email: emailRow?.email ?? '',
    member: memR.data, gradeLevel: (glR as any).data,
    rows, comps, links,
    cohort: (cohortR.data ?? []).map(s => Number(s.score_total)),
    events, agent, orgName: orgR.data?.name ?? '',
  };
}
