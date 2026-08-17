import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GradeBadge } from '@/components/GradeBadge';
import { CalendarDays, Clock, Users, BookOpen, CheckCircle2, Info, RotateCcw, KeyRound } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function ApplicantMyPage() {
  const [exams, setExams] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [applyOpen, setApplyOpen] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [codeDialogOpen, setCodeDialogOpen] = useState(false);
  const { user, role, activeOrg, isPlatformAdmin } = useAuth();
  const isApplicantRole = role === 'applicant';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const autoInviteProcessed = useRef(false);

  useEffect(() => {
    fetchExams();
    if (user) fetchSessions();
  }, [user]);

  // Auto-process invite code from URL
  useEffect(() => {
    if (!user || autoInviteProcessed.current) return;
    const inviteParam = searchParams.get('invite');
    if (!inviteParam) return;
    autoInviteProcessed.current = true;
    // Clear the param from URL
    setSearchParams({}, { replace: true });
    autoApplyWithCode(inviteParam.trim().toUpperCase());
  }, [user, searchParams]);

  const autoApplyWithCode = async (code: string) => {
    // Look up the invitation
    const { data: inv } = await supabase
      .from('exam_invitations')
      .select('*, exams(*)')
      .eq('invite_code', code)
      .maybeSingle();

    if (!inv) {
      toast({ title: '유효하지 않은 응시코드입니다', variant: 'destructive' });
      return;
    }

    // 테스트 모드 시험이 아닐 때만 is_used 차단
    const isTestMode = (inv as any).exams?.is_test_mode === true;
    if (inv.is_used && !isTestMode) {
      toast({ title: '이미 사용된 응시코드입니다', variant: 'destructive' });
      return;
    }

    // Check for existing session
    const { data: existing } = await supabase
      .from('exam_sessions')
      .select('id, status')
      .eq('exam_id', inv.exam_id)
      .eq('applicant_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && (existing.status === 'waiting' || existing.status === 'in_progress')) {
      // 테스트 모드가 아닌 경우에만 is_used 마킹
      if (!isTestMode) {
        await supabase
          .from('exam_invitations')
          .update({ is_used: true, session_id: existing.id })
          .eq('id', inv.id);
      }
      toast({ title: '이미 신청된 시험입니다. 대기실로 이동합니다.' });
      navigate(`/applicant/waiting-room/${existing.id}`);
      return;
    }

    // Create new session (also handles retake: previous session was submitted/passed/failed)
    const { data: session, error } = await supabase
      .from('exam_sessions')
      .insert({ exam_id: inv.exam_id, applicant_id: user!.id })
      .select()
      .single();

    if (error) {
      toast({ title: '응시 신청 실패', description: error.message, variant: 'destructive' });
      return;
    }

    // 테스트 모드가 아닌 경우에만 is_used 마킹
    if (!isTestMode) {
      await supabase
        .from('exam_invitations')
        .update({ is_used: true, session_id: session.id })
        .eq('id', inv.id);
    }

    toast({ title: '응시 신청 완료! 대기실로 이동합니다.' });
    navigate(`/applicant/waiting-room/${session.id}`);
  };

  const fetchExams = async () => {
    const { data } = await supabase.from('exams').select('*').eq('status', 'open').order('exam_date');
    if (data) setExams(data);
  };

  const getExamRegMode = (examId: string) => {
    const exam = exams.find(e => e.id === examId);
    return exam?.registration_mode || 'open';
  };

  const needsInviteCode = (examId: string) => {
    const mode = getExamRegMode(examId);
    return mode === 'invite_only';
  };

  const fetchSessions = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('exam_sessions')
      .select('*, exams(*)')
      .eq('applicant_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setSessions(data);
  };

  const handleApply = async () => {
    if (!user || !selectedExamId) return;
    setIsApplying(true);

    const regMode = getExamRegMode(selectedExamId);

    // 초대전용/혼합에서 초대코드가 입력된 경우 검증
    if (inviteCode.trim() && (regMode === 'invite_only' || regMode === 'hybrid')) {
      const { data: inv } = await supabase
        .from('exam_invitations')
        .select('*, exams(is_test_mode)')
        .eq('exam_id', selectedExamId)
        .eq('invite_code', inviteCode.trim().toUpperCase())
        .maybeSingle();

      if (!inv) {
        toast({ title: '유효하지 않은 응시코드입니다', variant: 'destructive' });
        setIsApplying(false);
        return;
      }
      // 테스트 모드 시험은 is_used 무시
      const isTestMode = (inv as any).exams?.is_test_mode === true;
      if (inv.is_used && !isTestMode) {
        toast({ title: '이미 사용된 응시코드입니다', variant: 'destructive' });
        setIsApplying(false);
        return;
      }
    } else if (regMode === 'invite_only' && !isPlatformAdmin) {
      toast({ title: '이 시험은 응시코드가 필요합니다', variant: 'destructive' });
      setIsApplying(false);
      return;
    }

    // 기존 세션 확인
    const { data: existing } = await supabase
      .from('exam_sessions')
      .select('id, status')
      .eq('exam_id', selectedExamId)
      .eq('applicant_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (isPlatformAdmin) {
        await supabase.from('answers').delete().eq('session_id', existing.id);
        await supabase.from('exam_sessions').update({
          status: 'waiting', start_time: null, submit_time: null, score_total: null, is_flagged: false,
        }).eq('id', existing.id);
        toast({ title: '기존 세션 초기화 후 재사용합니다' });
        setIsApplying(false); setApplyOpen(false); setInviteCode('');
        fetchSessions();
        navigate(`/applicant/waiting-room/${existing.id}`);
        return;
      } else {
        toast({ title: '이미 신청한 시험입니다', variant: 'destructive' });
        setIsApplying(false); setApplyOpen(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from('exam_sessions')
      .insert({ exam_id: selectedExamId, applicant_id: user.id })
      .select()
      .single();

    if (error) {
      toast({ title: '신청 실패', description: error.message, variant: 'destructive' });
    } else {
      // 초대코드 사용 처리 (테스트 모드 시험은 재사용 가능하므로 마킹 스킵)
      if (inviteCode.trim()) {
        const selectedExam = exams.find(e => e.id === selectedExamId);
        if (!(selectedExam as any)?.is_test_mode) {
          await supabase
            .from('exam_invitations')
            .update({ is_used: true, session_id: data.id })
            .eq('exam_id', selectedExamId)
            .eq('invite_code', inviteCode.trim().toUpperCase());
        }
      }
      toast({ title: '응시 신청 완료' });
      fetchSessions();
      navigate(`/applicant/waiting-room/${data.id}`);
    }

    setIsApplying(false); setApplyOpen(false); setInviteCode('');
  };

  // 슈퍼관리자: 세션 초기화
  const handleResetSession = async (sessionId: string) => {
    const { error } = await supabase
      .from('exam_sessions')
      .update({ status: 'waiting', start_time: null, submit_time: null, score_total: null, is_flagged: false })
      .eq('id', sessionId);
    if (error) {
      toast({ title: '초기화 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '세션이 초기화되었습니다' });
      await supabase.from('answers').delete().eq('session_id', sessionId);
      fetchSessions();
    }
  };

  // 응시코드로 시험 찾기
  const handleCodeLookup = async () => {
    if (!inviteCode.trim()) return;
    const { data: inv } = await supabase
      .from('exam_invitations')
      .select('*, exams(*)')
      .eq('invite_code', inviteCode.trim().toUpperCase())
      .maybeSingle();

    if (!inv) {
      toast({ title: '유효하지 않은 응시코드입니다', variant: 'destructive' });
      return;
    }
    const isTestMode = (inv as any).exams?.is_test_mode === true;
    if (inv.is_used && !isTestMode) {
      toast({ title: '이미 사용된 응시코드입니다', variant: 'destructive' });
      return;
    }
    setSelectedExamId(inv.exam_id);
    setCodeDialogOpen(false);
    setApplyOpen(true);
  };

  const getStatusLabel = (status: string) => {
    // 응시자 역할에게는 합격/불합격을 노출하지 않고 '채점 완료'로 표시
    if (isApplicantRole && (status === 'passed' || status === 'failed')) return '채점 완료';
    const labels: Record<string, string> = { waiting: '대기', in_progress: '진행중', submitted: '제출완료', passed: '합격', failed: '불합격' };
    return labels[status] || status;
  };

  const getStatusBadgeVariant = (status: string): 'default' | 'destructive' | 'secondary' => {
    if (isApplicantRole && (status === 'passed' || status === 'failed')) return 'secondary';
    if (status === 'passed') return 'default';
    if (status === 'failed') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-6 max-w-[1200px]">
      <h1>마이페이지</h1>

      {/* 일반 사용자 가이드 (슈퍼관리자에게는 미표시) */}
      {!isPlatformAdmin && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <CardTitle className="text-[15px]">시험 응시 가이드</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex gap-3 items-start">
                <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[13px] font-bold shrink-0">1</div>
                <div>
                  <p className="text-[13px] font-semibold">시험 신청</p>
                  <p className="text-[11px] text-muted-foreground">아래 '응시 가능한 시험' 목록에서 원하는 시험을 선택하고 <strong>응시 신청</strong> 버튼을 클릭하세요.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[13px] font-bold shrink-0">2</div>
                <div>
                  <p className="text-[13px] font-semibold">대기실 환경 점검</p>
                  <p className="text-[11px] text-muted-foreground">웹캠, 마이크, 화면 공유를 확인하고 신분증을 업로드한 뒤 유의사항에 동의하세요.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[13px] font-bold shrink-0">3</div>
                <div>
                  <p className="text-[13px] font-semibold">시험 응시 &amp; 제출</p>
                  <p className="text-[11px] text-muted-foreground">제한 시간 내에 모든 문제에 답안을 작성하고 <strong>최종 제출</strong>하세요. 탭 전환은 감지됩니다.</p>
                </div>
              </div>
            </div>
            <div className="flex gap-4 pt-2 border-t border-primary/10">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span>시험 결과는 채점 완료 후 '내 응시 이력'에서 확인 가능</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 text-primary" />
                <span>문의사항은 관리자에게 연락하세요</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 슈퍼관리자 안내 */}
      {isPlatformAdmin && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Badge className="bg-amber-500 text-white text-[10px]">SUPER ADMIN</Badge>
            <span className="text-[12px] text-muted-foreground">
              무한 시험 테스트 모드 활성화 — 동일 시험 중복 신청 및 세션 초기화가 가능합니다.
            </span>
          </CardContent>
        </Card>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2>응시 가능한 시험</h2>
          <Button variant="outline" size="sm" className="text-[12px] gap-1" onClick={() => setCodeDialogOpen(true)}>
            <KeyRound className="h-3.5 w-3.5" /> 응시코드 입력
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {exams.filter(e => e.registration_mode !== 'invite_only').map((exam) => (
            <Card key={exam.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <GradeBadge grade={exam.grade} />
                  <div className="flex gap-1">
                    {exam.registration_mode === 'hybrid' && (
                      <Badge variant="outline" className="text-[10px]">혼합</Badge>
                    )}
                    <Badge variant="outline" className="text-[11px] bg-success/10 text-success border-success/20">접수중</Badge>
                  </div>
                </div>
                <CardTitle className="text-[14px] mt-2 leading-snug">{exam.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-[12px] text-muted-foreground">
                <div className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" />{new Date(exam.exam_date).toLocaleDateString('ko-KR')}</div>
                <div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5" />{exam.duration_minutes}분</div>
                <div className="flex items-center gap-2"><Users className="h-3.5 w-3.5" />{exam.max_participants}명</div>
                <Button size="sm" className="w-full mt-3 text-[12px]" onClick={() => { setSelectedExamId(exam.id); setInviteCode(''); setApplyOpen(true); }}>
                  응시 신청
                </Button>
              </CardContent>
            </Card>
          ))}
          {exams.filter(e => e.registration_mode !== 'invite_only').length === 0 && <p className="text-[12px] text-muted-foreground col-span-3">현재 응시 가능한 시험이 없습니다.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3">내 응시 이력</h2>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[12px]">시험명</TableHead>
                <TableHead className="text-[12px]">날짜</TableHead>
                <TableHead className="text-[12px]">등급</TableHead>
                <TableHead className="text-[12px]">상태</TableHead>
                <TableHead className="text-[12px]">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="text-[12px] font-medium">{s.exams?.title || '-'}</TableCell>
                  <TableCell className="text-[12px]">{s.exams?.exam_date ? new Date(s.exams.exam_date).toLocaleDateString('ko-KR') : '-'}</TableCell>
                  <TableCell>{s.exams?.grade && <GradeBadge grade={s.exams.grade} />}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(s.status)} className="text-[10px]">
                      {getStatusLabel(s.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {s.status === 'waiting' && (
                        <Button variant="outline" size="sm" className="text-[11px] h-7" onClick={() => navigate(`/applicant/waiting-room/${s.id}`)}>
                          대기실 입장
                        </Button>
                      )}
                      {s.status === 'in_progress' && (
                        <Button variant="outline" size="sm" className="text-[11px] h-7" onClick={() => navigate(`/applicant/exam/${s.id}`)}>
                          시험 계속
                        </Button>
                      )}
                      {isPlatformAdmin && s.status !== 'waiting' && (
                        <Button variant="ghost" size="sm" className="text-[11px] h-7 text-amber-600 hover:text-amber-700" onClick={() => handleResetSession(s.id)}>
                          <RotateCcw className="h-3 w-3 mr-1" /> 초기화
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {sessions.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-[12px] text-muted-foreground py-8">응시 이력이 없습니다</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Apply dialog */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>응시 신청</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-[13px]">
              <strong>{exams.find(e => e.id === selectedExamId)?.title}</strong> 시험에 응시 신청하시겠습니까?
            </p>
            {isPlatformAdmin && (
              <p className="text-[11px] text-amber-600 flex items-center gap-1">
                <Info className="h-3.5 w-3.5" /> 슈퍼관리자: 중복 신청이 허용됩니다
              </p>
            )}
            {(getExamRegMode(selectedExamId) === 'hybrid') && (
              <div className="space-y-1">
                <Label className="text-[12px]">응시코드 (선택사항)</Label>
                <Input
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  placeholder="초대코드가 있다면 입력하세요"
                  className="font-mono uppercase text-[13px]"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div><Label className="text-muted-foreground">이름</Label><p className="font-medium">{user?.name}</p></div>
              <div><Label className="text-muted-foreground">소속</Label><p className="font-medium">{activeOrg?.orgName || '-'}</p></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>취소</Button>
            <Button onClick={handleApply} disabled={isApplying}>{isApplying ? '신청 중...' : '신청하기'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite code lookup dialog */}
      <Dialog open={codeDialogOpen} onOpenChange={setCodeDialogOpen}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-[14px]">응시코드로 시험 찾기</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">관리자로부터 받은 응시코드를 입력하세요.</p>
            <Input
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value)}
              placeholder="예: A1B2C3D4"
              className="font-mono uppercase text-center text-lg tracking-widest"
              onKeyDown={e => e.key === 'Enter' && handleCodeLookup()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCodeDialogOpen(false)}>취소</Button>
            <Button onClick={handleCodeLookup} disabled={!inviteCode.trim()}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
