import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, Send, Bot, Loader2, Zap, Download, Search, Table2, ExternalLink, FileDown, Check, X, Package, Upload } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import CrossTableDialog from '@/components/grading/CrossTableDialog';
import { normalizeQuestion, getSlotValues, type SubmissionSlot, type NormalizedQuestion } from '@/lib/examStructure';
import { downloadAnswerBundle, importScoresCsv, type BundleProgress } from '@/lib/examBulkExport';

/** 자동채점: exact / numeric. 결과는 슬롯 만점 또는 0, 사람이 덮어쓸 수 있음. */
function autoGradeSlot(slot: SubmissionSlot, value: string): { score: number; matched: boolean } | null {
  if (!slot.auto_grade || slot.auto_grade === 'none') return null;
  const correct = slot.correct_answer;
  if (correct == null || correct === '') return null;
  const v = (value ?? '').toString().trim();
  if (slot.auto_grade === 'exact') {
    const matched = v === String(correct).trim();
    return { score: matched ? slot.max_score : 0, matched };
  }
  if (slot.auto_grade === 'numeric') {
    const num = parseFloat(v.replace(/,/g, ''));
    const target = parseFloat(String(correct));
    if (!isFinite(num) || !isFinite(target)) return { score: 0, matched: false };
    const tol = Number(slot.tolerance ?? 0);
    const matched = Math.abs(num - target) <= tol;
    return { score: matched ? slot.max_score : 0, matched };
  }
  return null;
}

export default function GradingPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [exams, setExams] = useState<Map<string, any>>(new Map());
  const [profiles, setProfiles] = useState<Map<string, any>>(new Map());
  const [emails, setEmails] = useState<Map<string, string>>(new Map());
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [answers, setAnswers] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  // ordered rows with normalized question
  const [detailRows, setDetailRows] = useState<Array<{ question: NormalizedQuestion | null; answer: any | null; order_num: number }>>([]);
  // key = answer_id (existing) OR `q:${question_id}` (missing answer placeholder)
  // per-slot scores: rowKey -> slotId -> number
  const [slotScores, setSlotScores] = useState<Record<string, Record<string, number>>>({});
  // per-question feedback
  const [feedbacks, setFeedbacks] = useState<Record<string, { feedback: string; isAi?: boolean }>>({});
  const [aiGrading, setAiGrading] = useState(false);
  const [bulkGrading, setBulkGrading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, currentName: '' });
  const [bundleDownloading, setBundleDownloading] = useState(false);
  const [bundleProgress, setBundleProgress] = useState<BundleProgress>({ phase: '', current: 0, total: 0 });
  const [importingScores, setImportingScores] = useState(false);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [examFilter, setExamFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [crossOpen, setCrossOpen] = useState(false);

  const { toast } = useToast();

  useEffect(() => { fetchSessions(); }, []);

  const fetchSessions = async () => {
    const { data } = await supabase
      .from('exam_sessions')
      .select('*')
      .in('status', ['submitted', 'passed', 'failed'])
      .order('submit_time', { ascending: false });
    if (data) {
      setSessions(data);
      const examIds = [...new Set(data.map(s => s.exam_id))];
      if (examIds.length > 0) {
        const { data: exData } = await supabase.from('exams').select('*').in('id', examIds);
        if (exData) setExams(new Map(exData.map(e => [e.id, e])));
      }
      const userIds = [...new Set(data.map(s => s.applicant_id))];
      if (userIds.length > 0) {
        const { data: profs } = await (supabase.from('profiles') as any).select('*').in('id', userIds);
        if (profs) setProfiles(new Map(profs.map((p: any) => [p.id, p])));
      }
      // Fetch emails via RPC
      const { data: emailData } = await (supabase as any).rpc('get_user_emails');
      if (emailData) setEmails(new Map(emailData.map((e: any) => [e.user_id, e.email])));
    }
  };

  const openDetail = async (sessionId: string) => {
    setSelectedSession(sessionId);
    const session = sessions.find(s => s.id === sessionId);

    const { data: eqs } = await supabase
      .from('exam_questions')
      .select('question_id, order_num')
      .eq('exam_id', session?.exam_id)
      .order('order_num', { ascending: true });
    const orderedEqs = eqs || [];
    const qIds = orderedEqs.map((eq: any) => eq.question_id);

    const [{ data: ans }, { data: qs }] = await Promise.all([
      supabase.from('answers').select('*').eq('session_id', sessionId),
      qIds.length > 0
        ? supabase.from('questions').select('*').in('id', qIds)
        : Promise.resolve({ data: [] }),
    ]);

    const answerList = ans || [];
    const questionList = qs || [];
    setAnswers(answerList);
    setQuestions(questionList);

    // Build ordered rows: include all exam_questions in order, even if no answer exists
    const ansByQ = new Map<string, any>();
    answerList.forEach(a => ansByQ.set(a.question_id, a));
    const rows = orderedEqs.map((eq: any, idx: number) => {
      const rawQ = questionList.find((q: any) => q.id === eq.question_id);
      const question = rawQ ? normalizeQuestion(rawQ) : null;
      const answer = ansByQ.get(eq.question_id) || null;
      return { question, answer, order_num: eq.order_num ?? idx + 1 };
    });
    setDetailRows(rows);

    const ss: Record<string, Record<string, number>> = {};
    const fb: Record<string, { feedback: string; isAi?: boolean }> = {};
    rows.forEach(r => {
      const key = r.answer ? r.answer.id : `q:${r.question?.id}`;
      const slots = r.question?.submission_slots ?? [];
      const savedSlotScores = (r.answer?.slot_scores && typeof r.answer.slot_scores === 'object' && !Array.isArray(r.answer.slot_scores))
        ? r.answer.slot_scores as Record<string, any>
        : null;
      const slotValues = getSlotValues(r.answer, slots);
      const perSlot: Record<string, number> = {};
      slots.forEach(slot => {
        if (savedSlotScores && savedSlotScores[slot.id] != null) {
          perSlot[slot.id] = Number(savedSlotScores[slot.id]) || 0;
        } else {
          // 자동채점 가능하면 미리 채워두고, 아니면 0
          const auto = autoGradeSlot(slot, slotValues[slot.id] ?? '');
          if (auto) perSlot[slot.id] = auto.score;
          else if (slots.length === 1 && r.answer?.score != null) {
            // 하위호환: 단일 슬롯이고 기존 score 있으면 그대로 사용
            perSlot[slot.id] = Number(r.answer.score) || 0;
          } else {
            perSlot[slot.id] = 0;
          }
        }
      });
      ss[key] = perSlot;
      const rawFb = r.answer?.feedback ?? (r.answer ? '' : '(미응답 - 0점 처리)');
      fb[key] = { feedback: rawFb, isAi: typeof rawFb === 'string' && rawFb.startsWith('[AI') };
    });
    setSlotScores(ss);
    setFeedbacks(fb);
    setDetailOpen(true);
  };

  const waitForJob = async (jobId: string, timeoutMs = 180000): Promise<any> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { data } = await (supabase.from('grading_jobs') as any).select('*').eq('id', jobId).maybeSingle();
      if (data && (data.status === 'completed' || data.status === 'failed')) return data;
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('채점 시간 초과 (3분). 백그라운드 작업이 계속 실행 중일 수 있습니다.');
  };

  const handleAiGrade = async () => {
    if (!selectedSession) return;
    setAiGrading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-grade', {
        body: { session_id: selectedSession },
      });
      if (error) throw error;
      const jobId = data?.job_id;
      if (!jobId) throw new Error('잡 ID를 받지 못했습니다');

      toast({ title: 'AI 채점 큐 등록', description: '백그라운드에서 처리 중입니다...' });
      const job = await waitForJob(jobId);
      if (job.status === 'failed') throw new Error(job.error_message || '채점 실패');

      toast({
        title: 'AI 채점 완료',
        description: `총점: ${job.result_total}점 → ${job.result_status === 'passed' ? '합격' : '불합격'}`,
      });

      await openDetail(selectedSession);
      fetchSessions();
    } catch (err: any) {
      toast({ title: 'AI 채점 실패', description: err.message, variant: 'destructive' });
    } finally {
      setAiGrading(false);
    }
  };

  const handleBulkGrade = async () => {
    const targets = filteredSessions.filter(s => s.status === 'submitted');
    if (targets.length === 0) {
      toast({ title: '채점 대상 없음', description: '필터 조건에 미채점 답안이 없습니다.' });
      return;
    }
    if (!confirm(`현재 필터 기준 미채점 ${targets.length}건을 큐에 등록하여 순차적으로 AI 채점합니다. 진행하시겠습니까?`)) return;

    setBulkGrading(true);
    setBulkProgress({ current: 0, total: targets.length, currentName: '' });
    let success = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      const profile = getProfile(s.applicant_id);
      setBulkProgress({ current: i + 1, total: targets.length, currentName: profile.name });
      try {
        const { data, error } = await supabase.functions.invoke('ai-grade', { body: { session_id: s.id } });
        if (error) throw error;
        const jobId = data?.job_id;
        if (!jobId) throw new Error('잡 ID 없음');
        const job = await waitForJob(jobId);
        if (job.status === 'failed') throw new Error(job.error_message || '실패');
        success++;
      } catch (err: any) {
        console.error(`채점 실패 (${profile.name}):`, err);
        failed++;
      }
    }

    toast({
      title: '전체 채점 완료',
      description: `성공: ${success}건 / 실패: ${failed}건`,
    });
    setBulkGrading(false);
    setBulkProgress({ current: 0, total: 0, currentName: '' });
    fetchSessions();
  };

  // 행별 합계 점수
  const rowTotalScore = (key: string) => {
    const m = slotScores[key] || {};
    return Object.values(m).reduce((s, v) => s + (Number(v) || 0), 0);
  };

  const handleSaveGrading = async () => {
    if (!selectedSession) return;
    for (const row of detailRows) {
      const key = row.answer ? row.answer.id : `q:${row.question?.id}`;
      const slotMap = slotScores[key] || {};
      const total = rowTotalScore(key);
      const fb = feedbacks[key]?.feedback ?? '';
      if (row.answer) {
        await supabase.from('answers').update({
          score: total,
          feedback: fb,
          slot_scores: slotMap as any,
        }).eq('id', row.answer.id);
      } else if (row.question?.id) {
        await supabase.from('answers').insert({
          session_id: selectedSession,
          question_id: row.question.id,
          content: '',
          score: total,
          feedback: fb || '(미응답 - 0점 처리)',
          slot_scores: slotMap as any,
        });
      }
    }
    const rawTotal = detailRows.reduce((sum, r) => {
      const key = r.answer ? r.answer.id : `q:${r.question?.id}`;
      return sum + rowTotalScore(key);
    }, 0);
    const maxPossible = detailRows.reduce(
      (sum, r) => sum + (r.question?.submission_slots?.reduce((s, sl) => s + (sl.max_score || 0), 0) || r.question?.max_score || 0),
      0,
    );
    const normalized = maxPossible > 0 ? Math.round((rawTotal / maxPossible) * 100) : 0;
    const session = sessions.find(s => s.id === selectedSession);
    const exam = exams.get(session?.exam_id);
    const passScore = exam?.pass_score ?? 75;
    const status = normalized >= passScore ? 'passed' : 'failed';
    await supabase.from('exam_sessions').update({ score_total: normalized, status }).eq('id', selectedSession!);

    toast({ title: '채점 저장 완료', description: `원점수 ${rawTotal}/${maxPossible} → 환산 ${normalized}/100점 (합격기준: ${passScore}점) → ${status === 'passed' ? '합격' : '불합격'}` });
    setDetailOpen(false);
    fetchSessions();
  };

  const getProfile = (applicantId: string) => profiles.get(applicantId) || { name: '알 수 없음', organization: '' };
  const getExam = (examId: string) => exams.get(examId);
  const getEmail = (applicantId: string) => emails.get(applicantId) || '';

  // Filtering
  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      if (examFilter !== 'all' && s.exam_id !== examFilter) return false;
      if (statusFilter !== 'all') {
        const exam = getExam(s.exam_id);
        const passScore = exam?.pass_score ?? 75;
        if (statusFilter === 'submitted' && s.status !== 'submitted') return false;
        if (statusFilter === 'passed' && !(s.score_total != null && s.score_total >= passScore)) return false;
        if (statusFilter === 'failed' && !(s.score_total != null && s.score_total < passScore)) return false;
      }
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const profile = getProfile(s.applicant_id);
        const exam = getExam(s.exam_id);
        const email = getEmail(s.applicant_id).toLowerCase();
        const hay = `${profile.name} ${profile.organization || ''} ${exam?.title || ''} ${email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, examFilter, statusFilter, searchText, exams, profiles, emails]);

  const examOptions = useMemo(() => {
    const map = new Map<string, string>();
    sessions.forEach(s => {
      const ex = exams.get(s.exam_id);
      if (ex) map.set(s.exam_id, ex.title);
    });
    return Array.from(map.entries());
  }, [sessions, exams]);

  const handleCsvDownload = () => {
    if (filteredSessions.length === 0) {
      toast({ title: '다운로드 불가', description: '필터 결과가 없습니다.' });
      return;
    }
    const headers = ['응시자', '이메일', '소속', '시험명', '제출시간(KST)', '합격기준', '총점', '결과'];
    const escape = (v: any) => {
      const s = v == null ? '' : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows = filteredSessions.map(s => {
      const profile = getProfile(s.applicant_id);
      const exam = getExam(s.exam_id);
      const passScore = exam?.pass_score ?? 75;
      const submitTime = s.submit_time
        ? new Date(s.submit_time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        : '';
      let result = '';
      if (s.status === 'submitted') result = '미채점';
      else if (s.score_total != null) result = s.score_total >= passScore ? '합격' : '불합격';
      return [
        profile.name,
        getEmail(s.applicant_id),
        profile.organization || '',
        exam?.title || '',
        submitTime,
        `${passScore}점`,
        s.score_total ?? '',
        result,
      ].map(escape).join(',');
    });
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `채점관리_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBundleDownload = async (mode: 'zip' | 'directory' = 'zip') => {
    if (filteredSessions.length === 0) {
      toast({ title: '다운로드 불가', description: '필터 결과가 없습니다.' });
      return;
    }
    if (mode === 'directory' && typeof (window as any).showDirectoryPicker !== 'function') {
      toast({
        title: '폴더 저장 미지원',
        description: '이 브라우저는 폴더 선택 저장을 지원하지 않습니다. Chrome/Edge 최신 버전을 사용하세요. ZIP 다운로드로 진행합니다.',
        variant: 'destructive',
      });
      mode = 'zip';
    }
    const desc = mode === 'directory'
      ? `필터된 ${filteredSessions.length}건을 선택한 폴더에 시험별로 저장합니다.\n계속하시겠습니까?`
      : `필터된 ${filteredSessions.length}건의 답안 + 첨부를 시험별 폴더 구조의 ZIP 하나로 다운로드합니다.\n계속하시겠습니까?`;
    if (!confirm(desc)) return;
    setBundleDownloading(true);
    setBundleProgress({ phase: '준비', current: 0, total: 0 });
    try {
      await downloadAnswerBundle({
        sessions: filteredSessions,
        exams,
        profiles,
        emails,
        saveMode: mode,
        onProgress: (p) => setBundleProgress(p),
      });
      toast({ title: mode === 'directory' ? '선택 폴더 저장 완료' : '답안+첨부 ZIP 다운로드 완료' });
    } catch (e: any) {
      toast({ title: '다운로드 실패', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setBundleDownloading(false);
      setBundleProgress({ phase: '', current: 0, total: 0 });
    }
  };


  const handleScoresCsvUpload = async (file: File) => {
    setImportingScores(true);
    try {
      const text = await file.text();
      const result = await importScoresCsv(text);
      toast({
        title: '채점 CSV 반영 완료',
        description: `답안 ${result.updated_answers}건 · 세션 ${result.updated_sessions}건 갱신${result.errors.length > 0 ? ` · 오류 ${result.errors.length}건` : ''}`,
      });
      if (result.errors.length > 0) {
        console.warn('[importScoresCsv] errors:', result.errors);
      }
      await fetchSessions();
    } catch (e: any) {
      toast({ title: '업로드 실패', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setImportingScores(false);
    }
  };

  const currentTotal = detailRows.reduce((sum, r) => {
    const key = r.answer ? r.answer.id : `q:${r.question?.id}`;
    return sum + rowTotalScore(key);
  }, 0);
  const currentSession = sessions.find(s => s.id === selectedSession);
  const currentExam = currentSession ? getExam(currentSession.exam_id) : null;
  const currentPassScore = currentExam?.pass_score ?? 75;
  const maxTotal = detailRows.reduce(
    (sum, r) => sum + (r.question?.submission_slots?.reduce((s, sl) => s + (sl.max_score || 0), 0) || r.question?.max_score || 0),
    0,
  );

  const submittedCount = filteredSessions.filter(s => s.status === 'submitted').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1>채점 관리</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setCrossOpen(true)}
            disabled={filteredSessions.length === 0}
            className="gap-1.5 text-[12px]"
          >
            <Table2 className="h-3.5 w-3.5" />
            크로스테이블 ({filteredSessions.length})
          </Button>
          <Button
            variant="outline"
            onClick={handleCsvDownload}
            className="gap-1.5 text-[12px]"
          >
            <Download className="h-3.5 w-3.5" />
            CSV 다운로드 ({filteredSessions.length})
          </Button>
          <Button
            variant="outline"
            onClick={() => handleBundleDownload('zip')}
            disabled={bundleDownloading || filteredSessions.length === 0}
            className="gap-1.5 text-[12px]"
            title="시험별 폴더 구조로 답안+첨부를 하나의 ZIP으로 다운로드"
          >
            {bundleDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
            {bundleDownloading
              ? `${bundleProgress.phase} ${bundleProgress.current}/${bundleProgress.total}`
              : `답안+첨부 ZIP (${filteredSessions.length})`}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleBundleDownload('directory')}
            disabled={bundleDownloading || filteredSessions.length === 0}
            className="gap-1.5 text-[12px]"
            title="다운로드 폴더를 직접 지정하여 시험별 폴더 구조로 저장 (Chrome/Edge 계열)"
          >
            <Download className="h-3.5 w-3.5" />
            폴더 지정 저장
          </Button>

          <label className="inline-flex">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={importingScores}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleScoresCsvUpload(f);
                e.currentTarget.value = '';
              }}
            />
            <Button
              asChild
              variant="outline"
              disabled={importingScores}
              className="gap-1.5 text-[12px] cursor-pointer"
              title="외부 AI 에이전트가 채점한 scores CSV 를 업로드하면 answers.slot_scores / score / feedback + 세션 총점이 반영됩니다."
            >
              <span>
                {importingScores ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importingScores ? '반영 중...' : '채점 CSV 업로드'}
              </span>
            </Button>
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  onClick={handleBulkGrade}
                  disabled={bulkGrading || submittedCount === 0}
                  className="gap-1.5 text-[12px]"
                >
                  {bulkGrading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  {bulkGrading
                    ? `채점 중 ${bulkProgress.current}/${bulkProgress.total}${bulkProgress.currentName ? ` · ${bulkProgress.currentName}` : ''}`
                    : `필터내 AI 채점 (${submittedCount}건)`}
                </Button>
              </span>
            </TooltipTrigger>
            {submittedCount === 0 && !bulkGrading && (
              <TooltipContent className="text-[11px] max-w-[260px]">
                미채점(상태=submitted) 답안이 0건입니다. 상태 필터를 <b>전체</b> 또는 <b>미채점</b>으로 변경하거나, 이미 채점된 시험이 아닌지 확인해 주세요.
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>

      {bundleDownloading && (
        <Card className="p-3 space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{bundleProgress.phase}</span>
            <span>{bundleProgress.current} / {bundleProgress.total}</span>
          </div>
          <Progress value={bundleProgress.total > 0 ? (bundleProgress.current / bundleProgress.total) * 100 : 0} className="h-2" />
        </Card>
      )}

      {/* Filters */}
      <Card className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="이름/이메일/소속/시험명 검색"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="h-8 text-[12px] pl-7"
            />
          </div>
          <Select value={examFilter} onValueChange={setExamFilter}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="시험 선택" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">전체 시험</SelectItem>
              {examOptions.map(([id, title]) => (
                <SelectItem key={id} value={id} className="text-[12px]">{title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="상태 선택" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">전체 상태</SelectItem>
              <SelectItem value="submitted" className="text-[12px]">미채점</SelectItem>
              <SelectItem value="passed" className="text-[12px]">합격</SelectItem>
              <SelectItem value="failed" className="text-[12px]">불합격</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          전체 {sessions.length}건 중 {filteredSessions.length}건 표시
        </div>
      </Card>

      {bulkGrading && (
        <Card className="p-3 space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>순차 채점 진행 중...</span>
            <span>{bulkProgress.current} / {bulkProgress.total}</span>
          </div>
          <Progress value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0} className="h-2" />
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[12px]">응시자</TableHead>
              <TableHead className="text-[12px]">이메일</TableHead>
              <TableHead className="text-[12px]">시험명</TableHead>
              <TableHead className="text-[12px]">소속</TableHead>
              <TableHead className="text-[12px]">제출 시간</TableHead>
              <TableHead className="text-[12px]">합격기준</TableHead>
              <TableHead className="text-[12px]">총점</TableHead>
              <TableHead className="text-[12px]">결과</TableHead>
              <TableHead className="text-[12px]">상세</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSessions.map(s => {
              const profile = getProfile(s.applicant_id);
              const exam = getExam(s.exam_id);
              const passScore = exam?.pass_score ?? 75;
              const email = getEmail(s.applicant_id);
              return (
                <TableRow key={s.id}>
                  <TableCell className="text-[12px] font-medium whitespace-nowrap">{profile.name}</TableCell>
                  <TableCell className="text-[12px] whitespace-nowrap">{email || '-'}</TableCell>
                  <TableCell className="text-[12px]">{exam?.title || '-'}</TableCell>
                  <TableCell className="text-[12px]">{profile.organization}</TableCell>
                  <TableCell className="text-[12px] whitespace-nowrap">{s.submit_time ? new Date(s.submit_time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}</TableCell>
                  <TableCell className="text-[12px]">{passScore}점</TableCell>
                  <TableCell className="text-[12px] font-bold">{s.score_total ?? '-'}</TableCell>
                  <TableCell>
                    {s.score_total != null && (
                      <Badge variant={s.score_total >= passScore ? 'default' : 'destructive'} className="text-[10px]">
                        {s.score_total >= passScore ? '합격' : '불합격'}
                      </Badge>
                    )}
                    {s.status === 'submitted' && <Badge variant="secondary" className="text-[10px]">미채점</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(s.id)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredSessions.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-[12px] text-muted-foreground py-8">조건에 맞는 답안이 없습니다</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="text-[14px]">답안 채점</DialogTitle>
            <DialogDescription className="text-[12px]">
              {selectedSession && getProfile(currentSession?.applicant_id || '').name}
              {currentSession && getEmail(currentSession.applicant_id) && ` · ${getEmail(currentSession.applicant_id)}`}
              {currentExam && ` · ${currentExam.title}`}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium">현재 총점</span>
              <span className="text-[16px] font-bold">
                {maxTotal > 0 ? Math.round((currentTotal / maxTotal) * 100) : 0}
                <span className="text-[12px] text-muted-foreground">/100점 환산</span>
                <span className="text-[11px] ml-2 text-muted-foreground">(원점수 {currentTotal}/{maxTotal} · 합격기준 {currentPassScore}점)</span>
              </span>
            </div>
            <Progress value={maxTotal > 0 ? (currentTotal / maxTotal) * 100 : 0} className="h-2" />
            <div className="flex justify-end">
              {(() => {
                const scaled = maxTotal > 0 ? Math.round((currentTotal / maxTotal) * 100) : 0;
                const pass = scaled >= currentPassScore;
                return (
                  <Badge variant={pass ? 'default' : 'destructive'} className="text-[10px]">
                    {pass ? '합격 예정' : '불합격 예정'}
                  </Badge>
                );
              })()}
            </div>
          </div>

          <div className="space-y-4 max-h-[500px] overflow-auto">
            {detailRows.map((row) => {
              const question = row.question;
              const key = row.answer ? row.answer.id : `q:${question?.id}`;
              const isAiFeedback = !!feedbacks[key]?.isAi;
              const isMissing = !row.answer;
              const slots = question?.submission_slots ?? [];
              const slotValues = getSlotValues(row.answer, slots);
              const qMax = slots.reduce((s, sl) => s + (sl.max_score || 0), 0) || question?.max_score || 0;
              const qTotal = rowTotalScore(key);
              return (
                <Card key={key} className={`p-4 space-y-3 ${isMissing ? 'border-destructive/40 bg-destructive/5' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3>문제 {row.order_num}</h3>
                      <Badge variant="outline" className="text-[10px]">{question?.type === 'multiple_choice' ? '객관식' : question?.type === 'short_answer' ? '단답형' : question?.type === 'essay' ? '서술형' : question?.type === 'file_upload' ? '실기형' : '작업형'}</Badge>
                      {question?.category && <Badge variant="outline" className="text-[10px]">{question.category}</Badge>}
                      {isMissing && <Badge variant="destructive" className="text-[10px]">미응답</Badge>}
                    </div>
                    <span className="text-[11px] font-semibold">
                      {qTotal}<span className="text-muted-foreground">/{qMax}점</span>
                    </span>
                  </div>
                  <div className="bg-muted/30 p-3 rounded text-[12px] max-h-[120px] overflow-auto whitespace-pre-wrap">{question?.content}</div>

                  {/* 슬롯별 채점 */}
                  <div className="space-y-2">
                    {slots.map((slot) => {
                      const val = slotValues[slot.id] ?? '';
                      const auto = autoGradeSlot(slot, val);
                      const slotScore = slotScores[key]?.[slot.id] ?? 0;
                      const isUrl = slot.type === 'url';
                      const isFile = slot.type === 'file';
                      return (
                        <div key={slot.id} className="border rounded-md p-3 space-y-2 bg-background">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[12px] font-medium">{slot.label}</span>
                              <Badge variant="outline" className="text-[9px]">{slot.type}</Badge>
                              {slot.auto_grade && slot.auto_grade !== 'none' && (
                                <Badge variant="secondary" className="text-[9px]">자동: {slot.auto_grade}</Badge>
                              )}
                              {auto && (
                                <Badge variant={auto.matched ? 'default' : 'destructive'} className="text-[9px] gap-0.5">
                                  {auto.matched ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                                  {auto.matched ? '정답' : '오답'}
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">배점 {slot.max_score}점</span>
                          </div>

                          {/* 응시자 입력값 */}
                          <div className="bg-muted/40 rounded p-2 text-[12px] break-all">
                            <span className="text-[10px] text-muted-foreground block mb-1">응시자 입력</span>
                            {!val ? (
                              <span className="text-muted-foreground italic">(미입력)</span>
                            ) : isUrl ? (
                              <a href={val} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                {val} <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : isFile ? (
                              (() => {
                                const rawName = val.split('/').pop() || 'file';
                                // base64url 인코딩된 원본 이름 복원
                                const decodeOriginal = (n: string): string => {
                                  try {
                                    const m = n.match(/_n-([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$/);
                                    if (!m) return n.split('_').slice(2).join('_') || n;
                                    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
                                    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
                                    const bin = atob(padded);
                                    const bytes = new Uint8Array(bin.length);
                                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                                    return new TextDecoder().decode(bytes);
                                  } catch { return n; }
                                };
                                const fileName = decodeOriginal(rawName);
                                const isCsv = /\.csv$/i.test(fileName);
                                const isHtml = /\.x?html?$/i.test(fileName);
                                const getUrl = async () => {
                                  const isHttp = /^https?:\/\//i.test(val);
                                  if (isHttp) return val;
                                  const { data, error } = await supabase.storage.from('answer-files').createSignedUrl(val, 600);
                                  if (error || !data?.signedUrl) throw new Error(error?.message || '경로를 찾을 수 없습니다.');
                                  return data.signedUrl;
                                };
                                const triggerDownload = (blob: Blob, name: string) => {
                                  const objUrl = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = objUrl; a.download = name;
                                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                  URL.revokeObjectURL(objUrl);
                                };
                                const openFile = async () => {
                                  try {
                                    const url = await getUrl();
                                    if (isHtml) {
                                      // HTML은 text/html Blob URL로 새 탭에서 렌더링 (스토리지가 octet-stream으로 내려보내 다운로드되는 문제 회피)
                                      const res = await fetch(url);
                                      const text = await res.text();
                                      const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
                                      const blobUrl = URL.createObjectURL(blob);
                                      const win = window.open(blobUrl, '_blank', 'noopener');
                                      if (!win) {
                                        toast({ title: '팝업이 차단되었습니다', description: '브라우저 팝업 허용 후 다시 시도해주세요.', variant: 'destructive' });
                                      }
                                      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
                                      return;
                                    }
                                    window.open(url, '_blank', 'noopener');
                                  } catch (e: any) {
                                    toast({ title: '파일 열기 실패', description: e.message, variant: 'destructive' });
                                  }
                                };
                                const downloadCsv = async () => {
                                  try {
                                    const url = await getUrl();
                                    const res = await fetch(url);
                                    const buf = await res.arrayBuffer();
                                    const bytes = new Uint8Array(buf);
                                    const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
                                    const hasUtf16Bom = (bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF);
                                    let outBlob: Blob;
                                    if (hasUtf8Bom || hasUtf16Bom) {
                                      outBlob = new Blob([buf], { type: 'text/csv;charset=utf-8;' });
                                    } else {
                                      const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
                                      outBlob = new Blob([bom, buf], { type: 'text/csv;charset=utf-8;' });
                                    }
                                    triggerDownload(outBlob, fileName);
                                  } catch (e: any) {
                                    toast({ title: '다운로드 실패', description: e.message, variant: 'destructive' });
                                  }
                                };
                                return (
                                  <div className="inline-flex items-center gap-2 flex-wrap">
                                    <button type="button" onClick={openFile} className="text-primary hover:underline inline-flex items-center gap-1">
                                      <FileDown className="h-3 w-3" /> {isHtml ? 'HTML 렌더링 보기' : '파일 열기'}
                                    </button>
                                    {isCsv && (
                                      <button type="button" onClick={downloadCsv} className="text-primary hover:underline inline-flex items-center gap-1 text-[11px]">
                                        [Excel용 UTF-8 다운로드]
                                      </button>
                                    )}
                                    <span className="text-[10px] text-muted-foreground truncate max-w-[280px]">({fileName})</span>
                                  </div>
                                );
                              })()
                            ) : (
                              <span className="whitespace-pre-wrap">{val}</span>
                            )}
                          </div>

                          {/* 정답/채점기준 */}
                          {(slot.correct_answer != null && slot.correct_answer !== '') && (
                            <div className="text-[11px]">
                              <span className="text-muted-foreground">정답: </span>
                              <span className="font-medium">{String(slot.correct_answer)}</span>
                              {slot.auto_grade === 'numeric' && slot.tolerance != null && (
                                <span className="text-muted-foreground"> (±{slot.tolerance})</span>
                              )}
                            </div>
                          )}
                          {slot.rubric && (
                            <div className="text-[11px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2 whitespace-pre-wrap">
                              <span className="text-amber-700 dark:text-amber-400 font-medium">채점기준: </span>
                              {slot.rubric}
                            </div>
                          )}

                          {/* 슬롯 점수 입력 */}
                          <div className="flex items-center gap-2">
                            <label className="text-[11px] text-muted-foreground whitespace-nowrap">점수</label>
                            <Input
                              type="number"
                              value={slotScore}
                              onChange={e => setSlotScores(prev => ({
                                ...prev,
                                [key]: { ...(prev[key] || {}), [slot.id]: +e.target.value },
                              }))}
                              className="h-7 text-[12px] w-24"
                              max={slot.max_score}
                              min={0}
                            />
                            <span className="text-[10px] text-muted-foreground">/ {slot.max_score}</span>
                            {auto && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[10px] ml-auto"
                                onClick={() => setSlotScores(prev => ({
                                  ...prev,
                                  [key]: { ...(prev[key] || {}), [slot.id]: auto.score },
                                }))}
                              >
                                자동채점 적용
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 문제 전체 피드백 */}
                  <div className="space-y-1">
                    <label className="text-[12px] font-medium flex items-center gap-1">
                      문제 피드백
                      {isAiFeedback && <Badge variant="secondary" className="text-[9px] px-1 py-0"><Bot className="h-3 w-3 mr-0.5" />AI</Badge>}
                    </label>
                    <Textarea
                      value={feedbacks[key]?.feedback || ''}
                      onChange={e => setFeedbacks(prev => ({ ...prev, [key]: { ...prev[key], feedback: e.target.value, isAi: false } }))}
                      className="text-[12px] h-16 min-h-[40px]"
                    />
                  </div>
                </Card>
              );
            })}
            {detailRows.length === 0 && <p className="text-[12px] text-muted-foreground text-center py-8">문항이 없습니다</p>}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="gap-1.5 text-[12px]"
              onClick={handleAiGrade}
              disabled={aiGrading || detailRows.length === 0}
            >
              {aiGrading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
              {aiGrading ? 'AI 채점 중...' : 'AI 자동 채점'}
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={() => setDetailOpen(false)}>닫기</Button>
              <Button onClick={handleSaveGrading} className="gap-1">
                <Send className="h-3.5 w-3.5" /> 채점 저장
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CrossTableDialog
        open={crossOpen}
        onOpenChange={setCrossOpen}
        sessions={filteredSessions}
        exams={exams}
        profiles={profiles}
        emails={emails}
      />
    </div>
  );
}
