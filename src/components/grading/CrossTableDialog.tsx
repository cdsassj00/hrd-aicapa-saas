import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type QType = 'multiple_choice' | 'short_answer' | 'essay' | 'file_upload' | 'work_based';

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: '객관식',
  short_answer: '단답형',
  essay: '서술형',
  file_upload: '실기형',
  work_based: '작업형',
};

const TYPE_ORDER: QType[] = ['multiple_choice', 'short_answer', 'essay', 'file_upload', 'work_based'];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessions: any[];
  exams: Map<string, any>;
  profiles: Map<string, any>;
  emails: Map<string, string>;
}

const ANSWERS_PAGE_SIZE = 1000;
const SESSION_CHUNK_SIZE = 25;

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const fetchAnswersForSessionChunk = async (sessionIds: string[]) => {
  const rows: { session_id: string; question_id: string; score: number | null }[] = [];

  for (let from = 0; ; from += ANSWERS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('answers')
      .select('session_id,question_id,score')
      .in('session_id', sessionIds)
      .range(from, from + ANSWERS_PAGE_SIZE - 1);

    if (error) throw error;

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < ANSWERS_PAGE_SIZE) break;
  }

  return rows;
};

export default function CrossTableDialog({ open, onOpenChange, sessions, exams, profiles, emails }: Props) {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<any[]>([]); // unique questions across sessions
  const [examQuestionMap, setExamQuestionMap] = useState<Map<string, string[]>>(new Map()); // exam_id -> ordered qIds
  const [scoresBySession, setScoresBySession] = useState<Map<string, Map<string, number>>>(new Map());
  const { toast } = useToast();

  useEffect(() => {
    if (!open || sessions.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sessionIds = sessions.map(s => s.id);
        const examIds = [...new Set(sessions.map(s => s.exam_id))];
        const sessionChunks = chunk(sessionIds, SESSION_CHUNK_SIZE);

        const [eqsRes, ...ansResults] = await Promise.all([
          supabase.from('exam_questions').select('exam_id,question_id,order_num').in('exam_id', examIds).order('order_num'),
          ...sessionChunks.map(fetchAnswersForSessionChunk),
        ]);
        const eqs = eqsRes.data;
        const ans = ansResults.flat();
        if (cancelled) return;

        const eqMap = new Map<string, string[]>();
        (eqs || []).forEach((eq: any) => {
          if (!eqMap.has(eq.exam_id)) eqMap.set(eq.exam_id, []);
          eqMap.get(eq.exam_id)!.push(eq.question_id);
        });
        setExamQuestionMap(eqMap);

        const allQids = [...new Set((eqs || []).map((eq: any) => eq.question_id))];
        const { data: qs } = allQids.length > 0
          ? await supabase.from('questions').select('id,content,type,max_score,order_num').in('id', allQids)
          : { data: [] as any[] };
        setQuestions(qs || []);

        const sMap = new Map<string, Map<string, number>>();
        (ans || []).forEach((a: any) => {
          if (!sMap.has(a.session_id)) sMap.set(a.session_id, new Map());
          sMap.get(a.session_id)!.set(a.question_id, a.score ?? 0);
        });
        setScoresBySession(sMap);
      } catch (err: any) {
        if (!cancelled) toast({ title: '데이터 로드 실패', description: err.message, variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, sessions]);

  // Build columns: union of all question ids across exams in filter, ordered by exam then order_num
  const orderedQuestions = useMemo(() => {
    const seen = new Set<string>();
    const result: any[] = [];
    const qById = new Map(questions.map(q => [q.id, q]));
    examQuestionMap.forEach(qids => {
      qids.forEach(qid => {
        if (!seen.has(qid) && qById.has(qid)) {
          seen.add(qid);
          result.push(qById.get(qid));
        }
      });
    });
    // sort group by type order
    result.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
    return result;
  }, [questions, examQuestionMap]);

  const questionsByType = useMemo(() => {
    const map = new Map<string, any[]>();
    orderedQuestions.forEach(q => {
      if (!map.has(q.type)) map.set(q.type, []);
      map.get(q.type)!.push(q);
    });
    return map;
  }, [orderedQuestions]);

  const rows = useMemo(() => {
    return sessions.map(s => {
      const profile = profiles.get(s.applicant_id) || { name: '-', organization: '' };
      const exam = exams.get(s.exam_id);
      const email = emails.get(s.applicant_id) || '';
      const scoreMap = scoresBySession.get(s.id) || new Map();

      const perQ: Record<string, number | null> = {};
      orderedQuestions.forEach(q => {
        perQ[q.id] = scoreMap.has(q.id) ? scoreMap.get(q.id)! : null;
      });

      // Determine the question set for this session's exam (only questions actually in their exam)
      const examQids = new Set(examQuestionMap.get(s.exam_id) || []);
      const examQuestions = orderedQuestions.filter(q => examQids.has(q.id));

      const subtotals: Record<string, number> = {};
      const subtotalMax: Record<string, number> = {};
      TYPE_ORDER.forEach(t => {
        const list = examQuestions.filter(q => q.type === t);
        subtotals[t] = list.reduce((sum, q) => sum + (perQ[q.id] ?? 0), 0);
        subtotalMax[t] = list.reduce((sum, q) => sum + (q.max_score ?? 0), 0);
      });
      const total = Object.values(subtotals).reduce((a, b) => a + b, 0);
      const maxTotal = Object.values(subtotalMax).reduce((a, b) => a + b, 0);
      // 채점관리 리스트와 동일한 기준: DB에 저장된 score_total(정규화된 100점 환산값)을 사용.
      // 저장값이 없으면 (rawTotal / maxTotal * 100)으로 즉석 계산하여 폴백.
      const scaled = s.score_total != null
        ? s.score_total
        : (maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0);

      return { session: s, profile, exam, email, perQ, subtotals, subtotalMax, total, maxTotal, scaled };
    });
  }, [sessions, scoresBySession, orderedQuestions, questionsByType, examQuestionMap, profiles, exams, emails]);

  const handleCsv = () => {
    const headers: string[] = ['응시자', '이메일', '소속', '시험명'];
    const colDefs: { key: string; label: string }[] = [];
    TYPE_ORDER.forEach(t => {
      const list = questionsByType.get(t) || [];
      list.forEach((q, i) => {
        colDefs.push({ key: `q:${q.id}`, label: `${TYPE_LABEL[t]}${i + 1}(${q.max_score})` });
      });
      if (list.length > 0) colDefs.push({ key: `sub:${t}`, label: `${TYPE_LABEL[t]}소계` });
    });
    colDefs.push({ key: 'total', label: '원점수' });
    colDefs.push({ key: 'maxTotal', label: '만점' });
    colDefs.push({ key: 'scaled', label: '환산총점(100)' });
    headers.push(...colDefs.map(c => c.label));

    const escape = (v: any) => {
      const s = v == null ? '' : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const lines = [headers.join(',')];
    rows.forEach(r => {
      const row: any[] = [r.profile.name, r.email, r.profile.organization || '', r.exam?.title || ''];
      colDefs.forEach(c => {
        if (c.key === 'total') row.push(r.total);
        else if (c.key === 'maxTotal') row.push(r.maxTotal);
        else if (c.key === 'scaled') row.push(r.scaled);
        else if (c.key.startsWith('sub:')) {
          const t = c.key.slice(4);
          row.push(`${r.subtotals[t]}/${r.subtotalMax[t]}`);
        }
        else {
          const qid = c.key.slice(2);
          const v = r.perQ[qid];
          row.push(v == null ? '-' : v);
        }
      });
      lines.push(row.map(escape).join(','));
    });

    const csv = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `채점_크로스테이블_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const typeGroupCols = TYPE_ORDER.map(t => ({ type: t, list: questionsByType.get(t) || [] })).filter(g => g.list.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px]">
        <DialogHeader>
          <DialogTitle className="text-[14px]">크로스테이블 (응시자 × 문제별)</DialogTitle>
          <DialogDescription className="text-[12px]">
            현재 필터된 {sessions.length}명 · 유형별 소계와 총점을 확인하고 CSV로 내려받을 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button onClick={handleCsv} disabled={loading || rows.length === 0} className="gap-1.5 text-[12px]">
            <Download className="h-3.5 w-3.5" /> CSV 다운로드
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card className="overflow-auto max-h-[65vh]">
            <table className="text-[11px] border-collapse w-full">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th rowSpan={2} className="border px-2 py-1 text-left whitespace-nowrap sticky left-0 bg-muted/80 z-20">응시자</th>
                  <th rowSpan={2} className="border px-2 py-1 text-left whitespace-nowrap">이메일</th>
                  <th rowSpan={2} className="border px-2 py-1 text-left whitespace-nowrap">시험명</th>
                  {typeGroupCols.map(g => (
                    <th key={g.type} colSpan={g.list.length + 1} className="border px-2 py-1 text-center whitespace-nowrap">
                      {TYPE_LABEL[g.type]}
                    </th>
                  ))}
                  <th rowSpan={2} className="border px-2 py-1 text-center bg-muted/40 whitespace-nowrap">원점수</th>
                  <th rowSpan={2} className="border px-2 py-1 text-center bg-muted/40 whitespace-nowrap">만점</th>
                  <th rowSpan={2} className="border px-2 py-1 text-center bg-primary/10 whitespace-nowrap">환산<br/>(100)</th>
                </tr>
                <tr>
                  {typeGroupCols.map(g => (
                    <>
                      {g.list.map((q, i) => (
                        <th key={q.id} className="border px-2 py-1 text-center font-normal whitespace-nowrap" title={q.content}>
                          {i + 1}<span className="text-muted-foreground">({q.max_score})</span>
                        </th>
                      ))}
                      <th key={`${g.type}-sub`} className="border px-2 py-1 text-center bg-muted/40 whitespace-nowrap">소계</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const zebraBg = idx % 2 === 0 ? 'bg-background' : 'bg-muted/10';
                  return (
                  <tr key={r.session.id} className={`group ${zebraBg} hover:!bg-primary/10 transition-colors`}>
                    <td className={`border px-2 py-1 font-medium whitespace-nowrap sticky left-0 z-[1] ${zebraBg} group-hover:!bg-primary/10`}>{r.profile.name}</td>
                    <td className="border px-2 py-1 whitespace-nowrap">{r.email || '-'}</td>
                    <td className="border px-2 py-1 whitespace-nowrap max-w-[220px] truncate" title={r.exam?.title}>{r.exam?.title || '-'}</td>
                    {typeGroupCols.map(g => (
                      <>
                        {g.list.map(q => {
                          const v = r.perQ[q.id];
                          return (
                            <td key={q.id} className="border px-2 py-1 text-center tabular-nums">
                              {v == null ? <span className="text-muted-foreground">-</span> : v}
                            </td>
                          );
                        })}
                        <td key={`${g.type}-sub`} className="border px-2 py-1 text-center font-semibold bg-muted/30 tabular-nums">
                          {r.subtotals[g.type]}<span className="text-muted-foreground">/{r.subtotalMax[g.type]}</span>
                        </td>
                      </>
                    ))}
                    <td className="border px-2 py-1 text-center font-semibold bg-muted/20 tabular-nums">{r.total}</td>
                    <td className="border px-2 py-1 text-center text-muted-foreground bg-muted/20 tabular-nums">{r.maxTotal}</td>
                    <td className="border px-2 py-1 text-center font-bold bg-primary/5 tabular-nums">{r.scaled}</td>
                  </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={99} className="text-center text-muted-foreground py-8">데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}
