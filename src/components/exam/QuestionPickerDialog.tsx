import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GradeBadge } from '@/components/GradeBadge';
import { QuestionType, QuestionDifficulty } from '@/types';
import { Search, GripVertical, X, ArrowUp, ArrowDown, ArrowUpDown, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  questionTypeLabels,
  questionTypeColors,
  categoryColors,
  difficultyLabels,
  difficultyColors,
} from '@/components/question-bank/questionTypes';
import { TagFilterPopover, collectTagStats } from '@/components/question-bank/TagControls';

interface QuestionPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  onSaved: () => void;
}

function SortableItem({ id, idx, question, onRemove }: { id: string; idx: number; question: any; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background text-[11px]",
        isDragging && "opacity-50 shadow-lg z-50"
      )}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Badge className="text-[9px] bg-primary text-primary-foreground shrink-0">{idx + 1}</Badge>
      <span className="truncate flex-1">
        {question ? question.content.split('\n')[0].replace('## ', '').slice(0, 30) : ''}
      </span>
      <span className="text-muted-foreground shrink-0">{question?.max_score}점</span>
      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive shrink-0">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

type SortKey = 'selected' | 'type' | 'grade' | 'category' | 'difficulty' | 'max_score' | 'created_at';
type SortDir = 'asc' | 'desc';

function SortBtn({
  label,
  active,
  dir,
  onClick,
}: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 hover:text-foreground transition-colors",
        active && "text-foreground font-semibold"
      )}
    >
      {label}
      {active ? (
        dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

export function QuestionPickerDialog({ open, onOpenChange, examId, onSaved }: QuestionPickerDialogProps) {
  const [allQuestions, setAllQuestions] = useState<any[]>([]);
  const [allSets, setAllSets] = useState<any[]>([]);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [diffFilter, setDiffFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!open || !examId) return;
    const load = async () => {
      const [{ data: qs }, { data: eqs }, { data: ss }] = await Promise.all([
        supabase.from('questions').select('*').order('created_at', { ascending: false }),
        supabase.from('exam_questions').select('question_id, order_num').eq('exam_id', examId).order('order_num'),
        supabase.from('question_sets').select('*').order('created_at', { ascending: false }),
      ]);
      if (qs) setAllQuestions(qs);
      if (ss) setAllSets(ss);
      setOrderedIds((eqs || []).map((eq: any) => eq.question_id));
    };
    load();
    setSearchText('');
    setCatFilter('all');
    setGradeFilter('all');
    setDiffFilter('all');
    setTypeFilter('all');
    setDateFrom('');
    setDateTo('');
    setTagFilter([]);
    setPage(1);
  }, [open, examId]);

  useEffect(() => {
    setPage(1);
  }, [searchText, catFilter, gradeFilter, diffFilter, typeFilter, tagFilter, dateFrom, dateTo, sortKey, sortDir, pageSize]);



  const selectedSet = useMemo(() => new Set(orderedIds), [orderedIds]);

  const tagStats = useMemo(() => collectTagStats(allQuestions), [allQuestions]);

  const filtered = useMemo(() => allQuestions.filter(q => {
    if (catFilter !== 'all' && q.category !== catFilter) return false;
    if (gradeFilter !== 'all' && q.grade !== gradeFilter) return false;
    if (diffFilter !== 'all' && q.difficulty !== diffFilter) return false;
    if (typeFilter !== 'all' && q.type !== typeFilter) return false;
    if (tagFilter.length > 0) {
      const qTags = (q.tags || []) as string[];
      if (!tagFilter.some(t => qTags.includes(t))) return false;
    }
    if (dateFrom) {
      const qDate = q.created_at.slice(0, 10);
      if (qDate < dateFrom) return false;
    }
    if (dateTo) {
      const qDate = q.created_at.slice(0, 10);
      if (qDate > dateTo) return false;
    }
    if (searchText) {
      const s = searchText.toLowerCase();
      if (!q.content.toLowerCase().includes(s) &&
        !(q.tags || []).some((t: string) => t.toLowerCase().includes(s))) return false;
    }
    return true;
  }), [allQuestions, catFilter, gradeFilter, diffFilter, typeFilter, tagFilter, dateFrom, dateTo, searchText]);

  const getSortValue = (q: any, key: SortKey): any => {
    if (key === 'selected') {
      const idx = orderedIds.indexOf(q.id);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    }
    if (key === 'difficulty') {
      const order: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
      return order[q.difficulty] ?? 99;
    }
    if (key === 'grade') {
      const order: Record<string, number> = { green: 1, blue: 2, black: 3, '전문인재': 4 };
      return order[q.grade] ?? 99;
    }
    return q[key] ?? '';
  };

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir, orderedIds]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
  const renderSort = (label: string, key: SortKey) => (
    <SortBtn label={label} active={sortKey === key} dir={sortDir} onClick={() => toggleSort(key)} />
  );



  const toggleQuestion = (qId: string) => {
    setOrderedIds(prev => {
      if (prev.includes(qId)) return prev.filter(id => id !== qId);
      return [...prev, qId];
    });
  };

  // 세트별 소속 문항 그룹
  const questionsBySetId = useMemo(() => {
    const map: Record<string, any[]> = {};
    allQuestions.forEach(q => {
      if (q.set_id) {
        if (!map[q.set_id]) map[q.set_id] = [];
        map[q.set_id].push(q);
      }
    });
    // set_order 기준 정렬
    Object.values(map).forEach(arr =>
      arr.sort((a, b) => (a.set_order ?? 999) - (b.set_order ?? 999))
    );
    return map;
  }, [allQuestions]);

  const setsWithQuestions = useMemo(
    () => allSets.filter(s => (questionsBySetId[s.id] || []).length > 0),
    [allSets, questionsBySetId]
  );

  const toggleSet = (setId: string) => {
    const setQs = questionsBySetId[setId] || [];
    const setQIds = setQs.map(q => q.id);
    if (setQIds.length === 0) return;
    setOrderedIds(prev => {
      const allSelected = setQIds.every(id => prev.includes(id));
      if (allSelected) {
        // 전체 해제
        return prev.filter(id => !setQIds.includes(id));
      }
      // 누락된 문항만 끝에 추가 (set_order 순서로)
      const missing = setQIds.filter(id => !prev.includes(id));
      return [...prev, ...missing];
    });
  };


  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrderedIds(prev => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const saveQuestionSelection = async () => {
    await supabase.from('exam_questions').delete().eq('exam_id', examId);
    const inserts = orderedIds.map((qId, i) => ({
      exam_id: examId,
      question_id: qId,
      order_num: i + 1,
    }));
    if (inserts.length > 0) {
      const { error } = await supabase.from('exam_questions').insert(inserts);
      if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    }
    toast({ title: `${inserts.length}개 문제가 시험에 배정되었습니다.` });
    onOpenChange(false);
    onSaved();
  };

  const totalScore = allQuestions.filter(q => selectedSet.has(q.id)).reduce((s, q) => s + q.max_score, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[1050px] h-[92vh] max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-[14px]">문제 선택 (문제은행)</DialogTitle>
        </DialogHeader>

        {/* Summary */}
        <div className="text-[12px] text-muted-foreground shrink-0">
          선택된 문제: <span className="font-medium text-foreground">{orderedIds.length}개</span> | 총 배점: <span className="font-medium text-foreground">{totalScore}점</span>
          {filtered.length !== allQuestions.length && ` | 검색 결과: ${filtered.length}개`}
        </div>

        {/* 세트 일괄 선택 */}
        {setsWithQuestions.length > 0 && (
          <div className="border rounded-md p-2 bg-info-bg/30 max-h-[18vh] overflow-auto shrink-0">
            <p className="text-[10px] text-muted-foreground mb-1.5">📦 세트 일괄 선택 — 체크 시 소속 문항이 한꺼번에 추가/해제됩니다</p>
            <div className="grid grid-cols-1 gap-1.5">
              {setsWithQuestions.map(s => {
                const setQs = questionsBySetId[s.id] || [];
                const selectedCount = setQs.filter(q => selectedSet.has(q.id)).length;
                const allChecked = selectedCount === setQs.length;
                const someChecked = selectedCount > 0 && !allChecked;
                const sumScore = setQs.reduce((acc, q) => acc + (q.max_score || 0), 0);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "flex items-center gap-2 px-2 py-2 rounded border bg-background cursor-pointer hover:bg-muted/40 text-[12px] flex-wrap",
                      allChecked && "border-primary/40 bg-primary/5",
                      someChecked && "border-amber-300 bg-amber-50/40"
                    )}
                  >
                    <Checkbox
                      checked={allChecked ? true : (someChecked ? 'indeterminate' : false)}
                      onCheckedChange={() => toggleSet(s.id)}
                    />
                    <span className="truncate flex-1 font-medium min-w-0">{s.title}</span>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {s.category && (
                        <Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", categoryColors[s.category])}>
                          {s.category}
                        </Badge>
                      )}
                      {s.grade && <GradeBadge grade={s.grade} className="text-[10px]" />}
                      <span className="text-muted-foreground whitespace-nowrap text-[11px]">
                        {selectedCount}/{setQs.length}과목 · {sumScore}점
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}


        {/* Sortable selected questions */}
        {orderedIds.length > 0 && (
          <div className="border rounded-md p-2 bg-muted/30 max-h-[12vh] overflow-auto shrink-0">
            <p className="text-[10px] text-muted-foreground mb-1.5">📌 드래그하여 문제 순서를 변경하세요</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {orderedIds.map((qId, idx) => (
                    <SortableItem
                      key={qId}
                      id={qId}
                      idx={idx}
                      question={allQuestions.find(q => q.id === qId)}
                      onRemove={() => setOrderedIds(prev => prev.filter(id => id !== qId))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* 세트별 최종 배치 미리보기 */}
        {orderedIds.length > 0 && (() => {
          type Block =
            | { kind: 'set'; setId: string; questions: any[] }
            | { kind: 'standalone'; question: any };
          const blocks: Block[] = [];
          const setBlockIndex = new Map<string, number>();
          for (const qId of orderedIds) {
            const q = allQuestions.find(x => x.id === qId);
            if (!q) continue;
            if (q.set_id) {
              const idx = setBlockIndex.get(q.set_id);
              if (idx === undefined) {
                setBlockIndex.set(q.set_id, blocks.length);
                blocks.push({ kind: 'set', setId: q.set_id, questions: [q] });
              } else {
                (blocks[idx] as { kind: 'set'; setId: string; questions: any[] }).questions.push(q);
              }
            } else {
              blocks.push({ kind: 'standalone', question: q });
            }
          }
          blocks.forEach(b => {
            if (b.kind === 'set') {
              b.questions.sort((a, c) => (a.set_order ?? 999) - (c.set_order ?? 999));
            }
          });
          const setCount = blocks.filter(b => b.kind === 'set').length;
          const standaloneCount = blocks.filter(b => b.kind === 'standalone').length;

          return (
            <div className="border rounded-md p-2 bg-background max-h-[16vh] overflow-auto shrink-0">
              <p className="text-[10px] text-muted-foreground mb-1.5">
                👁 응시 화면 미리보기 — 세트 {setCount}개 · 독립문항 {standaloneCount}개 (총 {blocks.length}블록)
              </p>
              <div className="space-y-1.5">
                {blocks.map((b, bIdx) => {
                  if (b.kind === 'standalone') {
                    const q = b.question;
                    return (
                      <div key={`q-${q.id}`} className="flex items-center gap-2 px-2 py-1 rounded border bg-muted/20 text-[11px]">
                        <Badge variant="outline" className="text-[9px] shrink-0">블록 {bIdx + 1}</Badge>
                        <Badge variant="outline" className="text-[9px] shrink-0">독립</Badge>
                        <span className="truncate flex-1">
                          {(q.content || '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 50)}
                        </span>
                        <span className="text-muted-foreground shrink-0">{q.max_score}점</span>
                      </div>
                    );
                  }
                  const setInfo = allSets.find(s => s.id === b.setId);
                  const sumScore = b.questions.reduce((s, q) => s + (q.max_score || 0), 0);
                  const totalSetQs = (questionsBySetId[b.setId] || []).length;
                  const partial = b.questions.length < totalSetQs;
                  return (
                    <div key={`set-${b.setId}`} className="rounded border bg-primary/5 border-primary/30">
                      <div className="flex items-center gap-2 px-2 py-1 border-b border-primary/20 text-[11px]">
                        <Badge variant="outline" className="text-[9px] shrink-0">블록 {bIdx + 1}</Badge>
                        <Badge className="text-[9px] bg-primary text-primary-foreground shrink-0">세트</Badge>
                        <span className="truncate flex-1 font-medium">{setInfo?.title || '(삭제된 세트)'}</span>
                        {partial && (
                          <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-700 shrink-0 whitespace-nowrap">
                            부분 {b.questions.length}/{totalSetQs}
                          </Badge>
                        )}
                        <span className="text-muted-foreground shrink-0 whitespace-nowrap">
                          {b.questions.length}과목 · {sumScore}점
                        </span>
                      </div>
                      <div className="px-2 py-1 space-y-0.5">
                        {b.questions.map((q, qIdx) => (
                          <div key={q.id} className="flex items-center gap-2 text-[10px] pl-4">
                            <span className="text-muted-foreground shrink-0">과목{q.set_order ?? qIdx + 1}</span>
                            <span className="truncate flex-1">
                              {(q.content || '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 55)}
                            </span>
                            <span className="text-muted-foreground shrink-0">{q.max_score}점</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="검색 (내용, 태그)"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="pl-8 w-[140px] text-[12px] h-7"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[80px] text-[12px] h-7"><SelectValue placeholder="유형" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">전체 유형</SelectItem>
              {Object.entries(questionTypeLabels).map(([k, v]) => (
                <SelectItem key={k} value={k} className="text-[12px]">{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="w-[80px] text-[12px] h-7"><SelectValue placeholder="등급" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">전체 등급</SelectItem>
              <SelectItem value="green" className="text-[12px]">그린</SelectItem>
              <SelectItem value="blue" className="text-[12px]">블루</SelectItem>
              <SelectItem value="black" className="text-[12px]">블랙</SelectItem>
              <SelectItem value="전문인재" className="text-[12px]">전문인재</SelectItem>
            </SelectContent>
          </Select>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-[100px] text-[12px] h-7"><SelectValue placeholder="카테고리" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">전체 카테고리</SelectItem>
              <SelectItem value="생성형AI활용" className="text-[12px]">생성형AI활용</SelectItem>
              <SelectItem value="데이터분석" className="text-[12px]">데이터분석</SelectItem>
              <SelectItem value="서비스구현" className="text-[12px]">서비스구현</SelectItem>
            </SelectContent>
          </Select>
          <Select value={diffFilter} onValueChange={setDiffFilter}>
            <SelectTrigger className="w-[80px] text-[12px] h-7"><SelectValue placeholder="난이도" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">전체 난이도</SelectItem>
              <SelectItem value="easy" className="text-[12px]">하</SelectItem>
              <SelectItem value="medium" className="text-[12px]">중</SelectItem>
              <SelectItem value="hard" className="text-[12px]">상</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-[120px] text-[12px] h-7"
              placeholder="시작일"
            />
            <span className="text-[11px] text-muted-foreground">~</span>
            <Input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-[120px] text-[12px] h-7"
              placeholder="종료일"
            />
          </div>
          <TagFilterPopover allTags={tagStats} selected={tagFilter} onChange={setTagFilter} />
          {tagFilter.length > 0 && (
            <div className="flex gap-1 flex-wrap items-center">
              {tagFilter.map(t => (
                <Badge key={t} variant="secondary" className="text-[10px] gap-1 pr-1">
                  #{t}
                  <button onClick={() => setTagFilter(tagFilter.filter(x => x !== t))} className="hover:text-destructive">×</button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto border rounded-md min-h-[20vh] mx-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[12px] w-[36px] px-1">선택</TableHead>
                <TableHead className="text-[12px] w-[42px] px-1">{renderSort('번호', 'selected')}</TableHead>
                <TableHead className="text-[12px] w-[58px] px-1">{renderSort('유형', 'type')}</TableHead>
                <TableHead className="text-[12px] w-[48px] px-1">{renderSort('등급', 'grade')}</TableHead>
                <TableHead className="text-[12px] w-[72px] px-1">{renderSort('카테고리', 'category')}</TableHead>
                <TableHead className="text-[12px] w-[42px] px-1">{renderSort('난이도', 'difficulty')}</TableHead>
                <TableHead className="text-[12px] px-1">문제 내용</TableHead>
                <TableHead className="text-[12px] w-[40px] px-1">{renderSort('배점', 'max_score')}</TableHead>
                <TableHead className="text-[12px] w-[60px] px-1">{renderSort('등록일', 'created_at')}</TableHead>
                <TableHead className="text-[12px] w-[60px] px-1">태그</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map(q => {
                const orderIdx = orderedIds.indexOf(q.id);
                return (
                  <TableRow
                    key={q.id}
                    className={cn("cursor-pointer", selectedSet.has(q.id) && "bg-primary/5")}
                    onClick={() => toggleQuestion(q.id)}
                  >
                    <TableCell className="py-2" onClick={e => e.stopPropagation()}>
                      <Checkbox checked={selectedSet.has(q.id)} onCheckedChange={() => toggleQuestion(q.id)} />
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      {orderIdx >= 0 ? (
                        <Badge className="text-[10px] bg-primary text-primary-foreground">{orderIdx + 1}번</Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", questionTypeColors[q.type as QuestionType] || '')}>
                        {questionTypeLabels[q.type as QuestionType] || q.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      {q.grade ? <GradeBadge grade={q.grade} className="text-[10px]" /> : <span className="text-[11px] text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", categoryColors[q.category])}>{q.category}</Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", difficultyColors[q.difficulty as QuestionDifficulty])}>
                        {difficultyLabels[q.difficulty as QuestionDifficulty] || '중'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[12px] py-2 max-w-[160px] truncate">
                      {q.content.split('\n')[0].replace('## ', '')}
                    </TableCell>
                    <TableCell className="text-[12px] py-2 text-center">{q.max_score}점</TableCell>
                    <TableCell className="text-[11px] py-2 text-muted-foreground whitespace-nowrap">
                      {format(new Date(q.created_at), 'yy.MM.dd')}
                    </TableCell>
                    <TableCell className="py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 flex-wrap">
                        {((q.tags || []) as string[]).slice(0, 2).map((t: string) => (
                          <button
                            key={t}
                            onClick={() => setTagFilter(prev => prev.includes(t) ? prev : [...prev, t])}
                            title={`#${t} 필터 추가`}
                          >
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 whitespace-nowrap hover:bg-primary hover:text-primary-foreground cursor-pointer">
                              #{t}
                            </Badge>
                          </button>
                        ))}
                        {(q.tags || []).length > 2 && (
                          <span className="text-[9px] text-muted-foreground self-center">+{(q.tags || []).length - 2}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-[12px] text-muted-foreground py-8">
                    {allQuestions.length === 0 ? '문제은행이 비어 있습니다' : '검색 조건에 맞는 문제가 없습니다'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-2 shrink-0 text-[11px] text-muted-foreground px-1">
          <div>
            총 {sorted.length}개 · {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} 표시
          </div>
          <div className="flex items-center gap-2">
            <span>페이지당</span>
            <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
              <SelectTrigger className="w-[70px] h-7 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map(n => (
                  <SelectItem key={n} value={String(n)} className="text-[11px]">{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={page === 1}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="tabular-nums">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>


        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={saveQuestionSelection}>저장 ({orderedIds.length}개)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
