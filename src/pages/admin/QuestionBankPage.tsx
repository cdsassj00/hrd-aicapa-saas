import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GradeBadge } from '@/components/GradeBadge';
import { QuestionDifficulty, QuestionType } from '@/types';
import { Plus, Pencil, Trash2, Search, Paperclip, Upload, Download, Loader2, FileDown, Info, Copy, Check, FileJson, Eye, ArrowUp, ArrowDown, ArrowUpDown, Sparkles } from 'lucide-react';
import SingleQuestionPreviewDialog from '@/components/question-bank/SingleQuestionPreviewDialog';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { logQuestionChange, logQuestionChanges } from '@/lib/questionLog';
import { useToast } from '@/hooks/use-toast';
import { QuestionEditDialog } from '@/components/question-bank/QuestionEditDialog';
import { QuestionSetUploadDialog } from '@/components/question-bank/QuestionSetUploadDialog';
import { AiGenerateDialog } from '@/components/question-bank/AiGenerateDialog';
import { SetManageSection } from '@/components/question-bank/SetManageSection';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadTemplate, parseFile } from '@/lib/questionBulkUpload';
import {
  categoryColors,
  difficultyLabels,
  difficultyColors,
  questionTypeLabels,
  questionTypeColors,
} from '@/components/question-bank/questionTypes';
import { TagFilterPopover, collectTagStats } from '@/components/question-bank/TagControls';

const defaultNewQuestion = {
  category: '생성형AI활용',
  max_score: 10,
  type: 'essay' as QuestionType,
  difficulty: 'medium',
  tags: [],
  grade: null,
  order_num: 1,
  options: null,
  correct_answer: null,
  allow_file_upload: false,
  attachments: [],
  content: '',
};

// 컴포넌트 외부에 정의 — 부모 리렌더 시 타입 재생성으로 인한 헤더 버튼 remount 방지
const SortBtn = ({ k, label, sortKey, sortDir, onToggle }: {
  k: string; label: string; sortKey: string | null; sortDir: 'asc' | 'desc'; onToggle: (k: string) => void;
}) => (
  <button onClick={() => onToggle(k)} className="inline-flex items-center gap-1 hover:text-foreground text-[12px] font-medium">
    {label}
    {sortKey === k ? (
      sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
    ) : (
      <ArrowUpDown className="h-3 w-3 opacity-40" />
    )}
  </button>
);

export default function QuestionBankPage() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [catFilter, setCatFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [diffFilter, setDiffFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editQ, setEditQ] = useState<any>({});
  const [bulkUploading, setBulkUploading] = useState(false);
  const [setUploadOpen, setSetUploadOpen] = useState(false);
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedGuide, setCopiedGuide] = useState(false);
  const [tab, setTab] = useState<'bank' | 'sets'>('bank');
  const [setRefreshKey, setSetRefreshKey] = useState(0);
  const [previewQ, setPreviewQ] = useState<any | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { toast } = useToast();

  const GUIDE_TEXT = `[문제은행 업로드 형식 안내]

■ 카테고리 (필수): 생성형AI활용 | 데이터분석 | 서비스구현
■ 등급 (선택): 그린 | 블루 | 블랙 | 전문인재
■ 난이도 (필수): 상 | 중 | 하
■ 유형 (필수): 서술형 | 단답형 | 객관식 | 실기형 | 작업형
■ 배점: 숫자 (기본 10)
■ 태그: 쉼표 구분 (예: AI,학습,딥러닝)
■ 파일업로드허용: O 또는 비워둠
■ 보기1~5: 객관식일 때만 작성 (최소 2개)
■ 정답: 객관식→보기 번호(1~5), 단답형→정답 텍스트

[컬럼 순서]
카테고리 | 등급 | 난이도 | 유형 | 문제내용 | 배점 | 태그 | 파일업로드허용 | 보기1 | 보기2 | 보기3 | 보기4 | 보기5 | 정답`;

  const handleCopyGuide = async () => {
    await navigator.clipboard.writeText(GUIDE_TEXT);
    setCopiedGuide(true);
    setTimeout(() => setCopiedGuide(false), 2000);
  };

  useEffect(() => { fetchQuestions(); }, []);

  const fetchQuestions = async () => {
    const { data } = await supabase
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setQuestions(data);
  };

  // 태그 통계는 단독 문제(문제은행 탭 대상)만 기준으로 집계
  const standaloneQuestions = useMemo(() => questions.filter(q => !q.set_id), [questions]);
  const tagStats = useMemo(() => collectTagStats(standaloneQuestions), [standaloneQuestions]);

  const filtered = useMemo(() => {
    const search = searchText.toLowerCase();
    return questions.filter(q => {
      if (q.set_id) return false;
      if (catFilter !== 'all' && q.category !== catFilter) return false;
      if (gradeFilter !== 'all' && q.grade !== gradeFilter) return false;
      if (diffFilter !== 'all' && q.difficulty !== diffFilter) return false;
      if (typeFilter !== 'all' && q.type !== typeFilter) return false;
      if (tagFilter.length > 0) {
        const qTags = (q.tags || []) as string[];
        if (!tagFilter.some(t => qTags.includes(t))) return false;
      }
      if (search && !q.content.toLowerCase().includes(search) &&
          !(q.tags || []).some((t: string) => t.toLowerCase().includes(search))) return false;
      return true;
    });
  }, [questions, catFilter, gradeFilter, diffFilter, typeFilter, tagFilter, searchText]);

  const gradeOrder: Record<string, number> = { green: 1, blue: 2, black: 3, '전문인재': 4 };
  const diffOrder: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const getSortValue = (q: any, key: string): any => {
      switch (key) {
        case 'type': return questionTypeLabels[q.type as QuestionType] || q.type || '';
        case 'grade': return gradeOrder[q.grade] || 99;
        case 'category': return q.category || '';
        case 'difficulty': return diffOrder[q.difficulty] || 99;
        case 'content': return (q.content || '').toLowerCase();
        case 'tags': return ((q.tags || []) as string[]).join(',').toLowerCase();
        case 'max_score': return q.max_score || 0;
        case 'created_at': return new Date(q.created_at).getTime();
        case 'code': return q.code || '';
        default: return '';
      }
    };
    return [...filtered].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = useCallback((key: string) => {
    setSortKey(prevKey => {
      if (prevKey !== key) {
        setSortDir('asc');
        return key;
      }
      // 동일 키: asc → desc → 해제
      let nextKey: string | null = key;
      setSortDir(prevDir => {
        if (prevDir === 'asc') return 'desc';
        nextKey = null;
        return 'asc';
      });
      return nextKey;
    });
  }, []);

  const renderSort = (k: string, label: string) => (
    <SortBtn k={k} label={label} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
  );

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);
  useEffect(() => { setPage(1); }, [catFilter, gradeFilter, diffFilter, typeFilter, tagFilter, searchText, sortKey, sortDir, pageSize]);
  const paged = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(q => selectedIds.has(q.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(q => next.delete(q.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(q => next.add(q.id));
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    await logQuestionChange(id, 'deleted');
    await supabase.from('questions').delete().eq('id', id);
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    fetchQuestions();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeletingBulk(true);
    try {
      const ids = Array.from(selectedIds);
      // 삭제 로그는 한 번의 사용자 확인 + 한 번의 일괄 insert로 처리한다.
      // 기존처럼 문항 수만큼 병렬 getUser/insert를 실행하면 auth-token lock 충돌로 삭제가 시작되기 전에 실패할 수 있다.
      await logQuestionChanges(ids, 'deleted');
      // URL 길이 제한 회피를 위해 100개씩 나눠 삭제
      const BATCH = 100;
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const { error } = await supabase.from('questions').delete().in('id', chunk);
        if (error) throw error;
      }
      toast({ title: `${ids.length}개 문제 삭제 완료` });
      setSelectedIds(new Set());
      fetchQuestions();
    } catch (err: any) {
      toast({ title: '삭제 실패', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingBulk(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setBulkUploading(true);
    try {
      const parsed = await parseFile(file);
      const warnings = (parsed as any)._warnings as string[] | undefined;

      // Build base row payload (shared by insert/update)
      const toRow = (q: typeof parsed[number]) => ({
        code: q.code,
        category: q.category as any,
        grade: q.grade as any,
        difficulty: q.difficulty as any,
        type: q.type,
        content: q.content,
        max_score: q.max_score,
        tags: q.tags,
        allow_file_upload: q.allow_file_upload,
        options: q.options as any,
        correct_answer: q.correct_answer,
        order_num: q.order_num,
        attachments: (q.attachments || []) as any,
      });

      // Split rows by code presence and look up existing codes for overwrite
      const withCode = parsed.filter(q => q.code);
      const codes = Array.from(new Set(withCode.map(q => q.code!) ));
      let existingByCode = new Map<string, string>();
      if (codes.length > 0) {
        const { data: existing, error: lookupErr } = await supabase
          .from('questions')
          .select('id, code')
          .in('code', codes);
        if (lookupErr) throw lookupErr;
        existingByCode = new Map((existing || []).filter(e => e.code).map(e => [e.code as string, e.id as string]));
      }

      const insertRows: any[] = [];
      const updates: { id: string; row: any }[] = [];
      for (const q of parsed) {
        const row = toRow(q);
        if (q.code && existingByCode.has(q.code)) {
          updates.push({ id: existingByCode.get(q.code)!, row });
        } else {
          insertRows.push(row);
        }
      }

      if (insertRows.length > 0) {
        const { error } = await supabase.from('questions').insert(insertRows);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase.from('questions').update(u.row).eq('id', u.id);
        if (error) throw error;
      }

      fetchQuestions();
      const parts = [
        insertRows.length > 0 ? `신규 ${insertRows.length}개` : '',
        updates.length > 0 ? `덮어쓰기 ${updates.length}개` : '',
      ].filter(Boolean).join(' / ') || '0개';
      toast({
        title: `일괄 등록 완료 — ${parts}`,
        description: warnings?.length ? `⚠️ ${warnings.length}개 행은 오류로 건너뜀` : undefined,
      });

    } catch (err: any) {
      toast({ title: '일괄 등록 실패', description: err.message, variant: 'destructive' });
    } finally {
      setBulkUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1>문제 관리</h1>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'bank' | 'sets')}>
            <TabsList className="h-8">
              <TabsTrigger value="bank" className="text-[12px] h-7">문제은행 (단독)</TabsTrigger>
              <TabsTrigger value="sets" className="text-[12px] h-7">세트 관리</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'bank' && selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" className="text-[12px] gap-1" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />선택 삭제 ({selectedIds.size})
            </Button>
          )}
          {tab === 'bank' && <>
            <span className="text-[12px] text-muted-foreground">{filtered.length}개 문제</span>
            <Button variant="outline" size="sm" className="text-[12px] gap-1" onClick={() => {
              const headers = ['문제코드', '카테고리', '등급', '난이도', '유형', '문제내용', '배점', '태그', '파일업로드허용', '보기1', '보기2', '보기3', '보기4', '보기5', '정답'];
              const gradeMap: Record<string, string> = { green: '그린', blue: '블루', black: '블랙', '전문인재': '전문인재' };
              const diffMap: Record<string, string> = { easy: '하', medium: '중', hard: '상' };
              const typeMap: Record<string, string> = { essay: '서술형', short_answer: '단답형', multiple_choice: '객관식', file_upload: '실기형', work_based: '작업형' };
              const rows = filtered.map(q => {
                const opts = (q.options as any[]) || [];
                return [
                  q.code || '', q.category, gradeMap[q.grade] || '', diffMap[q.difficulty] || q.difficulty,
                  typeMap[q.type] || q.type, q.content, q.max_score,
                  (q.tags || []).join(','), q.allow_file_upload ? 'O' : '',
                  opts[0]?.text || '', opts[1]?.text || '', opts[2]?.text || '', opts[3]?.text || '', opts[4]?.text || '',
                  q.correct_answer || '',
                ];
              });
              const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
              ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 40 }, { wch: 6 }, { wch: 15 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 8 }];
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, '문제은행');
              XLSX.writeFile(wb, `문제은행_${filtered.length}건.xlsx`);
            }}>
              <FileDown className="h-3.5 w-3.5" />다운로드 ({filtered.length})
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-[12px] gap-1">
                  <Info className="h-3.5 w-3.5" />형식 안내
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="end">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <span className="text-[12px] font-medium">업로드 형식 안내</span>
                  <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={handleCopyGuide}>
                    {copiedGuide ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedGuide ? '복사됨' : '전체 복사'}
                  </Button>
                </div>
                <div className="p-3 text-[11px] leading-relaxed whitespace-pre-wrap font-mono text-muted-foreground select-all max-h-[400px] overflow-y-auto">
                  {GUIDE_TEXT}
                </div>
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" className="text-[12px] gap-1" onClick={downloadTemplate}>
              <Download className="h-3.5 w-3.5" />템플릿
            </Button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleBulkUpload} />
            <Button variant="outline" size="sm" className="text-[12px] gap-1" disabled={bulkUploading}
              onClick={() => fileInputRef.current?.click()}>
              {bulkUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              일괄 등록
            </Button>
            <Button variant="outline" size="sm" className="text-[12px] gap-1" onClick={() => setAiGenOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />AI 생성
            </Button>
            <Button size="sm" className="text-[12px] gap-1" onClick={() => {
              setEditQ({ ...defaultNewQuestion });
              setEditOpen(true);
            }}>
              <Plus className="h-3.5 w-3.5" />문제 추가
            </Button>
          </>}
          {tab === 'sets' && (
            <Button variant="default" size="sm" className="text-[12px] gap-1" onClick={() => setSetUploadOpen(true)}>
              <FileJson className="h-3.5 w-3.5" />세트 업로드 (JSON)
            </Button>
          )}
        </div>
      </div>

      {tab === 'sets' ? (
        <SetManageSection refreshKey={setRefreshKey} />
      ) : (<>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="검색 (내용, 태그)"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="pl-8 w-[200px] text-[12px] h-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[100px] text-[12px] h-8"><SelectValue placeholder="유형" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">전체 유형</SelectItem>
            {Object.entries(questionTypeLabels).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-[12px]">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-[100px] text-[12px] h-8"><SelectValue placeholder="등급" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">전체 등급</SelectItem>
            <SelectItem value="green" className="text-[12px]">그린</SelectItem>
            <SelectItem value="blue" className="text-[12px]">블루</SelectItem>
            <SelectItem value="black" className="text-[12px]">블랙</SelectItem>
            <SelectItem value="전문인재" className="text-[12px]">전문인재</SelectItem>
          </SelectContent>
        </Select>
        {['all', '생성형AI활용', '데이터분석', '서비스구현'].map(c => (
          <Button key={c} variant={catFilter === c ? 'default' : 'outline'} size="sm" className="text-[12px] h-8" onClick={() => setCatFilter(c)}>
            {c === 'all' ? '전체' : c}
          </Button>
        ))}
        {['all', 'easy', 'medium', 'hard'].map(d => (
          <Button key={d} variant={diffFilter === d ? 'default' : 'outline'} size="sm" className="text-[12px] h-8" onClick={() => setDiffFilter(d)}>
            {d === 'all' ? '전체 난이도' : difficultyLabels[d as QuestionDifficulty]}
          </Button>
        ))}
        <TagFilterPopover allTags={tagStats} selected={tagFilter} onChange={setTagFilter} />
        {tagFilter.length > 0 && (
          <div className="flex gap-1 flex-wrap items-center">
            {tagFilter.map(t => (
              <Badge key={t} variant="secondary" className="text-[10px] gap-1 pr-1">
                #{t}
                <button onClick={() => setTagFilter(tagFilter.filter(x => x !== t))} className="hover:text-destructive text-[10px]">×</button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} />
              </TableHead>
              <TableHead className="text-[12px] w-[70px]">{renderSort("code","문제코드")}</TableHead>
              <TableHead className="text-[12px] w-[70px]">{renderSort("type","유형")}</TableHead>
              <TableHead className="text-[12px] w-[70px]">{renderSort("grade","등급")}</TableHead>
              <TableHead className="text-[12px] w-[90px]">{renderSort("category","카테고리")}</TableHead>
              <TableHead className="text-[12px] w-[50px]">{renderSort("difficulty","난이도")}</TableHead>
              <TableHead className="text-[12px]">{renderSort("content","문제 내용 (요약)")}</TableHead>
              <TableHead className="text-[12px] w-[180px]">{renderSort("tags","태그")}</TableHead>
              <TableHead className="text-[12px] w-[50px]">{renderSort("max_score","배점")}</TableHead>
              <TableHead className="text-[12px] w-[80px]">{renderSort("created_at","등록일")}</TableHead>
              <TableHead className="text-[12px] w-[70px]">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map(q => (
              <TableRow key={q.id} className={cn(selectedIds.has(q.id) && 'bg-muted/50')}>
                <TableCell className="py-2">
                  <Checkbox checked={selectedIds.has(q.id)} onCheckedChange={() => toggleSelect(q.id)} />
                </TableCell>
                <TableCell className="text-[11px] py-2 font-mono text-muted-foreground">{q.code || '-'}</TableCell>
                <TableCell className="py-2">
                  <Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", questionTypeColors[q.type as QuestionType] || '')}>
                    {questionTypeLabels[q.type as QuestionType] || q.type}
                  </Badge>
                </TableCell>
                <TableCell className="py-2">{q.grade ? <GradeBadge grade={q.grade} className="text-[10px]" /> : <span className="text-[11px] text-muted-foreground">-</span>}</TableCell>
                <TableCell className="py-2"><Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", categoryColors[q.category])}>{q.category}</Badge></TableCell>
                <TableCell className="py-2"><Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", difficultyColors[q.difficulty])}>{difficultyLabels[q.difficulty]}</Badge></TableCell>
                <TableCell className="text-[12px] py-2 max-w-[300px]">
                  <div className="flex items-center gap-1 truncate">
                    <span className="truncate">{q.content.split('\n')[0].replace('## ', '')}</span>
                    {(q.attachments?.length > 0) && <Paperclip className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                    {q.allow_file_upload && <span className="text-[9px] text-primary flex-shrink-0">📤</span>}
                  </div>
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex gap-1 flex-wrap">
                    {((q.tags || []) as string[]).slice(0, 3).map((t: string) => (
                      <button
                        key={t}
                        onClick={() => setTagFilter(prev => prev.includes(t) ? prev : [...prev, t])}
                        title={`#${t} 필터 추가`}
                      >
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 whitespace-nowrap hover:bg-primary hover:text-primary-foreground cursor-pointer">
                          #{t}
                        </Badge>
                      </button>
                    ))}
                    {(q.tags || []).length > 3 && (
                      <span className="text-[9px] text-muted-foreground self-center">+{(q.tags || []).length - 3}</span>
                    )}
                    {(q.tags || []).length === 0 && <span className="text-[10px] text-muted-foreground">-</span>}
                  </div>
                </TableCell>
                <TableCell className="text-[12px] py-2 text-center">{q.max_score}점</TableCell>
                <TableCell className="text-[11px] py-2 text-muted-foreground whitespace-nowrap">
                  {format(new Date(q.created_at), 'yy.MM.dd')}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="응시자 미리보기" onClick={() => setPreviewQ(q)}><Eye className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditQ({ ...q }); setEditOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(q.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-[12px] text-muted-foreground py-8">문제가 없습니다</TableCell></TableRow>}
          </TableBody>
        </Table>
        {sorted.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t text-[12px] text-muted-foreground">
            <div>
              총 <span className="font-medium text-foreground">{sorted.length}</span>개 중{' '}
              <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}</span>–
              <span className="font-medium text-foreground">{Math.min(page * pageSize, sorted.length)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>페이지당</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-7 w-[72px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage(1)}>처음</Button>
              <Button variant="outline" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>이전</Button>
              <span className="px-1">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>다음</Button>
              <Button variant="outline" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>끝</Button>
            </div>
          </div>
        )}
      </Card>
      </>)}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문제 삭제 확인</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 {selectedIds.size}개 문제를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBulk}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={deletingBulk} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingBulk ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuestionEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editQ={editQ}
        setEditQ={setEditQ}
        onSaved={fetchQuestions}
      />

      <QuestionSetUploadDialog
        open={setUploadOpen}
        onOpenChange={setSetUploadOpen}
        onCommitted={() => { fetchQuestions(); setSetRefreshKey(k => k + 1); setTab('sets'); }}
      />

      <AiGenerateDialog
        open={aiGenOpen}
        onOpenChange={setAiGenOpen}
        onGenerated={fetchQuestions}
      />

      <SingleQuestionPreviewDialog
        open={!!previewQ}
        onOpenChange={(v) => { if (!v) setPreviewQ(null); }}
        question={previewQ}
      />
    </div>
  );
}
