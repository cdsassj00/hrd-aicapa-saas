import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { GradeBadge } from '@/components/GradeBadge';
import { ExamGrade, ExamStatus } from '@/types';
import { Plus, Pencil, Trash2, Video, VideoOff, ListChecks, Users, Sparkles, Loader2, FileText, Copy, Key } from 'lucide-react';
import { downloadAnswerKey } from '@/lib/examBulkExport';
import { QuestionPickerDialog } from '@/components/exam/QuestionPickerDialog';
import { InvitationManager } from '@/components/InvitationManager';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { questionTypeLabels } from '@/components/question-bank/questionTypes';
import ExamCustomTextsEditor from '@/components/admin/ExamCustomTextsEditor';
import { ExamCustomTexts } from '@/lib/defaultCustomTexts';
import { ALERT_EVENT_DEFS } from '@/lib/alertEventTypes';

const statusLabels: Record<ExamStatus, string> = { draft: '초안', open: '접수중', closed: '마감' };
const regModeLabels: Record<string, string> = { open: '공개', invite_only: '초대전용', hybrid: '혼합' };

const categoryColors: Record<string, string> = {
  '생성형AI활용': 'bg-grade-green-bg text-grade-green border-grade-green/20',
  '데이터분석': 'bg-grade-blue-bg text-grade-blue border-grade-blue/20',
  '서비스구현': 'bg-grade-black-bg text-grade-black border-grade-black/20',
};

const difficultyLabels: Record<string, string> = { easy: '하', medium: '중', hard: '상' };

export default function ExamManagePage() {
  const [exams, setExams] = useState<any[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editExam, setEditExam] = useState<any>({});
  const [questionPickerOpen, setQuestionPickerOpen] = useState(false);
  const [pickerExamId, setPickerExamId] = useState<string>('');
  const [examQuestionCounts, setExamQuestionCounts] = useState<Record<string, number>>({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteExam, setInviteExam] = useState<{ id: string; title: string }>({ id: '', title: '' });
  const [polishing, setPolishing] = useState(false);
  const [customTextsOpen, setCustomTextsOpen] = useState(false);
  const { toast } = useToast();

  const DEFAULT_INSTRUCTIONS = `1. 평가 시작 후 추가시간은 제공되지 않으며, 정해진 종료 시각에 시험이 자동 종료됩니다.
2. 시험 중 웹캠은 반드시 켜진 상태를 유지해야 하며, 얼굴 전체가 화면에 보여야 합니다.
3. 시험 중 다른 탭이나 프로그램으로의 전환은 부정행위로 간주됩니다.
4. 시험 중 타인과의 대화, 메신저 사용, 외부 자료 참고는 부정행위로 간주됩니다.
5. 기술적 문제 발생 시 채팅으로 감독관에게 알려주시면 바로 대응해 드립니다.
6. 모든 답안 작성 후 최종 제출 버튼을 누르시어, 최종 제출해야 합니다.
7. 부정행위 적발 시 해당 시험은 무효 처리되며, 향후 응시가 제한될 수 있습니다.`;

  useEffect(() => { fetchExams(); }, []);

  const fetchExams = async () => {
    const { data } = await supabase.from('exams').select('*').order('exam_date', { ascending: false });
    if (data) setExams(data);

    // Fetch question counts per exam
    const { data: eqData } = await supabase.from('exam_questions').select('exam_id');
    if (eqData) {
      const counts: Record<string, number> = {};
      eqData.forEach((eq: any) => { counts[eq.exam_id] = (counts[eq.exam_id] || 0) + 1; });
      setExamQuestionCounts(counts);
    }
  };

  const openCreate = () => {
    setEditExam({ status: 'draft', grade: 'green', duration_minutes: 90, max_participants: 80, exam_date: new Date().toISOString().split('T')[0], registration_mode: 'open', instructions: DEFAULT_INSTRUCTIONS });
    setEditOpen(true);
  };

  const polishInstructions = async () => {
    setPolishing(true);
    try {
      const { data, error } = await supabase.functions.invoke('polish-instructions', {
        body: {
          instructions: editExam.instructions || '',
          examTitle: editExam.title || '',
          grade: editExam.grade || '',
          durationMinutes: editExam.duration_minutes || 90,
        },
      });
      if (error) throw error;
      if (data?.polished) {
        setEditExam((p: any) => ({ ...p, instructions: data.polished }));
        toast({ title: 'AI가 유의사항을 정리했습니다.' });
      }
    } catch (err: any) {
      toast({ title: '정리 실패', description: err.message, variant: 'destructive' });
    }
    setPolishing(false);
  };

  const openEdit = (exam: any) => {
    // Convert UTC exam_date to local datetime-local format for the input
    const localDate = exam.exam_date ? new Date(exam.exam_date) : null;
    const localDateStr = localDate
      ? `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}T${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`
      : '';
    setEditExam({ ...exam, exam_date: localDateStr });
    setEditOpen(true);
  };

  const handleSave = async () => {
    // Convert local datetime-local value to proper ISO string with timezone
    const examDateISO = editExam.exam_date ? new Date(editExam.exam_date).toISOString() : new Date().toISOString();

    // 2단계 시험 검증: 전체 시험 시간이 1단계 시간보다 커야 함
    if (editExam.phased_enabled) {
      const dur = Number(editExam.duration_minutes) || 0;
      const p1 = Number(editExam.phase1_minutes ?? 10) || 0;
      if (p1 <= 0) {
        toast({ title: '저장 실패', description: '1단계 시간은 1분 이상이어야 합니다.', variant: 'destructive' });
        return;
      }
      if (dur - p1 <= 0) {
        toast({ title: '저장 실패', description: '전체 시험 시간이 1단계 시간보다 커야 합니다 (2단계 시간이 0 이하).', variant: 'destructive' });
        return;
      }
    }

    const payload = {
      title: editExam.title,
      grade: editExam.grade,
      exam_date: examDateISO,
      duration_minutes: editExam.duration_minutes,
      max_participants: editExam.max_participants,
      status: editExam.status,
      instructions: editExam.instructions || '',
      registration_mode: editExam.registration_mode || 'open',
      pass_score: editExam.pass_score ?? 75,
      is_test_mode: editExam.is_test_mode || false,
      allow_dual_monitor: editExam.allow_dual_monitor || false,
      skip_waiting_checks: editExam.skip_waiting_checks || false,
      skip_face_match: editExam.skip_face_match || false,
      block_late_entry: editExam.block_late_entry || false,
      entry_start_minutes: editExam.entry_start_minutes ?? 60,
      use_absolute_end: editExam.use_absolute_end || false,
      custom_texts: editExam.custom_texts || {},
      alert_event_types: Array.isArray(editExam.alert_event_types) ? editExam.alert_event_types : [],
      phased_enabled: editExam.phased_enabled || false,
      phase1_minutes: editExam.phased_enabled ? (Number(editExam.phase1_minutes) || 10) : 10,
    };

    if (editExam.id) {
      const { error } = await supabase.from('exams').update(payload).eq('id', editExam.id);
      if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
    } else {
      const { data, error } = await supabase.from('exams').insert(payload).select().single();
      if (error) { toast({ title: '생성 실패', description: error.message, variant: 'destructive' }); return; }

      if (data) {
        try {
          const { error: dailyError } = await supabase.functions.invoke('daily-room', {
            body: { action: 'create', exam_id: data.id, exam_title: data.title },
          });
          if (dailyError) throw dailyError;
          toast({ title: '시험 생성 및 화상 회의 개설 완료' });
        } catch (err: any) {
          toast({ title: '시험은 생성되었으나 화상 회의 개설 실패', description: err.message, variant: 'destructive' });
        }
      }
    }
    setEditOpen(false);
    fetchExams();
    if (editExam.id) toast({ title: '저장 완료' });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('exams').delete().eq('id', id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    fetchExams();
  };

  const handleDuplicate = async (exam: any) => {
    if (!confirm(`"${exam.title}" 시험을 복사하시겠습니까?\n(설정만 복사되며 문제/초대코드/응시 데이터는 비어 있는 상태로 생성됩니다)`)) return;
    const {
      id, created_at, current_participants, daily_room_name, daily_room_url,
      ...rest
    } = exam;
    const payload = {
      ...rest,
      title: `${exam.title} (복사본)`,
      status: 'draft' as ExamStatus,
      exam_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const { error } = await supabase.from('exams').insert(payload);
    if (error) { toast({ title: '복사 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '시험 복사 완료', description: '문제/초대코드는 새로 구성해 주세요.' });
    fetchExams();
  };

  const openQuestionPicker = (examId: string) => {
    setPickerExamId(examId);
    setQuestionPickerOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1>시험 관리</h1>
        <Button size="sm" className="text-[12px] gap-1 bg-action text-action-foreground hover:bg-action/90" onClick={openCreate}><Plus className="h-3.5 w-3.5" />시험 생성</Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[12px]">시험명</TableHead>
              <TableHead className="text-[12px]">등급</TableHead>
              <TableHead className="text-[12px]">일자</TableHead>
              <TableHead className="text-[12px]">시험 시간</TableHead>
              <TableHead className="text-[12px]">인원</TableHead>
              <TableHead className="text-[12px]">문제</TableHead>
              <TableHead className="text-[12px]">수강생</TableHead>
              <TableHead className="text-[12px]">화상</TableHead>
              <TableHead className="text-[12px]">상태</TableHead>
              <TableHead className="text-[12px]">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exams.map(exam => (
              <TableRow key={exam.id}>
                <TableCell className="text-[12px] font-medium">
                  {exam.title}
                  {exam.is_test_mode && <Badge className="ml-2 text-[9px] bg-amber-500/15 text-amber-600 border-amber-500/20 border">테스트</Badge>}
                </TableCell>
                <TableCell><GradeBadge grade={exam.grade} /></TableCell>
                <TableCell className="text-[12px]">
                  {new Date(exam.exam_date).toLocaleDateString('ko-KR')}
                </TableCell>
                <TableCell className="text-[12px]">
                  {new Date(exam.exam_date).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  {' ~ '}
                  {new Date(new Date(exam.exam_date).getTime() + exam.duration_minutes * 60000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  {' '}({exam.duration_minutes}분)
                </TableCell>
                <TableCell className="text-[12px]">{exam.max_participants}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="text-[11px] gap-1 h-7 text-info hover:text-info hover:bg-info-bg" onClick={() => openQuestionPicker(exam.id)}>
                    <ListChecks className="h-3.5 w-3.5" />
                    {examQuestionCounts[exam.id] || 0}개
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] shrink-0">{regModeLabels[exam.registration_mode] || '공개'}</Badge>
                    {(exam.registration_mode === 'invite_only' || exam.registration_mode === 'hybrid') && (
                      <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1.5 px-2.5 border-action/30 text-action hover:bg-action-muted" onClick={() => { setInviteExam({ id: exam.id, title: exam.title }); setInviteOpen(true); }}>
                        <Users className="h-3.5 w-3.5" /> 수강생 관리
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                {exam.daily_room_name ? (
                    <Badge variant="outline" className="text-[10px] gap-1 text-success border-success/30">
                      <Video className="h-3 w-3" /> 개설됨
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[10px] gap-1 h-7 text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        try {
                          const { error } = await supabase.functions.invoke('daily-room', {
                            body: { action: 'create', exam_id: exam.id, exam_title: exam.title },
                          });
                          if (error) throw error;
                          toast({ title: '화상 회의 개설 완료' });
                          fetchExams();
                        } catch (err: any) {
                          toast({ title: '화상 회의 개설 실패', description: err.message, variant: 'destructive' });
                        }
                      }}
                    >
                      <Video className="h-3 w-3" /> 개설하기
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn("text-[10px] border",
                      exam.status === 'open' && "bg-status-open-bg text-status-open border-status-open/20",
                      exam.status === 'draft' && "bg-status-draft-bg text-status-draft border-status-draft/20",
                      exam.status === 'closed' && "bg-status-closed-bg text-status-closed border-status-closed/20",
                    )}
                  >
                    {statusLabels[exam.status as ExamStatus]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(exam)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-amber-600"
                      title="채점자료(정답지 + 슬롯 규격) 다운로드"
                      onClick={async () => {
                        try {
                          await downloadAnswerKey(exam.id, exam.title);
                          toast({ title: '채점자료 다운로드 완료' });
                        } catch (err: any) {
                          toast({ title: '다운로드 실패', description: err.message, variant: 'destructive' });
                        }
                      }}
                    ><Key className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-info" title="복사" onClick={() => handleDuplicate(exam)}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(exam.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {exams.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-[12px] text-muted-foreground py-8">시험이 없습니다</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* Exam edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[14px]">{editExam.id ? '시험 편집' : '시험 생성'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label className="text-[12px]">시험명</Label><Input value={editExam.title || ''} onChange={e => setEditExam((p: any) => ({ ...p, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[12px]">등급</Label>
                <Select value={editExam.grade} onValueChange={v => setEditExam((p: any) => ({ ...p, grade: v }))}>
                  <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="green">그린</SelectItem>
                    <SelectItem value="blue">블루</SelectItem>
                    <SelectItem value="black">블랙</SelectItem>
                    <SelectItem value="전문인재">전문인재</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">상태</Label>
                <Select value={editExam.status} onValueChange={v => setEditExam((p: any) => ({ ...p, status: v }))}>
                  <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">초안</SelectItem>
                    <SelectItem value="open">접수중</SelectItem>
                    <SelectItem value="closed">마감</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">응시 방식</Label>
              <Select value={editExam.registration_mode || 'open'} onValueChange={v => setEditExam((p: any) => ({ ...p, registration_mode: v }))}>
                <SelectTrigger className="text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">공개 (자율 신청)</SelectItem>
                  <SelectItem value="invite_only">초대전용 (코드 필요)</SelectItem>
                  <SelectItem value="hybrid">혼합 (자율 + 초대)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-[12px]">시험 일시</Label><Input type="datetime-local" value={editExam.exam_date?.slice(0, 16) || ''} onChange={e => setEditExam((p: any) => ({ ...p, exam_date: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-[12px]">시험 시간(분)</Label><Input type="number" value={editExam.duration_minutes || ''} onChange={e => setEditExam((p: any) => ({ ...p, duration_minutes: +e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-[12px]">최대 인원</Label><Input type="number" value={editExam.max_participants || ''} onChange={e => setEditExam((p: any) => ({ ...p, max_participants: +e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-[12px]">합격 기준(점)</Label><Input type="number" value={editExam.pass_score ?? 75} onChange={e => setEditExam((p: any) => ({ ...p, pass_score: +e.target.value }))} min={0} max={100} /></div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[12px]">유의사항</Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 text-primary border-primary/30 hover:bg-primary/10"
                  onClick={polishInstructions}
                  disabled={polishing}
                >
                  {polishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {polishing ? 'AI 정리 중...' : 'AI로 정리'}
                </Button>
              </div>
              <Textarea value={editExam.instructions || ''} onChange={e => setEditExam((p: any) => ({ ...p, instructions: e.target.value }))} className="text-[12px] min-h-[120px]" placeholder="유의사항을 입력하거나 AI로 정리 버튼을 눌러주세요" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-md border bg-amber-50 dark:bg-amber-950/20">
                <Checkbox
                  id="testMode"
                  checked={editExam.is_test_mode || false}
                  onCheckedChange={(v) => setEditExam((p: any) => ({ ...p, is_test_mode: !!v }))}
                />
                <Label htmlFor="testMode" className="text-[12px] cursor-pointer">
                  <span className="font-medium">테스트 모드</span>
                  <span className="text-muted-foreground ml-1">— 시험일시 관계없이 언제든 접속 가능</span>
                </Label>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md border">
                <Checkbox
                  id="allowDualMonitor"
                  checked={editExam.allow_dual_monitor || false}
                  onCheckedChange={(v) => setEditExam((p: any) => ({ ...p, allow_dual_monitor: !!v }))}
                />
                <Label htmlFor="allowDualMonitor" className="text-[12px] cursor-pointer">
                  <span className="font-medium">듀얼 모니터 허용</span>
                  <span className="text-muted-foreground ml-1">— 응시자가 여러 모니터를 사용할 수 있도록 허용</span>
                </Label>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md border border-destructive/30 bg-destructive/5">
                <Checkbox
                  id="skipWaitingChecks"
                  checked={editExam.skip_waiting_checks || false}
                  onCheckedChange={(v) => setEditExam((p: any) => ({ ...p, skip_waiting_checks: !!v }))}
                />
                <Label htmlFor="skipWaitingChecks" className="text-[12px] cursor-pointer">
                  <span className="font-medium text-destructive">⚡ 환경점검 생략</span>
                  <span className="text-muted-foreground ml-1">— 웹캠·마이크·화면공유·신분증 검사를 건너뜀 (트래픽 긴급 대응용)</span>
                </Label>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md border">
                <Checkbox
                  id="skipFaceMatch"
                  checked={editExam.skip_face_match || false}
                  onCheckedChange={(v) => setEditExam((p: any) => ({ ...p, skip_face_match: !!v }))}
                />
                <Label htmlFor="skipFaceMatch" className="text-[12px] cursor-pointer">
                  <span className="font-medium">👤 얼굴 매칭 생략</span>
                  <span className="text-muted-foreground ml-1">— 신분증 업로드만으로 본인 확인 통과. 환경점검 얼굴 촬영·시험 중 AI 얼굴 감지 모두 비활성화</span>
                </Label>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md border">
                <Checkbox
                  id="useAbsoluteEnd"
                  checked={editExam.use_absolute_end || false}
                  onCheckedChange={(v) => setEditExam((p: any) => ({ ...p, use_absolute_end: !!v }))}
                />
                <Label htmlFor="useAbsoluteEnd" className="text-[12px] cursor-pointer">
                  <span className="font-medium">절대 종료 시간</span>
                  <span className="text-muted-foreground ml-1">— 모든 응시자가 동일 시간에 종료 (시험시작시각 + 시험시간 기준)</span>
                </Label>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md border">
                <Checkbox
                  id="blockLateEntry"
                  checked={editExam.block_late_entry || false}
                  onCheckedChange={(v) => setEditExam((p: any) => ({ ...p, block_late_entry: !!v }))}
                />
                <Label htmlFor="blockLateEntry" className="text-[12px] cursor-pointer">
                  <span className="font-medium">⛔ 늦은 입실 차단</span>
                  <span className="text-muted-foreground ml-1">— 평가 시작 시각 이후로 입실 불가 (지각자 응시 X)</span>
                </Label>
              </div>
              <div className="p-3 rounded-md border space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="phasedEnabled"
                    checked={editExam.phased_enabled || false}
                    onCheckedChange={(v) => setEditExam((p: any) => ({ ...p, phased_enabled: !!v, phase1_minutes: p.phase1_minutes ?? 10 }))}
                  />
                  <Label htmlFor="phasedEnabled" className="text-[12px] cursor-pointer">
                    <span className="font-medium">🧩 2단계 시험</span>
                    <span className="text-muted-foreground ml-1">— 1단계(독립 문항) → 2단계(세트 문항) 순차 진행</span>
                  </Label>
                </div>
                {editExam.phased_enabled && (
                  <div className="flex items-center gap-2 pl-6">
                    <Label htmlFor="phase1Minutes" className="text-[12px] whitespace-nowrap">
                      <span className="font-medium">1단계 시간</span>
                    </Label>
                    <Input
                      id="phase1Minutes"
                      type="number"
                      min={1}
                      className="w-20 h-8 text-[12px]"
                      value={editExam.phase1_minutes ?? 10}
                      onChange={(e) => setEditExam((p: any) => ({ ...p, phase1_minutes: Number(e.target.value) }))}
                    />
                    <span className="text-[11px] text-muted-foreground">분</span>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground pl-6">
                  1단계에는 세트에 속하지 않은 문제(객관식·단답형)만, 2단계에는 세트 문제(작업형)만 표시됩니다. 전체 시험 시간에서 1단계 시간을 뺀 나머지가 2단계 시간이 됩니다.
                </p>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-md border">
                <Label htmlFor="entryStartMinutes" className="text-[12px] whitespace-nowrap">
                  <span className="font-medium">입실 허용 시간</span>
                </Label>
                <Input
                  id="entryStartMinutes"
                  type="number"
                  min={10}
                  max={180}
                  className="w-20 h-8 text-[12px]"
                  value={editExam.entry_start_minutes ?? 60}
                  onChange={(e) => setEditExam((p: any) => ({ ...p, entry_start_minutes: Number(e.target.value) }))}
                />
                <span className="text-[11px] text-muted-foreground">분 전부터 입실 가능</span>
              </div>
            </div>
            <div className="space-y-2 p-3 rounded-md border">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Label className="text-[12px] font-medium">감독관 알림 이벤트</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    선택한 이벤트만 감독관 화면에 토스트 알림이 표시됩니다. (기본: 모두 OFF)
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {(editExam.alert_event_types || []).length}/{ALERT_EVENT_DEFS.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {ALERT_EVENT_DEFS.map(def => {
                  const checked = (editExam.alert_event_types || []).includes(def.key);
                  return (
                    <label
                      key={def.key}
                      className={cn(
                        'flex items-start gap-2 px-2 py-1.5 rounded border cursor-pointer text-[11px] hover:bg-muted/40',
                        checked && 'border-primary/40 bg-primary/5'
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setEditExam((p: any) => {
                            const cur: string[] = Array.isArray(p.alert_event_types) ? p.alert_event_types : [];
                            const next = v ? [...new Set([...cur, def.key])] : cur.filter(k => k !== def.key);
                            return { ...p, alert_event_types: next };
                          });
                        }}
                        className="mt-0.5"
                      />
                      <span className="leading-tight">
                        <span className="font-medium">{def.label}</span>
                        <span className="block text-[10px] text-muted-foreground">{def.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-md border">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[12px] gap-2"
                onClick={() => setCustomTextsOpen(true)}
              >
                <FileText className="h-3.5 w-3.5" /> 시험 문구 커스터마이징
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
            <Button onClick={handleSave}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuestionPickerDialog
        open={questionPickerOpen}
        onOpenChange={setQuestionPickerOpen}
        examId={pickerExamId}
        onSaved={fetchExams}
      />

      <InvitationManager examId={inviteExam.id} examTitle={inviteExam.title} open={inviteOpen} onOpenChange={setInviteOpen} />

      <ExamCustomTextsEditor
        open={customTextsOpen}
        onOpenChange={setCustomTextsOpen}
        value={editExam.custom_texts || {}}
        onChange={(v) => setEditExam((p: any) => ({ ...p, custom_texts: v }))}
      />
    </div>
  );
}
