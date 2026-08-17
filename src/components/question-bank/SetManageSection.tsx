import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Paperclip, Trash2, Eye, Search, Loader2, ExternalLink, ArrowUpDown, ChevronRight, ChevronDown, Upload, Pencil, ShieldOff, X, FileJson, Copy, Download, RotateCcw, Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { GradeBadge } from '@/components/GradeBadge';
import { categoryColors, difficultyLabels, difficultyColors } from '@/components/question-bank/questionTypes';
import { QuestionEditDialog } from './QuestionEditDialog';
import ApplicantPreviewDialog from './ApplicantPreviewDialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const mdProseClass = 'prose prose-sm max-w-none prose-p:my-1 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-code:text-[12px] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none';

interface SlotInfo {
  id: string;
  type: string;
  label: string;
  max_score: number;
  correct_answer?: any;
  auto_grade?: string;
  rubric?: string;
  tolerance?: number;
}

const slotTypeLabels: Record<string, string> = {
  text: '단답',
  long_text: '긴글',
  url: 'URL',
  number: '숫자',
  file: '파일',
};

const slotTypeColors: Record<string, string> = {
  text: 'bg-blue-50 text-blue-700 border-blue-200',
  long_text: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  url: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  number: 'bg-amber-50 text-amber-700 border-amber-200',
  file: 'bg-purple-50 text-purple-700 border-purple-200',
};

export function SetManageSection({ refreshKey }: { refreshKey: number }) {
  const [sets, setSets] = useState<any[]>([]);
  const [questionsBySet, setQuestionsBySet] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'old' | 'name'>('recent');
  const [detailSet, setDetailSet] = useState<any | null>(null);
  const [previewSet, setPreviewSet] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedSets, setExpandedSets] = useState<Record<string, boolean>>({});
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
  const [uploadingQuestionId, setUploadingQuestionId] = useState<string | null>(null);
  const [editQ, setEditQ] = useState<any | null>(null);
  const [editingSet, setEditingSet] = useState<any | null>(null);
  const [editingTagInput, setEditingTagInput] = useState('');
  const [setSaving, setSetSaving] = useState(false);
  const [setFileUploading, setSetFileUploading] = useState(false);
  const [jsonOverwriteOpen, setJsonOverwriteOpen] = useState(false);
  const [jsonOverwriteText, setJsonOverwriteText] = useState('');
  const [jsonOverwriteError, setJsonOverwriteError] = useState<string | null>(null);
  const [jsonOverwriteApplying, setJsonOverwriteApplying] = useState(false);
  const subjectFileRef = useRef<HTMLInputElement>(null);
  const selectedQuestionRef = useRef<string | null>(null);
  const setFileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const toggleSet = (id: string) => setExpandedSets(p => ({ ...p, [id]: !p[id] }));
  const toggleQuestion = (id: string) => setExpandedQuestions(p => ({ ...p, [id]: !p[id] }));

  const fetchAll = async () => {
    setLoading(true);
    const { data: setsData } = await supabase
      .from('question_sets')
      .select('*')
      .order('created_at', { ascending: false });
    // 새 스키마(name/description) → 화면이 기대하는 옛 필드(title/scenario)로 어댑트
    const setList = (setsData || []).map((s: any) => ({
      ...s,
      title: s.name,
      scenario: s.description ?? '',
    }));
    setSets(setList);

    if (setList.length > 0) {
      const ids = setList.map((s: any) => s.id);
      // 세트↔문항 연결은 이제 question_set_items 조인으로 가져온다
      const { data: items } = await supabase
        .from('question_set_items')
        .select('set_id, question_id, sort_order')
        .in('set_id', ids);
      const itemList = items || [];
      const qids = itemList.map((it: any) => it.question_id);
      const qById: Record<string, any> = {};
      if (qids.length > 0) {
        const { data: qs } = await supabase.from('questions').select('*').in('id', qids);
        (qs || []).forEach((q: any) => { qById[q.id] = q; });
      }
      // answer_key(jsonb) 에 담아둔 슬롯·정답·메타를 옛 필드명으로 펼쳐 화면에 공급
      const grouped: Record<string, any[]> = {};
      itemList
        .slice()
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .forEach((it: any) => {
          const q = qById[it.question_id];
          if (!q) return;
          const ak = (q.answer_key || {}) as any;
          const mapped = {
            ...q,
            set_id: it.set_id,
            set_order: it.sort_order,
            order_num: it.sort_order,
            max_score: q.points,
            submission_slots: ak.submission_slots ?? null,
            correct_answer: ak.correct_answer ?? null,
            options: ak.options ?? null,
            category: ak.category ?? null,
            grade: ak.grade ?? null,
            tags: ak.tags ?? [],
          };
          if (!grouped[it.set_id]) grouped[it.set_id] = [];
          grouped[it.set_id].push(mapped);
        });
      setQuestionsBySet(grouped);
    } else {
      setQuestionsBySet({});
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [refreshKey]);

  const uploadSubjectAttachments = async (questionId: string, fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!questionId || files.length === 0) return;
    setUploadingQuestionId(questionId);
    try {
      const uploaded: any[] = [];
      for (const file of files) {
        const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
        const path = `questions/${questionId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
        const { error } = await supabase.storage.from('question-attachments').upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });
        if (error) throw new Error(`${file.name}: ${error.message}`);
        const { data } = supabase.storage.from('question-attachments').getPublicUrl(path);
        uploaded.push({ name: file.name, url: data.publicUrl, path, size: file.size, mime: file.type });
      }

      const current = Object.values(questionsBySet).flat().find((q: any) => q.id === questionId);
      const nextAttachments = [...((current?.attachments as any[]) || []), ...uploaded];
      const { error: updateError } = await supabase
        .from('questions')
        .update({ attachments: nextAttachments })
        .eq('id', questionId);
      if (updateError) throw updateError;

      setQuestionsBySet(prev => {
        const next: Record<string, any[]> = {};
        Object.entries(prev).forEach(([setId, arr]) => {
          next[setId] = arr.map((q: any) => q.id === questionId ? { ...q, attachments: nextAttachments } : q);
        });
        return next;
      });
      toast({ title: '과목 첨부 업로드 완료', description: `${uploaded.length}개 파일이 해당 과목에 연결되었습니다` });
    } catch (err: any) {
      toast({ title: '과목 첨부 업로드 실패', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingQuestionId(null);
    }
  };

  const removeSubjectAttachment = async (questionId: string, index: number) => {
    const current = Object.values(questionsBySet).flat().find((q: any) => q.id === questionId);
    if (!current) return;
    const attachments = ((current.attachments as any[]) || []);
    const target = attachments[index];
    const nextAttachments = attachments.filter((_: any, i: number) => i !== index);
    setUploadingQuestionId(questionId);
    try {
      if (target?.path) await supabase.storage.from('question-attachments').remove([target.path]);
      const { error } = await supabase.from('questions').update({ attachments: nextAttachments }).eq('id', questionId);
      if (error) throw error;
      setQuestionsBySet(prev => {
        const next: Record<string, any[]> = {};
        Object.entries(prev).forEach(([setId, arr]) => {
          next[setId] = arr.map((q: any) => q.id === questionId ? { ...q, attachments: nextAttachments } : q);
        });
        return next;
      });
      toast({ title: '과목 첨부 삭제 완료' });
    } catch (err: any) {
      toast({ title: '과목 첨부 삭제 실패', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingQuestionId(null);
    }
  };

  const openSubjectFilePicker = (questionId: string) => {
    selectedQuestionRef.current = questionId;
    subjectFileRef.current?.click();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // delete child questions first, then the set
      await supabase.from('questions').delete().eq('set_id', deleteTarget.id);
      const { error } = await supabase.from('question_sets').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: '세트 삭제 완료', description: `"${deleteTarget.title}" 및 소속 문제 모두 삭제` });
      setDeleteTarget(null);
      fetchAll();
    } catch (err: any) {
      toast({ title: '삭제 실패', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const toggleProctoringDisabled = async (setId: string, next: boolean) => {
    // optimistic update
    setSets(prev => prev.map(s => s.id === setId ? { ...s, proctoring_disabled: next } : s));
    const { error } = await supabase
      .from('question_sets')
      .update({ proctoring_disabled: next } as any)
      .eq('id', setId);
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
      setSets(prev => prev.map(s => s.id === setId ? { ...s, proctoring_disabled: !next } : s));
      return;
    }
    toast({
      title: next ? '부정행위 감지 비활성화됨' : '부정행위 감지 활성화됨',
      description: next ? '이 세트의 문제 풀이 중 전체화면/얼굴/음성 감지가 일시 중지됩니다.' : '기본 감독 정책이 적용됩니다.',
    });
  };

  const openSetEdit = (set: any) => {
    setEditingSet({ ...set, attachments: Array.isArray(set.attachments) ? [...set.attachments] : [] });
    setEditingTagInput('');
    setDetailSet(null);
  };

  const addEditingTag = () => {
    const tag = editingTagInput.trim();
    if (tag && !(editingSet.tags || []).includes(tag)) {
      setEditingSet((p: any) => ({ ...p, tags: [...(p.tags || []), tag] }));
    }
    setEditingTagInput('');
  };

  const removeEditingTag = (tag: string) => {
    setEditingSet((p: any) => ({ ...p, tags: (p.tags || []).filter((t: string) => t !== tag) }));
  };

  const handleSetFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setSetFileUploading(true);
    const newAttachments: any[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
      const safePath = `question-sets/${editingSet.id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
      const { error } = await supabase.storage.from('question-attachments').upload(safePath, file);
      if (error) {
        toast({ title: '파일 업로드 실패', description: `${file.name}: ${error.message}`, variant: 'destructive' });
      } else {
        const { data: urlData } = supabase.storage.from('question-attachments').getPublicUrl(safePath);
        newAttachments.push({ name: file.name, url: urlData.publicUrl, path: safePath });
      }
    }
    if (newAttachments.length > 0) {
      setEditingSet((p: any) => ({ ...p, attachments: [...(p.attachments || []), ...newAttachments] }));
      toast({ title: `${newAttachments.length}개 파일 업로드 완료` });
    }
    setSetFileUploading(false);
    e.target.value = '';
  };

  const removeSetAttachment = async (index: number) => {
    const att = (editingSet.attachments || [])[index];
    if (att?.path) {
      await supabase.storage.from('question-attachments').remove([att.path]);
    }
    setEditingSet((p: any) => ({
      ...p,
      attachments: (p.attachments || []).filter((_: any, i: number) => i !== index),
    }));
  };

  const handleSaveSet = async () => {
    if (!editingSet) return;
    setSetSaving(true);
    try {
      const payload = {
        title: editingSet.title,
        scenario: editingSet.scenario,
        category: editingSet.category || null,
        grade: editingSet.grade || null,
        difficulty: editingSet.difficulty || 'medium',
        tags: editingSet.tags || [],
        attachments: editingSet.attachments || [],
      };
      const { error } = await supabase.from('question_sets').update(payload).eq('id', editingSet.id);
      if (error) throw error;
      toast({ title: '세트 정보 저장 완료' });
      setEditingSet(null);
      fetchAll();
    } catch (err: any) {
      toast({ title: '저장 실패', description: err.message, variant: 'destructive' });
    } finally {
      setSetSaving(false);
    }
  };

  const buildSetJsonTemplate = (set: any, qs: any[]) => {
    return {
      title: set.title || '',
      scenario: set.scenario || '',
      category: set.category || null,
      grade: set.grade || null,
      difficulty: set.difficulty || 'medium',
      tags: set.tags || [],
      order_num: set.order_num || 1,
      attachments: Array.isArray(set.attachments) ? set.attachments : [],
      questions: (qs || []).map((q, i) => ({
        set_order: q.set_order ?? i + 1,
        content: q.content || '',
        type: q.type,
        category: q.category || null,
        grade: q.grade || null,
        difficulty: q.difficulty || 'medium',
        max_score: q.max_score ?? 0,
        tags: q.tags || [],
        allow_file_upload: q.allow_file_upload ?? true,
        options: q.options ?? null,
        correct_answer: q.correct_answer ?? null,
        attachments: Array.isArray(q.attachments) ? q.attachments : [],
        submission_slots: q.submission_slots ?? null,
      })),
    };
  };

  // 세트 편집(덮어쓰기)용 빈 샘플 템플릿 — 모든 문제 유형 예시 포함
  const SAMPLE_EDIT_SET = {
    title: '예시 세트: AI 활용 종합 평가',
    scenario:
      '## 시나리오\n' +
      '귀하는 OO기업 디지털혁신팀 담당자입니다. 첨부 자료를 참고하여 아래 과목들을 수행하세요.\n\n' +
      '- 제출물은 모두 본인이 직접 작성/실행해야 합니다.\n' +
      '- 표·코드 블록 등 마크다운 문법을 자유롭게 사용할 수 있습니다.\n\n' +
      '| 과목 | 배점 | 유형 |\n|---|---|---|\n| 1 | 30 | 객관식 |\n| 2 | 20 | 단답형 |\n| 3 | 50 | 작업형 |',
    category: '생성형AI활용',
    grade: 'blue',
    difficulty: 'medium',
    tags: ['샘플', '템플릿'],
    order_num: 1,
    attachments: [
      // { name: 'case_study.pdf', url: 'https://.../case_study.pdf', path: 'question-sets/<id>/...pdf' }
    ],
    questions: [
      {
        set_order: 1,
        content:
          '## 과목1. 개념 이해 (객관식)\n다음 중 생성형 AI의 특징으로 가장 적절한 것은?',
        type: 'multiple_choice',
        category: '생성형AI활용',
        grade: 'blue',
        difficulty: 'easy',
        max_score: 30,
        tags: [],
        allow_file_upload: false,
        options: [
          { text: '주어진 데이터를 그대로 검색만 수행한다' },
          { text: '학습된 패턴을 바탕으로 새 콘텐츠를 생성한다' },
          { text: '오직 이미지 분류 작업만 가능하다' },
          { text: '항상 100% 정확한 답을 보장한다' },
        ],
        correct_answer: 1, // 정답 인덱스 (0부터 시작) 또는 보기 텍스트 가능
        attachments: [],
        submission_slots: null,
      },
      {
        set_order: 2,
        content:
          '## 과목2. 용어 정의 (단답형)\n대규모 언어모델을 가리키는 영문 약어를 쓰시오.',
        type: 'short_answer',
        category: '생성형AI활용',
        grade: 'blue',
        difficulty: 'easy',
        max_score: 20,
        tags: [],
        allow_file_upload: false,
        options: null,
        correct_answer: ['LLM', 'llm', 'Large Language Model'], // 문자열 또는 배열(복수 정답)
        attachments: [],
        submission_slots: null,
      },
      {
        set_order: 3,
        content:
          '## 과목3. 작업형 (URL/파일/텍스트/숫자 슬롯)\n첨부 자료를 분석하여 프로토타입을 만들고 결과를 제출하세요.',
        type: 'work_based',
        category: '생성형AI활용',
        grade: 'blue',
        difficulty: 'medium',
        max_score: 50,
        tags: [],
        allow_file_upload: true,
        options: null,
        correct_answer: '모범답안/해설 (관리자·AI 채점 참고용)',
        attachments: [],
        submission_slots: [
          {
            id: 'prompt_url',
            type: 'url',
            label: '(1) 프롬프트 공유 URL',
            max_score: 15,
            required: true,
            auto_grade: 'none',
            rubric: 'URL 접속하여 구조 확인 후 수동 채점',
          },
          {
            id: 'code_file',
            type: 'file',
            label: '(2) 코드 파일 (.py/.ipynb)',
            max_score: 15,
            required: true,
            accept: '.py,.ipynb',
            max_size_mb: 10,
            auto_grade: 'none',
            rubric: '파일 다운로드 후 코드 품질 수동 채점',
          },
          {
            id: 'model_name',
            type: 'text',
            label: '(3) 사용한 모델명',
            max_score: 10,
            required: true,
            correct_answer: 'gpt-4o-mini',
            auto_grade: 'exact',
            rubric: '정확히 일치 시 정답',
          },
          {
            id: 'token_count',
            type: 'number',
            label: '(4) 평균 응답 토큰 수',
            max_score: 10,
            required: true,
            correct_answer: 350,
            auto_grade: 'numeric',
            tolerance: 50,
            rubric: '350 ±50 범위면 정답',
          },
        ],
      },
    ],
  } as const;

  const openJsonOverwrite = () => {
    if (!editingSet) return;
    const qs = questionsBySet[editingSet.id] || [];
    setJsonOverwriteText(JSON.stringify(buildSetJsonTemplate(editingSet, qs), null, 2));
    setJsonOverwriteError(null);
    setJsonOverwriteOpen(true);
  };

  const fillSampleTemplate = () => {
    if (!window.confirm('현재 입력된 JSON을 샘플 템플릿으로 교체합니다. 진행할까요?')) return;
    setJsonOverwriteText(JSON.stringify(SAMPLE_EDIT_SET, null, 2));
    setJsonOverwriteError(null);
  };

  const copySampleTemplate = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(SAMPLE_EDIT_SET, null, 2));
      toast({ title: '샘플 템플릿이 클립보드에 복사됨' });
    } catch (e: any) {
      toast({ title: '복사 실패', description: e.message, variant: 'destructive' });
    }
  };

  const resetToCurrentSet = () => {
    if (!editingSet) return;
    if (!window.confirm('현재 세트의 실제 내용으로 되돌립니다. 편집 중 변경사항이 사라집니다. 진행할까요?')) return;
    const qs = questionsBySet[editingSet.id] || [];
    setJsonOverwriteText(JSON.stringify(buildSetJsonTemplate(editingSet, qs), null, 2));
    setJsonOverwriteError(null);
  };

  const copyJsonText = async () => {
    try {
      await navigator.clipboard.writeText(jsonOverwriteText);
      toast({ title: '현재 JSON 복사됨' });
    } catch (e: any) {
      toast({ title: '복사 실패', description: e.message, variant: 'destructive' });
    }
  };

  const downloadJsonText = () => {
    const blob = new Blob([jsonOverwriteText || JSON.stringify(SAMPLE_EDIT_SET, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (editingSet?.title || 'set').replace(/[^a-zA-Z0-9가-힣_-]+/g, '_').slice(0, 40);
    a.download = `set-edit-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // JSON 구조 검증 (위치 표시 포함). 반환: 오류 메시지 배열
  const validateOverwriteJson = (data: any): string[] => {
    const errs: string[] = [];
    const ALLOWED_TYPES = ['multiple_choice', 'short_answer', 'essay', 'work_based'];
    const ALLOWED_DIFF = ['easy', 'medium', 'hard'];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      errs.push('[root] 객체(JSON object) 여야 합니다.');
      return errs;
    }
    if (typeof data.title !== 'string' || !data.title.trim()) {
      errs.push('[root.title] 비어있지 않은 문자열이어야 합니다.');
    }
    if (data.scenario != null && typeof data.scenario !== 'string') {
      errs.push('[root.scenario] 문자열이어야 합니다.');
    }
    if (data.tags != null && !Array.isArray(data.tags)) {
      errs.push('[root.tags] 배열이어야 합니다.');
    } else if (Array.isArray(data.tags)) {
      data.tags.forEach((t: any, i: number) => {
        if (typeof t !== 'string') errs.push(`[root.tags[${i}]] 문자열이어야 합니다.`);
      });
    }
    if (data.difficulty != null && !ALLOWED_DIFF.includes(data.difficulty)) {
      errs.push(`[root.difficulty] easy|medium|hard 중 하나여야 합니다 (현재: ${JSON.stringify(data.difficulty)}).`);
    }

    // attachments (root)
    const validateAttachments = (arr: any, path: string) => {
      if (arr == null) return;
      if (!Array.isArray(arr)) { errs.push(`[${path}] 배열이어야 합니다.`); return; }
      arr.forEach((a: any, i: number) => {
        const p = `${path}[${i}]`;
        if (!a || typeof a !== 'object' || Array.isArray(a)) {
          errs.push(`[${p}] 객체여야 합니다.`); return;
        }
        if (typeof a.name !== 'string' || !a.name.trim()) errs.push(`[${p}.name] 비어있지 않은 문자열이어야 합니다.`);
        if (typeof a.url !== 'string' || !a.url.trim()) errs.push(`[${p}.url] 비어있지 않은 문자열이어야 합니다.`);
        if (a.size != null && typeof a.size !== 'number') errs.push(`[${p}.size] 숫자여야 합니다.`);
        if (a.mime != null && typeof a.mime !== 'string') errs.push(`[${p}.mime] 문자열이어야 합니다.`);
        if (a.path != null && typeof a.path !== 'string') errs.push(`[${p}.path] 문자열이어야 합니다.`);
      });
    };
    validateAttachments(data.attachments, 'root.attachments');

    // questions
    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      errs.push('[root.questions] 1개 이상의 배열이어야 합니다.');
    } else {
      data.questions.forEach((q: any, i: number) => {
        const p = `questions[${i}]`;
        if (!q || typeof q !== 'object' || Array.isArray(q)) {
          errs.push(`[${p}] 객체여야 합니다.`); return;
        }
        if (typeof q.content !== 'string' || !q.content.trim()) {
          errs.push(`[${p}.content] 비어있지 않은 문자열이어야 합니다.`);
        }
        if (typeof q.type !== 'string' || !ALLOWED_TYPES.includes(q.type)) {
          errs.push(`[${p}.type] ${ALLOWED_TYPES.join('|')} 중 하나여야 합니다 (현재: ${JSON.stringify(q.type)}).`);
        }
        if (q.max_score == null || typeof q.max_score !== 'number' || q.max_score < 0) {
          errs.push(`[${p}.max_score] 0 이상 숫자여야 합니다.`);
        }
        if (q.difficulty != null && !ALLOWED_DIFF.includes(q.difficulty)) {
          errs.push(`[${p}.difficulty] easy|medium|hard 중 하나여야 합니다.`);
        }
        if (q.set_order != null && typeof q.set_order !== 'number') {
          errs.push(`[${p}.set_order] 숫자여야 합니다.`);
        }
        if (q.allow_file_upload != null && typeof q.allow_file_upload !== 'boolean') {
          errs.push(`[${p}.allow_file_upload] true/false 여야 합니다.`);
        }
        if (q.tags != null && !Array.isArray(q.tags)) {
          errs.push(`[${p}.tags] 배열이어야 합니다.`);
        }

        // 객관식 검증
        if (q.type === 'multiple_choice') {
          if (!Array.isArray(q.options) || q.options.length < 2) {
            errs.push(`[${p}.options] 객관식은 2개 이상 보기가 필요합니다.`);
          } else {
            q.options.forEach((opt: any, oi: number) => {
              const op = `${p}.options[${oi}]`;
              if (!opt || typeof opt !== 'object') { errs.push(`[${op}] 객체여야 합니다.`); return; }
              if (typeof opt.text !== 'string' || !opt.text.trim()) {
                errs.push(`[${op}.text] 비어있지 않은 문자열이어야 합니다.`);
              }
            });
          }
          if (q.correct_answer == null || (typeof q.correct_answer !== 'string' && typeof q.correct_answer !== 'number')) {
            errs.push(`[${p}.correct_answer] 객관식은 정답(인덱스 또는 값)이 필요합니다.`);
          }
        }

        // 단답형 검증
        if (q.type === 'short_answer') {
          if (q.correct_answer == null || (typeof q.correct_answer !== 'string' && !Array.isArray(q.correct_answer))) {
            errs.push(`[${p}.correct_answer] 단답형은 문자열 또는 배열이어야 합니다.`);
          }
        }

        // submission_slots
        if (q.submission_slots != null) {
          if (!Array.isArray(q.submission_slots)) {
            errs.push(`[${p}.submission_slots] 배열이어야 합니다.`);
          } else {
            q.submission_slots.forEach((s: any, si: number) => {
              const sp = `${p}.submission_slots[${si}]`;
              if (!s || typeof s !== 'object') { errs.push(`[${sp}] 객체여야 합니다.`); return; }
              if (s.label != null && typeof s.label !== 'string') errs.push(`[${sp}.label] 문자열이어야 합니다.`);
              if (s.type != null && typeof s.type !== 'string') errs.push(`[${sp}.type] 문자열이어야 합니다.`);
            });
          }
        }

        validateAttachments(q.attachments, `${p}.attachments`);
      });
    }
    return errs;
  };

  const runJsonValidation = () => {
    try {
      const parsed = JSON.parse(jsonOverwriteText);
      const errs = validateOverwriteJson(parsed);
      if (errs.length === 0) {
        setJsonOverwriteError(null);
        toast({ title: '검증 통과', description: `문제 ${parsed.questions.length}개 / 첨부 ${(parsed.attachments||[]).length}개` });
      } else {
        setJsonOverwriteError(`검증 실패 (${errs.length}건):\n` + errs.slice(0, 50).join('\n') + (errs.length > 50 ? `\n... 외 ${errs.length - 50}건` : ''));
      }
    } catch (e: any) {
      setJsonOverwriteError(`JSON 파싱 실패: ${e.message}`);
    }
  };

  const applyJsonOverwrite = async () => {
    if (!editingSet) return;
    let parsed: any;
    try {
      parsed = JSON.parse(jsonOverwriteText);
    } catch (e: any) {
      setJsonOverwriteError(`JSON 파싱 실패: ${e.message}`);
      return;
    }
    const errs = validateOverwriteJson(parsed);
    if (errs.length > 0) {
      setJsonOverwriteError(`검증 실패 (${errs.length}건) — 먼저 오류를 수정하세요:\n` + errs.slice(0, 50).join('\n') + (errs.length > 50 ? `\n... 외 ${errs.length - 50}건` : ''));
      return;
    }
    // 응시 기록 확인 → 경고
    const { count: answerCount } = await supabase
      .from('answers')
      .select('id', { count: 'exact', head: true })
      .in('question_id', (questionsBySet[editingSet.id] || []).map((q: any) => q.id));
    const warnMsg = (answerCount || 0) > 0
      ? `⚠️ 이 세트의 문제에 응시 답안 ${answerCount}건이 이미 존재합니다.\n덮어쓰면 해당 답안의 문제 연결이 끊겨 기존 채점/통계가 손상됩니다.\n\n그래도 진행하시겠습니까?`
      : `이 세트의 기존 문제 ${(questionsBySet[editingSet.id] || []).length}개가 모두 삭제되고 JSON 내용으로 재생성됩니다.\n\n진행하시겠습니까?`;
    if (!window.confirm(warnMsg)) return;

    setJsonOverwriteApplying(true);
    try {
      const setId = editingSet.id;
      const setUpdate: any = {
        title: parsed.title,
        scenario: parsed.scenario ?? '',
        category: parsed.category ?? null,
        grade: parsed.grade ?? null,
        difficulty: parsed.difficulty ?? 'medium',
        tags: parsed.tags ?? [],
        order_num: parsed.order_num ?? editingSet.order_num ?? 1,
        attachments: parsed.attachments ?? [],
        total_score: parsed.questions.reduce((s: number, q: any) => s + (q.max_score || 0), 0),
      };
      const { error: setErr } = await supabase.from('question_sets').update(setUpdate).eq('id', setId);
      if (setErr) throw setErr;

      // 기존 문제 삭제 (답안은 ON DELETE에 따라 정리됨)
      const { error: delErr } = await supabase.from('questions').delete().eq('set_id', setId);
      if (delErr) throw delErr;

      // 새 문제 일괄 삽입
      const rows = parsed.questions.map((q: any, idx: number) => ({
        set_id: setId,
        set_order: q.set_order ?? idx + 1,
        order_num: idx + 1,
        content: q.content || '',
        type: q.type || 'work_based',
        category: q.category ?? parsed.category ?? '생성형AI활용',
        grade: q.grade ?? parsed.grade ?? null,
        difficulty: q.difficulty ?? 'medium',
        max_score: q.max_score ?? 0,
        tags: q.tags ?? [],
        allow_file_upload: q.allow_file_upload ?? true,
        options: q.options ?? null,
        correct_answer: q.correct_answer ?? null,
        attachments: q.attachments ?? [],
        submission_slots: q.submission_slots ?? null,
      }));
      const { error: insErr } = await supabase.from('questions').insert(rows);
      if (insErr) throw insErr;

      toast({ title: 'JSON 덮어쓰기 완료', description: `문제 ${rows.length}개 재생성됨` });
      setJsonOverwriteOpen(false);
      setEditingSet(null);
      fetchAll();
    } catch (err: any) {
      setJsonOverwriteError(err.message || String(err));
      toast({ title: '덮어쓰기 실패', description: err.message, variant: 'destructive' });
    } finally {
      setJsonOverwriteApplying(false);
    }
  };

  const filtered = sets.filter(s => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (s.title || '').toLowerCase().includes(q)
      || (s.scenario || '').toLowerCase().includes(q)
      || (s.tags || []).some((t: string) => t.toLowerCase().includes(q))
      || (s.category || '').toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'recent') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortBy === 'old') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (sortBy === 'name') return (a.title || '').localeCompare(b.title || '', 'ko');
    return 0;
  });

  return (
    <div className="space-y-3">
      <input
        ref={subjectFileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          uploadSubjectAttachments(selectedQuestionRef.current || '', e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="세트 검색 (제목/카테고리/시나리오/태그)"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="pl-8 w-[280px] text-[12px] h-8"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-[130px] text-[12px] h-8">
            <ArrowUpDown className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent" className="text-[12px]">최근 등록순</SelectItem>
            <SelectItem value="old" className="text-[12px]">오래된 순</SelectItem>
            <SelectItem value="name" className="text-[12px]">이름순</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[12px] text-muted-foreground ml-auto">
          {sorted.length}개 세트 · 총 {Object.values(questionsBySet).reduce((s, arr) => s + arr.length, 0)}개 문제
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-[12px] text-muted-foreground">
          등록된 세트가 없습니다. "세트 업로드(JSON)" 버튼으로 추가하세요.
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map(set => {
            const childQs = questionsBySet[set.id] || [];
            const totalSlots = childQs.reduce((s, q) => s + ((q.submission_slots as any[])?.length || 0), 0);
            const computedScore = childQs.reduce((s, q) => s + (q.max_score || 0), 0);
            const attachments = (set.attachments as any[]) || [];
            const isOpen = !!expandedSets[set.id];
            return (
              <Card key={set.id} className="overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b bg-muted/30 flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleSet(set.id)}
                    className="flex-shrink-0 mt-0.5 p-0.5 hover:bg-muted rounded"
                    aria-label={isOpen ? '접기' : '펼치기'}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0 space-y-1.5 cursor-pointer" onClick={() => toggleSet(set.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[14px] font-semibold truncate">{set.title}</h3>
                      {set.category && (
                        <Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", categoryColors[set.category])}>
                          {set.category}
                        </Badge>
                      )}
                      {set.grade && <GradeBadge grade={set.grade} className="text-[10px]" />}
                      <Badge variant="outline" className={cn("text-[10px]", difficultyColors[set.difficulty])}>
                        {difficultyLabels[set.difficulty]}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {childQs.length}과목 · 슬롯 {totalSlots}개 · {computedScore}점
                      </Badge>
                    </div>
                    {set.scenario && (
                      <div className={cn(mdProseClass, 'text-[11px] text-muted-foreground line-clamp-2')}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {set.scenario.slice(0, 200) + (set.scenario.length > 200 ? '…' : '')}
                        </ReactMarkdown>
                      </div>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>등록 {format(new Date(set.created_at), 'yy.MM.dd')}</span>
                      {attachments.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Paperclip className="h-3 w-3" /> 첨부 {attachments.length}
                        </span>
                      )}
                      {(set.tags || []).length > 0 && (
                        <span>태그: {(set.tags || []).join(', ')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <label
                      className={cn(
                        "flex items-center gap-1.5 text-[10.5px] px-2 py-1 rounded border whitespace-nowrap cursor-pointer select-none",
                        set.proctoring_disabled
                          ? "bg-amber-50 border-amber-300 text-amber-800"
                          : "bg-background border-border text-muted-foreground hover:bg-muted/40",
                      )}
                      title="ON: 이 세트 풀이 중 전체화면/얼굴/음성 감지를 일시 중지 (생성형 AI 작업형 등)"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ShieldOff className="h-3 w-3" />
                      감독 OFF
                      <Switch
                        checked={!!set.proctoring_disabled}
                        onCheckedChange={(v) => toggleProctoringDisabled(set.id, v)}
                        className="scale-75 -my-1"
                      />
                    </label>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={(e) => { e.stopPropagation(); openSetEdit(set); }}>
                      <Pencil className="h-3.5 w-3.5" /> 편집
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={(e) => { e.stopPropagation(); setPreviewSet(set); }} title="응시생이 보는 화면 미리보기">
                      <Eye className="h-3.5 w-3.5" /> 응시생 미리보기
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setDetailSet(set)}>
                      <Eye className="h-3.5 w-3.5" /> 상세
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(set)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Child questions (collapsible) */}
                {isOpen && (
                  <div className="divide-y">
                    {childQs.length === 0 ? (
                      <div className="p-3 text-[11px] text-muted-foreground italic">소속 문제 없음</div>
                    ) : childQs.map((q, idx) => {
                      const slots = (q.submission_slots as SlotInfo[]) || [];
                      const qOpen = !!expandedQuestions[q.id];
                      return (
                        <div key={q.id}>
                          <button
                            type="button"
                            onClick={() => toggleQuestion(q.id)}
                            className="w-full p-3 flex items-start gap-3 hover:bg-muted/30 text-left"
                          >
                            <div className="flex-shrink-0 mt-0.5">
                              {qOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </div>
                            <div className="text-[11px] font-medium text-muted-foreground flex-shrink-0 w-10">
                              과목{q.set_order ?? idx + 1}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {q.category && (
                                  <Badge variant="outline" className={cn("text-[10px]", categoryColors[q.category])}>
                                    {q.category}
                                  </Badge>
                                )}
                                <span className="text-[12px] font-medium">
                                  {(q.content || '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 60)}
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                                  슬롯 {slots.length}개 · {q.max_score}점
                                  {((q.attachments as any[]) || []).length > 0 && (
                                    <span className="ml-1.5 inline-flex items-center gap-0.5">
                                      <Paperclip className="h-2.5 w-2.5" />
                                      {((q.attachments as any[]) || []).length}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                          </button>

                          {qOpen && (
                            <div className="px-3 pb-3 pl-[60px] space-y-2 bg-muted/10">
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[11px] gap-1"
                                  onClick={() => setEditQ({ ...q })}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  문제 편집
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[11px] gap-1"
                                  disabled={uploadingQuestionId === q.id}
                                  onClick={() => openSubjectFilePicker(q.id)}
                                >
                                  {uploadingQuestionId === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                  과목 첨부 추가
                                </Button>
                                <span className="text-[10px] text-muted-foreground">이 파일은 과목{q.set_order ?? idx + 1}에만 연결됩니다.</span>
                              </div>
                              {q.content && (
                                <div className={cn(mdProseClass, 'text-[11px] bg-background border rounded p-2 max-h-[160px] overflow-auto')}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.content}</ReactMarkdown>
                                </div>
                              )}
                              {((q.attachments as any[]) || []).length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {((q.attachments as any[]) || []).map((a: any, i: number) => (
                                    <span
                                      key={i}
                                      className="inline-flex items-center gap-1 text-[10px] px-2 py-1 border rounded bg-background"
                                    >
                                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                                        <Paperclip className="h-3 w-3" /> {a.name} <ExternalLink className="h-2.5 w-2.5" />
                                      </a>
                                      <button
                                        type="button"
                                        className="ml-1 text-muted-foreground hover:text-destructive"
                                        disabled={uploadingQuestionId === q.id}
                                        onClick={() => removeSubjectAttachment(q.id, i)}
                                        aria-label={`${a.name} 첨부 삭제`}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {slots.length === 0 ? (
                                <div className="text-[10px] text-muted-foreground italic">슬롯 없음</div>
                              ) : (
                                <div className="space-y-1.5">
                                  {slots.map(slot => (
                                    <div key={slot.id} className="border bg-background rounded p-2 text-[11px] space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant="outline" className={cn("text-[9px]", slotTypeColors[slot.type] || '')}>
                                          {slotTypeLabels[slot.type] || slot.type}
                                        </Badge>
                                        <span className="font-medium">{slot.label}</span>
                                        {slot.auto_grade && slot.auto_grade !== 'none' && (
                                          <Badge variant="secondary" className="text-[9px]">자동: {slot.auto_grade}</Badge>
                                        )}
                                        <span className="ml-auto text-muted-foreground">{slot.max_score}점</span>
                                      </div>
                                      {slot.correct_answer != null && slot.correct_answer !== '' && (
                                        <div><span className="text-muted-foreground">정답: </span><span className="font-medium">{String(slot.correct_answer)}{slot.tolerance != null ? ` (±${slot.tolerance})` : ''}</span></div>
                                      )}
                                      {slot.rubric && (
                                        <div className="text-muted-foreground whitespace-pre-wrap">기준: {slot.rubric}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 상세 다이얼로그 */}
      <Dialog open={!!detailSet} onOpenChange={(o) => !o && setDetailSet(null)}>
        <DialogContent className="max-w-[900px] max-h-[85vh] overflow-auto">
          {detailSet && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle className="text-[14px]">{detailSet.title}</DialogTitle>
                    <DialogDescription className="text-[11px]">
                      {detailSet.category} · {(questionsBySet[detailSet.id] || []).length}과목 · 등록 {format(new Date(detailSet.created_at), 'yyyy-MM-dd HH:mm')}
                    </DialogDescription>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => openSetEdit(detailSet)}>
                    <Pencil className="h-3.5 w-3.5" /> 편집
                  </Button>
                </div>
              </DialogHeader>

              {detailSet.scenario && (
                <div>
                  <div className="text-[11px] font-medium mb-1">시나리오</div>
                  <div className={cn(mdProseClass, 'bg-muted/40 rounded p-3 text-[12px] max-h-[200px] overflow-auto')}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{detailSet.scenario}</ReactMarkdown>
                  </div>
                </div>
              )}

              {((detailSet.attachments as any[]) || []).length > 0 && (
                <div>
                  <div className="text-[11px] font-medium mb-1">첨부파일</div>
                  <div className="flex flex-wrap gap-1.5">
                    {((detailSet.attachments as any[]) || []).map((a, i) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border rounded hover:bg-muted"
                      >
                        <Paperclip className="h-3 w-3" /> {a.name} <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="text-[11px] font-medium">과목별 문제 & 슬롯</div>
                {(questionsBySet[detailSet.id] || []).map((q, idx) => {
                  const slots = (q.submission_slots as SlotInfo[]) || [];
                  return (
                    <Card key={q.id} className="p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className="text-[10px]">과목 {q.set_order ?? idx + 1}</Badge>
                        {q.category && (
                          <Badge variant="outline" className={cn("text-[10px]", categoryColors[q.category])}>
                            {q.category}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1 ml-auto"
                          onClick={() => setEditQ({ ...q })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          편집
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1"
                          disabled={uploadingQuestionId === q.id}
                          onClick={() => openSubjectFilePicker(q.id)}
                        >
                          {uploadingQuestionId === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          과목 첨부 추가
                        </Button>
                        <span className="text-[11px] text-muted-foreground">{q.max_score}점</span>
                      </div>
                      <div className={cn(mdProseClass, 'text-[12px] bg-muted/30 rounded p-2 max-h-[120px] overflow-auto')}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.content}</ReactMarkdown>
                      </div>

                      {((q.attachments as any[]) || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {((q.attachments as any[]) || []).map((a: any, i: number) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border rounded bg-background"
                            >
                              <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                                <Paperclip className="h-3 w-3" /> {a.name} <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                              <button
                                type="button"
                                className="ml-1 text-muted-foreground hover:text-destructive"
                                disabled={uploadingQuestionId === q.id}
                                onClick={() => removeSubjectAttachment(q.id, i)}
                                aria-label={`${a.name} 첨부 삭제`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {slots.map(slot => (
                          <div key={slot.id} className="border rounded p-2 text-[11px] space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={cn("text-[9px]", slotTypeColors[slot.type] || '')}>
                                {slotTypeLabels[slot.type] || slot.type}
                              </Badge>
                              <span className="font-medium">{slot.label}</span>
                              {slot.auto_grade && slot.auto_grade !== 'none' && (
                                <Badge variant="secondary" className="text-[9px]">자동: {slot.auto_grade}</Badge>
                              )}
                              <span className="ml-auto text-muted-foreground">{slot.max_score}점</span>
                            </div>
                            {slot.correct_answer != null && slot.correct_answer !== '' && (
                              <div><span className="text-muted-foreground">정답: </span><span className="font-medium">{String(slot.correct_answer)}{slot.tolerance != null ? ` (±${slot.tolerance})` : ''}</span></div>
                            )}
                            {slot.rubric && (
                              <div className="text-muted-foreground whitespace-pre-wrap">기준: {slot.rubric}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>세트 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" 세트와 소속된 모든 문제({(questionsBySet[deleteTarget?.id] || []).length}개)를 삭제합니다.
              <br />이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 세트 편집 다이얼로그 */}
      <Dialog open={!!editingSet} onOpenChange={(o) => !o && setEditingSet(null)}>
        <DialogContent className="max-w-[700px] max-h-[85vh] overflow-y-auto">
          {editingSet && (
            <>
              <DialogHeader>
                <DialogTitle className="text-[14px]">세트 정보 편집</DialogTitle>
                <DialogDescription className="text-[11px]">{editingSet.title}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {/* 제목 */}
                <div className="space-y-1">
                  <Label className="text-[12px]">세트 제목</Label>
                  <Input value={editingSet.title || ''} onChange={e => setEditingSet((p: any) => ({ ...p, title: e.target.value }))} className="text-[12px]" />
                </div>
                {/* 시나리오 */}
                <div className="space-y-1">
                  <Label className="text-[12px]">시나리오 (마크다운)</Label>
                  <Textarea value={editingSet.scenario || ''} onChange={e => setEditingSet((p: any) => ({ ...p, scenario: e.target.value }))} className="text-[12px] min-h-[100px]" />
                </div>
                {/* JSON 통째 수정 */}
                <div className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1.5">
                  <div className="text-[11px] text-muted-foreground">
                    문제 내용까지 통째로 바꾸려면 JSON으로 덮어쓰기 하세요. (기존 문제는 모두 삭제 후 재생성)
                  </div>
                  <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={openJsonOverwrite}>
                    <FileJson className="h-3.5 w-3.5" /> JSON으로 통째 수정
                  </Button>
                </div>
                {/* 카테고리/등급/난이도 */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[12px]">카테고리</Label>
                    <Select value={editingSet.category || '__none__'} onValueChange={v => setEditingSet((p: any) => ({ ...p, category: v === '__none__' ? null : v }))}>
                      <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-[12px]">미지정</SelectItem>
                        <SelectItem value="생성형AI활용" className="text-[12px]">생성형AI활용</SelectItem>
                        <SelectItem value="데이터분석" className="text-[12px]">데이터분석</SelectItem>
                        <SelectItem value="서비스구현" className="text-[12px]">서비스구현</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[12px]">등급</Label>
                    <Select value={editingSet.grade || '__none__'} onValueChange={v => setEditingSet((p: any) => ({ ...p, grade: v === '__none__' ? null : v }))}>
                      <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-[12px]">미지정</SelectItem>
                        <SelectItem value="green" className="text-[12px]">그린</SelectItem>
                        <SelectItem value="blue" className="text-[12px]">블루</SelectItem>
                        <SelectItem value="black" className="text-[12px]">블랙</SelectItem>
                        <SelectItem value="전문인재" className="text-[12px]">전문인재</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[12px]">난이도</Label>
                    <Select value={editingSet.difficulty || 'medium'} onValueChange={v => setEditingSet((p: any) => ({ ...p, difficulty: v }))}>
                      <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy" className="text-[12px]">하</SelectItem>
                        <SelectItem value="medium" className="text-[12px]">중</SelectItem>
                        <SelectItem value="hard" className="text-[12px]">상</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* 태그 */}
                <div className="space-y-1">
                  <Label className="text-[12px]">태그</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={editingTagInput}
                      onChange={e => setEditingTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEditingTag(); } }}
                      placeholder="태그 입력 후 Enter"
                      className="text-[12px] h-8"
                    />
                    <Button type="button" variant="outline" size="sm" className="h-8 text-[11px]" onClick={addEditingTag}>추가</Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(editingSet.tags || []).map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] gap-1">
                        {tag}
                        <button type="button" className="hover:text-destructive" onClick={() => removeEditingTag(tag)}><X className="h-2.5 w-2.5" /></button>
                      </Badge>
                    ))}
                  </div>
                </div>
                {/* 첨부파일 */}
                <div className="space-y-1">
                  <Label className="text-[12px]">세트 첨부파일</Label>
                  <div className="flex items-center gap-2">
                    <input ref={setFileRef} type="file" multiple className="hidden" onChange={handleSetFileUpload} />
                    <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] gap-1" disabled={setFileUploading} onClick={() => setFileRef.current?.click()}>
                      {setFileUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      파일 추가
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(editingSet.attachments || []).map((a: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border rounded bg-background">
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                          <Paperclip className="h-3 w-3" /> {a.name}
                        </a>
                        <button type="button" className="ml-1 text-muted-foreground hover:text-destructive" onClick={() => removeSetAttachment(i)}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" size="sm" className="text-[12px]" onClick={() => setEditingSet(null)} disabled={setSaving}>취소</Button>
                <Button size="sm" className="text-[12px]" onClick={handleSaveSet} disabled={setSaving || !editingSet.title?.trim()}>
                  {setSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  저장
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* JSON 통째 수정(덮어쓰기) 다이얼로그 */}
      <Dialog open={jsonOverwriteOpen} onOpenChange={(o) => { if (!jsonOverwriteApplying) setJsonOverwriteOpen(o); }}>
        <DialogContent className="max-w-[1000px] w-[95vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-[14px] flex items-center gap-1.5">
              <FileJson className="h-4 w-4" /> 세트 JSON 덮어쓰기
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              세트 메타데이터와 문제 전체를 JSON으로 한 번에 교체합니다. 기존 문제는 삭제됩니다.
            </DialogDescription>
          </DialogHeader>

          {/* 템플릿 액션 바 */}
          <div className="flex flex-wrap items-center gap-2 border rounded-md p-2 bg-muted/30">
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={fillSampleTemplate}>
              <Sparkles className="h-3.5 w-3.5" /> 샘플 템플릿 채우기
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={copySampleTemplate}>
              <Copy className="h-3.5 w-3.5" /> 샘플 템플릿 복사하기
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={resetToCurrentSet}>
              <RotateCcw className="h-3.5 w-3.5" /> 현재 세트로 되돌리기
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={copyJsonText} disabled={!jsonOverwriteText.trim()}>
              <Copy className="h-3.5 w-3.5" /> 현재 JSON 복사
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={downloadJsonText}>
              <Download className="h-3.5 w-3.5" /> .json 다운로드
            </Button>
            <span className="text-[10.5px] text-muted-foreground ml-auto">
              스키마: 단일 세트 = {`{ title, scenario, …, questions: [ … ] }`}
            </span>
          </div>

          {/* 스키마 가이드 */}
          <details className="border rounded-md text-[11px]">
            <summary className="cursor-pointer px-2 py-1.5 bg-muted/40 select-none">
              📘 필드 가이드 (펼쳐서 확인)
            </summary>
            <pre className="p-2 font-mono whitespace-pre-wrap leading-relaxed text-[11px]">{`[세트 루트]
title*        : string  세트 제목
scenario      : string  마크다운 가능 (표/코드/리스트 등)
category      : '생성형AI활용' | '데이터분석' | ... | null
grade         : 'green' | 'blue' | 'red' | 'specialist' | null
difficulty    : 'easy' | 'medium' | 'hard'  (기본 medium)
tags          : string[]
order_num     : number
attachments   : [{ name*, url*, path?, size?, mime? }]

[questions 배열 — 각 과목 1개]
set_order*    : number  (1부터)
content*      : string  마크다운 가능
type*         : 'multiple_choice' | 'short_answer' | 'essay' | 'work_based'
category      : string
difficulty    : 'easy' | 'medium' | 'hard'
max_score*    : number  (0 이상)
allow_file_upload : boolean
attachments   : 위 attachments 와 동일 구조

  ▸ multiple_choice
    options*       : [{ text* }, ...]  (2개 이상)
    correct_answer*: number(인덱스 0부터) 또는 string(보기 텍스트)

  ▸ short_answer
    correct_answer*: string  또는  string[]  (복수 정답 허용)

  ▸ essay / work_based
    correct_answer : string  (모범답안, 채점 참고용)
    submission_slots : [
      {
        id*, label*,
        type* : 'text' | 'long_text' | 'url' | 'number' | 'file',
        max_score*: number, required?: boolean,
        auto_grade?: 'none' | 'exact' | 'numeric' | 'ai',
        rubric?: string,
        // text/long_text: correct_answer?: string
        // number       : correct_answer?: number, tolerance?: number
        // file         : accept?: string,  max_size_mb?: number
      }
    ]

* = 필수`}</pre>
          </details>

          <Textarea
            value={jsonOverwriteText}
            onChange={(e) => { setJsonOverwriteText(e.target.value); setJsonOverwriteError(null); }}
            className="font-mono text-[11px] min-h-[340px] flex-1"
            spellCheck={false}
          />
          {jsonOverwriteError && (
            <Card className="p-2 border-destructive bg-destructive/5 text-[11px] text-destructive whitespace-pre-wrap font-mono">
              {jsonOverwriteError}
            </Card>
          )}
          <div className="flex justify-between items-center gap-2 mt-2">
            <div className="text-[10px] text-muted-foreground">
              필수: title, questions[].content, questions[].type, questions[].max_score. 첨부는 name+url 필수.
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-[12px]" onClick={() => setJsonOverwriteOpen(false)} disabled={jsonOverwriteApplying}>취소</Button>
              <Button variant="secondary" size="sm" className="text-[12px]" onClick={runJsonValidation} disabled={jsonOverwriteApplying || !jsonOverwriteText.trim()}>검증</Button>
              <Button size="sm" className="text-[12px] gap-1" onClick={applyJsonOverwrite} disabled={jsonOverwriteApplying || !jsonOverwriteText.trim()}>
                {jsonOverwriteApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                덮어쓰기 적용
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>



      {/* 문제 편집 다이얼로그 */}
      {editQ && (
        <QuestionEditDialog
          open={!!editQ}
          onOpenChange={(o) => !o && setEditQ(null)}
          editQ={editQ}
          setEditQ={(fn) => setEditQ((p: any) => fn(p))}
          onSaved={() => { setEditQ(null); fetchAll(); }}
        />
      )}

      {/* 응시생 화면 미리보기 */}
      <ApplicantPreviewDialog
        open={!!previewSet}
        onOpenChange={(o) => !o && setPreviewSet(null)}
        set={previewSet}
        questions={previewSet ? (questionsBySet[previewSet.id] || []) : []}
      />
    </div>
  );
}
