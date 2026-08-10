import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface ExamOption { id: string; title: string; grade: string }
interface GradeStat { grade: string; applicants: number; passed: number; rate: number }
interface MonthlyTrend { month: string; count: number }
interface OrgStat { org: string; green: number; blue: number; black: number; '전문인재': number }
interface CategoryAvg { category: string; avg: number; max: number }

const gradeMap: Record<string, string> = { green: '그린', blue: '블루', black: '블랙', '전문인재': '전문인재' };

export default function StatsPage() {
  const [loading, setLoading] = useState(true);
  const [examOptions, setExamOptions] = useState<ExamOption[]>([]);
  const [selectedExam, setSelectedExam] = useState<string>('all');
  const [gradeStats, setGradeStats] = useState<GradeStat[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyTrend[]>([]);
  const [orgStats, setOrgStats] = useState<OrgStat[]>([]);
  const [categoryAvg, setCategoryAvg] = useState<CategoryAvg[]>([]);

  useEffect(() => {
    supabase.from('exams').select('id, title, grade').order('exam_date', { ascending: false })
      .then(({ data }) => { if (data) setExamOptions(data); });
  }, []);

  useEffect(() => { fetchStats(); }, [selectedExam]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchGradeStats(),
        fetchMonthlyTrend(),
        fetchOrgStats(),
        fetchCategoryAvg(),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchGradeStats = async () => {
    let sessionsQuery = supabase.from('exam_sessions').select('status, exam_id');
    if (selectedExam !== 'all') sessionsQuery = sessionsQuery.eq('exam_id', selectedExam);
    const { data: sessions } = await sessionsQuery;

    const { data: exams } = await supabase.from('exams').select('id, grade');
    if (!sessions || !exams) return;

    const examGradeMap = Object.fromEntries(exams.map(e => [e.id, e.grade]));
    const stats: Record<string, { applicants: number; passed: number }> = {
      green: { applicants: 0, passed: 0 },
      blue: { applicants: 0, passed: 0 },
      black: { applicants: 0, passed: 0 },
      '전문인재': { applicants: 0, passed: 0 },
    };

    for (const s of sessions) {
      const grade = examGradeMap[s.exam_id];
      if (!grade || !stats[grade]) continue;
      stats[grade].applicants++;
      if (s.status === 'passed') stats[grade].passed++;
    }

    setGradeStats(Object.entries(stats)
      .filter(([, v]) => selectedExam === 'all' || v.applicants > 0)
      .map(([g, v]) => ({
        grade: gradeMap[g] || g,
        applicants: v.applicants,
        passed: v.passed,
        rate: v.applicants > 0 ? Math.round((v.passed / v.applicants) * 100) : 0,
      })));
  };

  const fetchMonthlyTrend = async () => {
    let query = supabase.from('certifications').select('issued_at, exam_id').eq('status', 'valid');
    if (selectedExam !== 'all') query = query.eq('exam_id', selectedExam);
    const { data: certs } = await query;
    if (!certs) return;

    const monthMap: Record<string, number> = {};
    for (const c of certs) {
      const month = c.issued_at.substring(0, 7);
      monthMap[month] = (monthMap[month] || 0) + 1;
    }

    setMonthlyTrend(
      Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }))
    );
  };

  const fetchOrgStats = async () => {
    let query = supabase.from('certifications').select('applicant_id, grade, status, exam_id').eq('status', 'valid');
    if (selectedExam !== 'all') query = query.eq('exam_id', selectedExam);
    const { data: certs } = await query;
    const { data: profiles } = await supabase.from('profiles').select('id, organization');
    if (!certs || !profiles) return;

    const profileMap = Object.fromEntries(profiles.map(p => [p.id, p.organization || '미지정']));
    const orgMap: Record<string, { green: number; blue: number; black: number; '전문인재': number }> = {};

    for (const c of certs) {
      const org = profileMap[c.applicant_id] || '미지정';
      if (!orgMap[org]) orgMap[org] = { green: 0, blue: 0, black: 0, '전문인재': 0 };
      const g = c.grade as string;
      if (g in orgMap[org]) (orgMap[org] as any)[g]++;
    }

    setOrgStats(
      Object.entries(orgMap)
        .map(([org, v]) => ({ org, ...v }))
        .sort((a, b) => (b.green + b.blue + b.black + b['전문인재']) - (a.green + a.blue + a.black + a['전문인재']))
    );
  };

  const fetchCategoryAvg = async () => {
    // Get session IDs for the selected exam filter
    let sessionIds: string[] | null = null;
    if (selectedExam !== 'all') {
      const { data: sessions } = await supabase.from('exam_sessions').select('id').eq('exam_id', selectedExam);
      sessionIds = sessions?.map(s => s.id) || [];
      if (sessionIds.length === 0) { setCategoryAvg([]); return; }
    }

    let answersQuery = supabase.from('answers').select('question_id, score, session_id');
    if (sessionIds) answersQuery = answersQuery.in('session_id', sessionIds);
    const { data: answers } = await answersQuery;
    const { data: questions } = await supabase.from('questions').select('id, category, max_score');
    if (!answers || !questions) return;

    const qMap = Object.fromEntries(questions.map(q => [q.id, q]));
    const catAcc: Record<string, { total: number; count: number; maxTotal: number }> = {};

    for (const a of answers) {
      const q = qMap[a.question_id];
      if (!q || a.score == null) continue;
      if (!catAcc[q.category]) catAcc[q.category] = { total: 0, count: 0, maxTotal: 0 };
      catAcc[q.category].total += a.score;
      catAcc[q.category].count++;
      catAcc[q.category].maxTotal += q.max_score;
    }

    setCategoryAvg(
      Object.entries(catAcc).map(([category, v]) => ({
        category,
        avg: v.count > 0 ? Math.round((v.total / v.count) * 10) / 10 : 0,
        max: v.count > 0 ? Math.round(v.maxTotal / v.count) : 0,
      }))
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1>통계 대시보드</h1>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-72 rounded-lg" />)}
        </div>
      </div>
    );
  }

  const hasData = gradeStats.some(g => g.applicants > 0) || monthlyTrend.length > 0 || orgStats.length > 0 || categoryAvg.length > 0;
  const selectedExamInfo = examOptions.find(e => e.id === selectedExam);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>통계 대시보드</h1>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">시험 필터:</span>
          <Select value={selectedExam} onValueChange={setSelectedExam}>
            <SelectTrigger className="w-[280px] text-[12px] h-8">
              <SelectValue placeholder="시험 선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">전체 시험</SelectItem>
              {examOptions.map(e => (
                <SelectItem key={e.id} value={e.id} className="text-[12px]">
                  <span className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{gradeMap[e.grade]}</Badge>
                    {e.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedExamInfo && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">{gradeMap[selectedExamInfo.grade]} 등급</Badge>
          <span>"{selectedExamInfo.title}" 기준 통계</span>
        </div>
      )}

      {!hasData && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            {selectedExam === 'all'
              ? '아직 통계 데이터가 없습니다. 시험 세션과 채점 결과가 쌓이면 여기에 표시됩니다.'
              : '선택한 시험에 대한 통계 데이터가 없습니다.'}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        {gradeStats.map(g => (
          <Card key={g.grade}>
            <CardContent className="p-4 text-center">
              <p className="text-[12px] text-muted-foreground">{g.grade} 등급</p>
              <p className="text-[28px] font-bold">{g.rate}%</p>
              <p className="text-[11px] text-muted-foreground">합격률 ({g.passed}/{g.applicants}명)</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[14px]">등급별 응시자 / 합격자</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={gradeStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="grade" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="applicants" name="응시자" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="passed" name="합격자" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[14px]">월별 인증자 추이</CardTitle></CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" name="인증자 수" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">인증 데이터 없음</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[14px]">기관별 인증자 현황</CardTitle></CardHeader>
          <CardContent>
            {orgStats.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[12px]">기관</TableHead>
                    <TableHead className="text-[12px]">그린</TableHead>
                    <TableHead className="text-[12px]">블루</TableHead>
                    <TableHead className="text-[12px]">블랙</TableHead>
                    <TableHead className="text-[12px]">전문인재</TableHead>
                    <TableHead className="text-[12px]">합계</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgStats.map(o => (
                    <TableRow key={o.org}>
                      <TableCell className="text-[12px] font-medium">{o.org}</TableCell>
                      <TableCell className="text-[12px]">{o.green}</TableCell>
                      <TableCell className="text-[12px]">{o.blue}</TableCell>
                      <TableCell className="text-[12px]">{o.black}</TableCell>
                      <TableCell className="text-[12px]">{o['전문인재']}</TableCell>
                      <TableCell className="text-[12px] font-bold">{o.green + o.blue + o.black + o['전문인재']}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">인증 데이터 없음</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[14px]">카테고리별 평균 점수</CardTitle></CardHeader>
          <CardContent>
            {categoryAvg.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={categoryAvg} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="avg" name="평균" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="max" name="만점" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">채점 데이터 없음</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
