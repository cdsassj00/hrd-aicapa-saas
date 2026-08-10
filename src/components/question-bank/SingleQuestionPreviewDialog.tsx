import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import MarkdownView from '@/components/exam/MarkdownView';
import McAnswerSelector from '@/components/exam/McAnswerSelector';
import { Eye, Paperclip, Upload } from 'lucide-react';
import { questionTypeLabels, questionTypeColors, categoryColors, difficultyColors, difficultyLabels } from '@/components/question-bank/questionTypes';
import { GradeBadge } from '@/components/GradeBadge';
import { cn } from '@/lib/utils';
import type { QuestionType, QuestionDifficulty } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  question: any | null;
}

/**
 * 단독 문제 응시자용 미리보기.
 * 파싱·렌더링·제출란 구성을 응시 화면과 동일한 컴포넌트로 확인한다.
 * (정답·채점기준은 표시하지 않음)
 */
export default function SingleQuestionPreviewDialog({ open, onOpenChange, question }: Props) {
  if (!question) return null;
  const q = question;
  const atts = (q.attachments as any[]) || [];
  const slots = (q.submission_slots as any[]) || [];
  const opts = (q.options as any[]) || [];
  const mcOptions = opts.map((o: any, i: number) => ({
    label: o?.text ?? '',
    value: String(i + 1),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] h-[90vh] p-0 flex flex-col overflow-hidden">
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
            <div className="bg-card border rounded-lg p-5 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn("text-[11px]", questionTypeColors[q.type as QuestionType] || '')}>
                  {questionTypeLabels[q.type as QuestionType] || q.type}
                </Badge>
                {q.category && (
                  <Badge variant="outline" className={cn("text-[11px]", categoryColors[q.category] || '')}>{q.category}</Badge>
                )}
                {q.difficulty && (
                  <Badge variant="outline" className={cn("text-[11px]", difficultyColors[q.difficulty as QuestionDifficulty] || '')}>
                    {difficultyLabels[q.difficulty as QuestionDifficulty] || q.difficulty}
                  </Badge>
                )}
                {q.grade && <GradeBadge grade={q.grade} className="text-[10px]" />}
                {((q.tags || []) as string[]).map((t: string) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>
                ))}
                <span className="text-[11px] text-muted-foreground ml-auto">배점 {q.max_score}점</span>
              </div>

              <MarkdownView content={q.content} variant="question" className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />

              {atts.length > 0 && (
                <div className="p-2.5 rounded border bg-muted/30 space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                    <Paperclip className="h-3 w-3" /> 문제 첨부파일
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {atts.map((a: any, i: number) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary underline underline-offset-2 hover:opacity-80"
                      >
                        {a.name || `첨부 ${i + 1}`}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 응시자 답안 영역 (미리보기 - 비활성/장식용) */}
            <div className="bg-card border rounded-lg p-5 space-y-3">
              <p className="text-[12px] font-semibold text-muted-foreground">답안 영역 (미리보기)</p>

              {q.type === 'multiple_choice' && (
                mcOptions.length > 0 ? (
                  <McAnswerSelector options={mcOptions} selected="" onChange={() => {}} />
                ) : (
                  <p className="text-[11px] text-destructive">⚠ 객관식 보기가 등록되지 않았습니다.</p>
                )
              )}

              {q.type === 'short_answer' && (
                <Input placeholder="응시생이 단답을 입력합니다" disabled className="text-[13px]" />
              )}

              {q.type === 'essay' && (
                <Textarea placeholder="응시생이 서술형 답안을 입력합니다" disabled rows={6} className="text-[13px]" />
              )}

              {q.type === 'file_upload' && (
                <div className="border border-dashed rounded-lg p-6 text-center text-[12px] text-muted-foreground flex flex-col items-center gap-2">
                  <Upload className="h-5 w-5" />
                  실기형 파일 업로드 영역
                </div>
              )}

              {q.type === 'work_based' && (
                slots.length > 0 ? (
                  <div className="space-y-2">
                    {slots.map((s: any, i: number) => (
                      <div key={s.id || i} className="border rounded-md p-3 bg-background space-y-1.5">
                        <div className="flex items-center gap-2 text-[12px]">
                          <Badge variant="outline" className="text-[10px] shrink-0">{s.type}</Badge>
                          <span className="flex-1 font-medium">{s.label}</span>
                          {s.required && <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">필수</Badge>}
                          <span className="text-[11px] text-muted-foreground shrink-0">{s.max_score}점</span>
                        </div>
                        {s.type === 'text' ? (
                          <Textarea disabled rows={3} placeholder="텍스트 입력란" className="text-[12px]" />
                        ) : (
                          <div className="border border-dashed rounded p-3 text-center text-[11px] text-muted-foreground">
                            파일 업로드 영역
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-destructive">⚠ 작업형 제출란(submission_slots)이 등록되지 않았습니다.</p>
                )
              )}

              {q.allow_file_upload && q.type !== 'file_upload' && q.type !== 'work_based' && (
                <div className="border border-dashed rounded-lg p-4 text-center text-[11px] text-muted-foreground flex items-center justify-center gap-2">
                  <Upload className="h-4 w-4" />
                  추가 파일 업로드 허용
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>닫기</Button>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
