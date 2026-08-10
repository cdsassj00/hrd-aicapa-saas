import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import SetScenarioCard from '@/components/exam/SetScenarioCard';
import MarkdownView from '@/components/exam/MarkdownView';
import type { QuestionSet } from '@/lib/examStructure';
import { Eye, Paperclip } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  set: any | null;
  questions: any[];
}

/**
 * 관리자용: 응시생이 보게 될 화면(세트 시나리오 + 각 과목 본문)을 미리본다.
 * 실제 응시 페이지와 동일한 SetScenarioCard / MarkdownView 컴포넌트를 사용한다.
 */
export default function ApplicantPreviewDialog({ open, onOpenChange, set, questions }: Props) {
  if (!set) return null;

  const setForCard: QuestionSet = {
    id: set.id,
    exam_id: set.exam_id ?? null,
    title: set.title ?? '',
    scenario: set.scenario ?? '',
    attachments: Array.isArray(set.attachments) ? set.attachments : [],
    total_score: set.total_score ?? 0,
    computed_score: questions.reduce((s, q) => s + (q.max_score || 0), 0),
    order_num: set.order_num ?? 1,
    category: set.category ?? null,
    grade: set.grade ?? null,
    difficulty: set.difficulty ?? 'medium',
    tags: Array.isArray(set.tags) ? set.tags : [],
    proctoring_disabled: !!set.proctoring_disabled,
  };

  const ordered = [...questions].sort((a, b) => (a.set_order ?? 999) - (b.set_order ?? 999));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <Eye className="h-4 w-4 text-primary" />
            응시생 화면 미리보기
            <Badge variant="outline" className="text-[10px]">관리자 전용</Badge>
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            실제 응시 화면과 동일한 컴포넌트로 렌더링됩니다. 정답·채점기준은 표시되지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-4 bg-muted/20">
            <SetScenarioCard
              set={setForCard}
              questionPosition={{ current: 1, total: ordered.length }}
            />

            {ordered.map((q, idx) => {
              const slots = (q.submission_slots as any[]) || [];
              const atts = (q.attachments as any[]) || [];
              return (
                <div key={q.id} className="bg-card border rounded-lg p-5 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[11px]">
                      과목 {q.set_order ?? idx + 1} / {ordered.length}
                    </Badge>
                    {q.category && (
                      <Badge variant="outline" className="text-[11px]">{q.category}</Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground ml-auto">배점 {q.max_score}점</span>
                  </div>

                  <MarkdownView content={q.content} variant="question" className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />

                  {atts.length > 0 && (
                    <div className="p-2.5 rounded border bg-muted/30 space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                        <Paperclip className="h-3 w-3" /> 과목 첨부
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {atts.map((a: any, i: number) => (
                          <span key={i} className="text-[11px] text-primary">{a.name || `첨부 ${i + 1}`}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {slots.length > 0 && (
                    <div className="p-3 rounded border bg-background space-y-2">
                      <p className="text-[11px] font-semibold text-muted-foreground">제출란 ({slots.length}개)</p>
                      <div className="space-y-1.5">
                        {slots.map((s, i) => (
                          <div key={s.id || i} className="flex items-center gap-2 text-[12px] border-b last:border-b-0 pb-1.5 last:pb-0">
                            <Badge variant="outline" className="text-[10px] shrink-0">{s.type}</Badge>
                            <span className="flex-1">{s.label}</span>
                            {s.required && <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">필수</Badge>}
                            <span className="text-[11px] text-muted-foreground shrink-0">{s.max_score}점</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {ordered.length === 0 && (
              <div className="p-8 text-center text-[12px] text-muted-foreground bg-card border rounded-lg">
                이 세트에 등록된 과목(문제)이 없습니다.
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
