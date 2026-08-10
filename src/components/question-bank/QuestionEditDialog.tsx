import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { X, Upload, History } from 'lucide-react';
import { McOptionsEditor } from './McOptionsEditor';
import { QuestionLogViewer } from './QuestionLogViewer';
import { questionTypeLabels } from './questionTypes';
import { TagPickerPopover, SelectedTagChips, collectTagStats } from './TagControls';
import { McOption, QuestionType } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logQuestionChange, diffChanges } from '@/lib/questionLog';
import { cn } from '@/lib/utils';

interface QuestionEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editQ: any;
  setEditQ: (fn: (prev: any) => any) => void;
  onSaved: () => void;
}

export function QuestionEditDialog({ open, onOpenChange, editQ, setEditQ, onSaved }: QuestionEditDialogProps) {
  const [tagInput, setTagInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [allTagStats, setAllTagStats] = useState<{ tag: string; count: number }[]>([]);
  const originalRef = useRef<any>(null);
  const { toast } = useToast();

  // 다이얼로그 열릴 때 기존 태그 집계 로드
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from('questions').select('tags');
      if (data) setAllTagStats(collectTagStats(data as any));
    })();
  }, [open]);

  // Capture original state when dialog opens for diff
  if (open && editQ.id && !originalRef.current) {
    originalRef.current = { ...editQ };
  }
  if (!open) {
    originalRef.current = null;
  }

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !(editQ.tags || []).includes(tag)) {
      setEditQ((p: any) => ({ ...p, tags: [...(p.tags || []), tag] }));
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setEditQ((p: any) => ({ ...p, tags: (p.tags || []).filter((t: string) => t !== tag) }));
  };

  const handleTypeChange = (type: QuestionType) => {
    const updates: any = { type };
    if (type === 'multiple_choice' && (!editQ.options || editQ.options.length === 0)) {
      updates.options = [
        { id: crypto.randomUUID(), text: '', is_correct: true },
        { id: crypto.randomUUID(), text: '', is_correct: false },
        { id: crypto.randomUUID(), text: '', is_correct: false },
        { id: crypto.randomUUID(), text: '', is_correct: false },
      ];
    }
    if (type === 'file_upload') {
      updates.allow_file_upload = true;
    }
    setEditQ((p: any) => ({ ...p, ...updates }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const newAttachments: any[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
      const safePath = `questions/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
      const { error } = await supabase.storage.from('question-attachments').upload(safePath, file);
      if (error) {
        toast({ title: '파일 업로드 실패', description: `${file.name}: ${error.message}`, variant: 'destructive' });
      } else {
        const { data: urlData } = supabase.storage.from('question-attachments').getPublicUrl(safePath);
        newAttachments.push({ name: file.name, url: urlData.publicUrl, path: safePath });
      }
    }
    if (newAttachments.length > 0) {
      setEditQ((p: any) => ({ ...p, attachments: [...(p.attachments || []), ...newAttachments] }));
      toast({ title: `${newAttachments.length}개 파일 업로드 완료` });
    }
    setUploading(false);
    e.target.value = '';
  };

  const removeAttachment = async (index: number) => {
    const att = (editQ.attachments || [])[index];
    if (att?.path) {
      await supabase.storage.from('question-attachments').remove([att.path]);
    }
    setEditQ((p: any) => ({
      ...p,
      attachments: (p.attachments || []).filter((_: any, i: number) => i !== index),
    }));
  };

  const slots: any[] = Array.isArray(editQ.submission_slots) ? editQ.submission_slots : [];
  const updateSlots = (next: any[]) => setEditQ((p: any) => ({ ...p, submission_slots: next.length > 0 ? next : null }));
  const addSlot = () => {
    const idx = slots.length + 1;
    updateSlots([
      ...slots,
      { id: `slot_${idx}`, type: 'text', label: ``, max_score: 0, required: false },
    ]);
  };
  const updateSlot = (i: number, patch: any) => updateSlots(slots.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const removeSlot = (i: number) => updateSlots(slots.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    const payload: any = {
      code: editQ.code ? editQ.code.trim() : null,
      category: editQ.category,
      content: editQ.content,
      max_score: editQ.max_score,
      order_num: editQ.order_num || 1,
      type: editQ.type || 'essay',
      grade: editQ.grade || null,
      difficulty: editQ.difficulty || 'medium',
      tags: editQ.tags || [],
      options: editQ.type === 'multiple_choice' ? editQ.options : null,
      correct_answer: editQ.type === 'short_answer' ? editQ.correct_answer : null,
      allow_file_upload: editQ.allow_file_upload || false,
      attachments: editQ.attachments || [],
      submission_slots: slots.length > 0 ? slots : null,
    };

    const diffKeys = ['code', 'content', 'category', 'grade', 'difficulty', 'type', 'max_score', 'tags', 'options', 'correct_answer', 'allow_file_upload', 'attachments', 'submission_slots'];

    if (editQ.id) {
      const { error } = await supabase.from('questions').update(payload).eq('id', editQ.id);
      if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
      // Log update with diff
      const changes = originalRef.current ? diffChanges(originalRef.current, payload, diffKeys) : null;
      if (changes) {
        await logQuestionChange(editQ.id, 'updated', changes);
      }
    } else {
      const { data: inserted, error } = await supabase.from('questions').insert(payload as any).select('id').single();
      if (error) { toast({ title: '추가 실패', description: error.message, variant: 'destructive' }); return; }
      if (inserted) {
        await logQuestionChange(inserted.id, 'created');
      }
    }
    onOpenChange(false);
    onSaved();
    toast({ title: '저장 완료' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[650px] max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-[14px]">{editQ.id ? '문제 편집' : '문제 추가'}</DialogTitle></DialogHeader>
        <Tabs defaultValue="edit">
          {editQ.id && (
            <TabsList className="mb-3">
              <TabsTrigger value="edit" className="text-[12px]">편집</TabsTrigger>
              <TabsTrigger value="history" className="text-[12px] gap-1">
                <History className="h-3.5 w-3.5" />변경 이력
              </TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="edit">
            <div className="space-y-3">
              {/* Code */}
              <div className="space-y-1">
                <Label className="text-[12px]">문제코드 (일괄 업로드 중복 판정용, 빈 칸 가능)</Label>
                <Input
                  value={editQ.code || ''}
                  onChange={e => setEditQ((p: any) => ({ ...p, code: e.target.value }))}
                  placeholder="예: Q-G-001"
                  className="text-[12px] font-mono"
                />
                <p className="text-[10.5px] text-muted-foreground">같은 코드로 업로드하면 기존 문제의 본문·보기·태그·배점 등을 덮어쓰되, ID는 유지되어 시험 연결과 응시 기록이 보존됩니다.</p>
              </div>

              {/* Row 1: Type, Grade, Category */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[12px]">문제 유형</Label>
                  <Select value={editQ.type || 'essay'} onValueChange={v => handleTypeChange(v as QuestionType)}>
                    <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(questionTypeLabels).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-[12px]">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">등급</Label>
                  <Select value={editQ.grade || 'none'} onValueChange={v => setEditQ((p: any) => ({ ...p, grade: v === 'none' ? null : v }))}>
                    <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">미지정</SelectItem>
                      <SelectItem value="green">그린</SelectItem>
                      <SelectItem value="blue">블루</SelectItem>
                      <SelectItem value="black">블랙</SelectItem>
                      <SelectItem value="전문인재">전문인재</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">카테고리</Label>
                  <Select value={editQ.category} onValueChange={v => setEditQ((p: any) => ({ ...p, category: v }))}>
                    <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="생성형AI활용">생성형AI활용</SelectItem>
                      <SelectItem value="데이터분석">데이터분석</SelectItem>
                      <SelectItem value="서비스구현">서비스구현</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 2: Difficulty, Score */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[12px]">난이도</Label>
                  <Select value={editQ.difficulty} onValueChange={v => setEditQ((p: any) => ({ ...p, difficulty: v }))}>
                    <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">하</SelectItem>
                      <SelectItem value="medium">중</SelectItem>
                      <SelectItem value="hard">상</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">배점</Label>
                  <Input type="number" value={editQ.max_score || ''} onChange={e => setEditQ((p: any) => ({ ...p, max_score: +e.target.value }))} className="text-[12px]" />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch
                    checked={editQ.allow_file_upload || false}
                    onCheckedChange={v => setEditQ((p: any) => ({ ...p, allow_file_upload: v }))}
                  />
                  <Label className="text-[12px]">파일 제출 허용</Label>
                </div>
              </div>

              {/* Content */}
              <div className="space-y-1">
                <Label className="text-[12px]">문제 내용 (마크다운)</Label>
                <Textarea value={editQ.content || ''} onChange={e => setEditQ((p: any) => ({ ...p, content: e.target.value }))} className="text-[13px] min-h-[120px] leading-relaxed" />
              </div>

              {/* Type-specific sections */}
              {editQ.type === 'multiple_choice' && (
                <McOptionsEditor
                  options={editQ.options || []}
                  onChange={opts => setEditQ((p: any) => ({ ...p, options: opts }))}
                />
              )}

              {editQ.type === 'short_answer' && (
                <div className="space-y-1">
                  <Label className="text-[12px]">정답 (자동 채점용, 쉼표로 복수 답안 구분)</Label>
                  <Input
                    value={editQ.correct_answer || ''}
                    onChange={e => setEditQ((p: any) => ({ ...p, correct_answer: e.target.value }))}
                    placeholder="예: 답안1, 답안2"
                    className="text-[12px] h-8"
                  />
                </div>
              )}

              {/* Submission slots editor */}
              <div className="space-y-2 border rounded p-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] font-semibold">제출 항목 ({slots.length}개)</Label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={addSlot}>+ 항목 추가</Button>
                </div>
                <p className="text-[10.5px] text-muted-foreground">항목을 1개 이상 추가하면 응시자에게 항목별 답안 입력란이 표시되고 항목별 채점됩니다. 없으면 단일 답안입니다.</p>
                {slots.map((s, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 items-start border-t pt-2">
                    <div
                      className="col-span-2 h-7 px-2 flex items-center rounded-md border bg-muted/50 text-[10.5px] font-mono text-muted-foreground select-none"
                      title="내부 식별자 (응시자에게는 보이지 않음). 자동 생성되며 수정하지 마세요."
                    >
                      {s.id || `slot_${i + 1}`}
                    </div>
                    <Input
                      value={s.label || ''}
                      onChange={e => updateSlot(i, { label: e.target.value })}
                      placeholder="응시자에게 보일 라벨 (예: 답안1)"
                      className="col-span-4 h-7 text-[11px]"
                    />
                    <Select value={s.type || 'text'} onValueChange={v => updateSlot(i, { type: v })}>
                      <SelectTrigger className="col-span-2 h-7 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text" className="text-[11px]">텍스트</SelectItem>
                        <SelectItem value="long_text" className="text-[11px]">긴 텍스트</SelectItem>
                        <SelectItem value="number" className="text-[11px]">숫자</SelectItem>
                        <SelectItem value="url" className="text-[11px]">URL</SelectItem>
                        <SelectItem value="file" className="text-[11px]">파일</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      value={s.max_score ?? 0}
                      onChange={e => updateSlot(i, { max_score: +e.target.value })}
                      placeholder="배점"
                      className="col-span-2 h-7 text-[11px]"
                    />
                    <div className="col-span-1 flex items-center justify-center h-7">
                      <Switch checked={!!s.required} onCheckedChange={v => updateSlot(i, { required: v })} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="col-span-1 h-7 w-7 text-destructive" onClick={() => removeSlot(i)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    {(s.type === 'text' || s.type === 'long_text' || s.type === 'number' || s.type === 'url') && (
                      <>
                        <div className="col-span-6 space-y-0.5">
                          <span className="text-[9px] text-muted-foreground">👁 응시자에게 노출 (예시 안내문)</span>
                          <Input
                            value={s.placeholder || ''}
                            onChange={e => updateSlot(i, { placeholder: e.target.value })}
                            placeholder="플레이스홀더(선택) — 정답 입력 금지"
                            className={cn(
                              "h-7 text-[11px]",
                              s.correct_answer != null && String(s.correct_answer).trim() !== '' && String(s.placeholder ?? '').trim() === String(s.correct_answer).trim()
                                ? "border-destructive ring-1 ring-destructive/40"
                                : "",
                            )}
                          />
                        </div>
                        <div className="col-span-4 space-y-0.5">
                          <span className="text-[9px] text-destructive font-medium">🔒 정답 (응시자 비공개)</span>
                          <Input
                            value={s.correct_answer ?? ''}
                            onChange={e => updateSlot(i, { correct_answer: e.target.value || null })}
                            placeholder="정답(자동채점용)"
                            className="h-7 text-[11px] bg-destructive/5 border-destructive/40"
                          />
                        </div>
                        <div className="col-span-2 space-y-0.5">
                          <span className="text-[9px] text-muted-foreground">채점</span>
                          <Select value={s.auto_grade || 'none'} onValueChange={v => updateSlot(i, { auto_grade: v === 'none' ? null : v })}>
                            <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="채점" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none" className="text-[11px]">수동</SelectItem>
                              <SelectItem value="exact" className="text-[11px]">정확일치</SelectItem>
                              <SelectItem value="numeric" className="text-[11px]">숫자비교</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {s.type === 'file' && (
                      <>
                        <Input
                          value={s.accept || ''}
                          onChange={e => updateSlot(i, { accept: e.target.value })}
                          placeholder="허용 확장자 (예: .pdf,.zip)"
                          className="col-span-8 h-7 text-[11px]"
                        />
                        <Input
                          type="number"
                          value={s.max_size_mb ?? ''}
                          onChange={e => updateSlot(i, { max_size_mb: e.target.value ? +e.target.value : undefined })}
                          placeholder="최대 MB"
                          className="col-span-4 h-7 text-[11px]"
                        />
                      </>
                    )}
                  </div>
                ))}
                {slots.length > 0 && (
                  <p className="text-[10.5px] text-muted-foreground pt-1">항목 합계 배점: <b>{slots.reduce((a, s) => a + (Number(s.max_score) || 0), 0)}</b> (문항 배점 {editQ.max_score || 0}과 일치 권장)</p>
                )}
              </div>

              {/* File attachments */}
              <div className="space-y-1">
                <Label className="text-[12px]">첨부 파일 (참고 자료)</Label>
                <div className="flex gap-1 flex-wrap mb-1">
                  {(editQ.attachments || []).map((att: any, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[11px] gap-1 pr-1">
                      📎 {att.name}
                      <button onClick={() => removeAttachment(i)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
                <label className="inline-flex items-center gap-1 cursor-pointer text-[12px] text-primary hover:underline">
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? '업로드 중...' : '파일 추가'}
                  <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} multiple />
                </label>
              </div>

              {/* Tags */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px]">태그 (시험/카테고리별 그룹화에 활용)</Label>
                  <TagPickerPopover
                    allTags={allTagStats}
                    value={editQ.tags || []}
                    onChange={(next) => setEditQ((p: any) => ({ ...p, tags: next }))}
                  />
                </div>
                <SelectedTagChips
                  tags={editQ.tags || []}
                  onRemove={removeTag}
                  className="mt-1"
                />
                {(editQ.tags || []).length === 0 && (
                  <p className="text-[10.5px] text-muted-foreground">예: <code>2026상반기</code>, <code>AX기초</code>, <code>그린-1차</code></p>
                )}
              </div>
            </div>
          </TabsContent>
          {editQ.id && (
            <TabsContent value="history">
              <QuestionLogViewer questionId={editQ.id} />
            </TabsContent>
          )}
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
