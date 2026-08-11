import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { UserPlus, Copy, Trash2, Upload, Send, Loader2, RefreshCw, RotateCcw, Camera, Monitor } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { siteUrl, siteLink } from '@/lib/siteUrl';

interface Props {
  examId: string;
  examTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const sessionStatusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  waiting: { label: '대기중', variant: 'secondary' },
  in_progress: { label: '진행중', variant: 'default' },
  submitted: { label: '제출완료', variant: 'outline' },
  passed: { label: '합격', variant: 'default' },
  failed: { label: '불합격', variant: 'destructive' },
};

export function InvitationManager({ examId, examTitle, open, onOpenChange }: Props) {
  const [invitations, setInvitations] = useState<any[]>([]);
  const [registeredEmails, setRegisteredEmails] = useState<Map<string, string>>(new Map());
  const [sessionMap, setSessionMap] = useState<Map<string, { status: string; start_time: string | null }>>(new Map());
  const [bulkText, setBulkText] = useState('');
  const [addMode, setAddMode] = useState<'single' | 'bulk'>('single');
  const [singleName, setSingleName] = useState('');
  const [singleEmail, setSingleEmail] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && examId) {
      fetchInvitations();
      fetchRegisteredEmails();
      fetchSessions();
    }
    if (!open) setSelectedIds(new Set());
  }, [open, examId]);

  const fetchSessions = async () => {
    const { data } = await supabase
      .from('exam_sessions')
      .select('id, applicant_id, status, start_time')
      .eq('exam_id', examId);
    if (data) {
      const map = new Map<string, { status: string; start_time: string | null }>();
      data.forEach(s => map.set(s.applicant_id, { status: s.status, start_time: s.start_time }));
      setSessionMap(map);
    }
  };

  const fetchRegisteredEmails = async () => {
    const { data } = await supabase.rpc('get_user_emails');
    if (data) {
      const map = new Map<string, string>();
      data.forEach((row: { email: string; user_id: string }) => {
        if (row.email) map.set(row.email.toLowerCase(), row.user_id);
      });
      setRegisteredEmails(map);
    }
  };

  const fetchInvitations = async () => {
    const { data } = await supabase
      .from('exam_invitations')
      .select('*')
      .eq('exam_id', examId)
      .order('created_at');
    if (data) setInvitations(data);
  };

  const isRegistered = (email: string) => registeredEmails.has(email.toLowerCase().trim());

  const addSingle = async () => {
    const email = singleEmail.trim();
    if (!email) return;
    const { error } = await supabase.from('exam_invitations').insert({
      exam_id: examId,
      email,
      name: singleName.trim(),
    });
    if (error) {
      toast({ title: error.message.includes('duplicate') ? '이미 등록된 이메일입니다' : '추가 실패', variant: 'destructive' });
      return;
    }
    setSingleName(''); setSingleEmail('');
    toast({ title: '수강생 추가 완료' });
    fetchInvitations();
  };

  const addBulk = async () => {
    const lines = bulkText.trim().split('\n').filter(Boolean);
    const entries = lines.map(line => {
      const parts = line.split(/[,\t]/).map(s => s.trim());
      return { exam_id: examId, email: parts[1] || parts[0], name: parts.length > 1 ? parts[0] : '' };
    }).filter(e => e.email.includes('@'));

    if (entries.length === 0) { toast({ title: '유효한 이메일이 없습니다', variant: 'destructive' }); return; }

    const { error } = await supabase.from('exam_invitations').insert(entries);
    if (error) {
      toast({ title: '일괄 추가 실패', description: error.message, variant: 'destructive' });
      return;
    }

    setBulkText('');
    toast({ title: `${entries.length}명 추가 완료` });
    fetchInvitations();
  };

  const removeInvitation = async (id: string) => {
    await supabase.from('exam_invitations').delete().eq('id', id);
    fetchInvitations();
  };

  const reissueCode = async (inv: any) => {
    const newCode = crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
    const { error } = await supabase
      .from('exam_invitations')
      .update({ invite_code: newCode, is_used: false })
      .eq('id', inv.id);
    if (error) {
      toast({ title: '코드 재발급 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '새 응시코드가 발급되었습니다', description: newCode });
    fetchInvitations();
  };

  const retakeExam = async (inv: any) => {
    // Create a new invitation record for the same person with a fresh code
    const { data: newInv, error: invError } = await supabase
      .from('exam_invitations')
      .insert({ exam_id: examId, email: inv.email, name: inv.name || '' })
      .select()
      .single();
    if (invError) {
      toast({ title: '재응시 초대 생성 실패', description: invError.message, variant: 'destructive' });
      return;
    }
    toast({ title: '재응시 초대가 생성되었습니다', description: `새 응시코드: ${newInv.invite_code}` });
    fetchInvitations();
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: '응시코드가 복사되었습니다' });
  };

  const copyAll = () => {
    const text = invitations.map(i => `${i.name}\t${i.email}\t${i.invite_code}`).join('\n');
    navigator.clipboard.writeText(text);
    toast({ title: '전체 목록이 복사되었습니다' });
  };

  const copySignupLink = () => {
    navigator.clipboard.writeText(siteLink('/login'));
    toast({ title: '회원가입 링크가 복사되었습니다', description: '미가입 사용자에게 이 링크를 공유해주세요.' });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === invitations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invitations.map(i => i.id)));
    }
  };

  const sendEmails = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast({ title: '발송할 수강생을 선택해주세요', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-exam-invitation', {
        body: { examId, invitationIds: ids, siteUrl: siteUrl() },
      });

      if (error) {
        toast({ title: '이메일 발송 실패', description: error.message, variant: 'destructive' });
        return;
      }

      toast({
        title: `이메일 발송 완료`,
        description: `성공: ${data.sent}건, 실패: ${data.failed}건`,
      });
      setSelectedIds(new Set());
    } catch (e: any) {
      toast({ title: '이메일 발송 오류', description: e.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1050px]">
        <DialogHeader>
          <DialogTitle className="text-[14px]">수강생 관리 — {examTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 items-center justify-between">
            <div className="flex gap-2">
              <Button variant={addMode === 'single' ? 'default' : 'outline'} size="sm" className="text-[11px] h-7" onClick={() => setAddMode('single')}>
                <UserPlus className="h-3 w-3 mr-1" /> 개별 추가
              </Button>
              <Button variant={addMode === 'bulk' ? 'default' : 'outline'} size="sm" className="text-[11px] h-7" onClick={() => setAddMode('bulk')}>
                <Upload className="h-3 w-3 mr-1" /> 일괄 추가
              </Button>
            </div>
            <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1" onClick={copySignupLink}>
              <Copy className="h-3 w-3" /> 회원가입 링크 복사
            </Button>
          </div>

          {addMode === 'single' ? (
            <div className="flex gap-2 items-end">
              <div className="space-y-1 flex-1">
                <Label className="text-[11px]">이름</Label>
                <Input value={singleName} onChange={e => setSingleName(e.target.value)} placeholder="홍길동" className="h-8 text-[12px]" />
              </div>
              <div className="space-y-1 flex-1">
                <Label className="text-[11px]">이메일</Label>
                <Input value={singleEmail} onChange={e => setSingleEmail(e.target.value)} placeholder="user@example.com" className="h-8 text-[12px]" />
              </div>
              <Button size="sm" className="h-8 text-[11px]" onClick={addSingle}>추가</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-[11px]">이름, 이메일 (한 줄에 하나, 쉼표 또는 탭 구분)</Label>
              <Textarea

                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                placeholder={"홍길동, hong@example.com\n김영희, kim@example.com"}
                className="text-[12px] h-24"
              />
              <Button size="sm" className="text-[11px]" onClick={addBulk}>일괄 추가</Button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground">등록 수강생: {invitations.length}명</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="가입/접속 상태 새로고침" onClick={() => { fetchInvitations(); fetchRegisteredEmails(); fetchSessions(); toast({ title: '상태를 새로고침했습니다' }); }}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex gap-2">
              {selectedIds.size > 0 && (
                <Button
                  variant="default"
                  size="sm"
                  className="text-[11px] h-7 gap-1"
                  onClick={sendEmails}
                  disabled={sending}
                >
                  {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {sending ? '발송중...' : `${selectedIds.size}명에게 초대 메일 발송`}
                </Button>
              )}
              {invitations.length > 0 && (
                <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1" onClick={copyAll}>
                  <Copy className="h-3 w-3" /> 전체 복사
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[300px] overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] w-[40px]">
                    <Checkbox
                      checked={invitations.length > 0 && selectedIds.size === invitations.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap">이름</TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap">이메일</TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap">가입</TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap">응시코드</TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap">상태</TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap">접속 현황</TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap text-center" title="웹캠 면제">
                    <Camera className="h-3 w-3 mx-auto" />
                  </TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap text-center" title="듀얼모니터 허용">
                    <Monitor className="h-3 w-3 mx-auto" />
                  </TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap text-center" title="화면공유 면제">
                    <span className="text-[10px]">화면</span>
                  </TableHead>
                  <TableHead className="text-[11px] whitespace-nowrap w-[80px]">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(inv.id)}
                        onCheckedChange={() => toggleSelect(inv.id)}
                      />
                    </TableCell>
                    <TableCell className="text-[12px] whitespace-nowrap">{inv.name || '-'}</TableCell>
                    <TableCell className="text-[12px] whitespace-nowrap">{inv.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={isRegistered(inv.email) ? 'default' : 'destructive'}
                        className="text-[9px]"
                      >
                        {isRegistered(inv.email) ? '가입완료' : '미가입'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">{inv.invite_code}</code>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyCode(inv.invite_code)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={inv.is_used ? 'default' : 'secondary'} className="text-[9px]">
                        {inv.is_used ? '사용됨' : '미사용'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const userId = registeredEmails.get(inv.email?.toLowerCase().trim());
                        const session = userId ? sessionMap.get(userId) : null;
                        if (!session) return <span className="text-[10px] text-muted-foreground">미접속</span>;
                        const info = sessionStatusLabels[session.status] || { label: session.status, variant: 'secondary' as const };
                        return <Badge variant={info.variant} className="text-[9px]">{info.label}</Badge>;
                      })()}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={inv.allow_no_webcam ?? false}
                        onCheckedChange={async (val) => {
                          await supabase.from('exam_invitations').update({ allow_no_webcam: val } as any).eq('id', inv.id);
                          fetchInvitations();
                        }}
                        className="scale-75"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={inv.allow_dual_monitor ?? false}
                        onCheckedChange={async (val) => {
                          await supabase.from('exam_invitations').update({ allow_dual_monitor: val } as any).eq('id', inv.id);
                          fetchInvitations();
                        }}
                        className="scale-75"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={(inv as any).allow_no_screen_share ?? false}
                        onCheckedChange={async (val) => {
                          await supabase.from('exam_invitations').update({ allow_no_screen_share: val } as any).eq('id', inv.id);
                          fetchInvitations();
                        }}
                        className="scale-75"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        {inv.is_used && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-primary" title="재응시 발급" onClick={() => retakeExam(inv)}>
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="코드 재발급" onClick={() => reissueCode(inv)}>
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeInvitation(inv.id)} disabled={inv.is_used}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {invitations.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-[12px] text-muted-foreground py-6">등록된 수강생이 없습니다</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
