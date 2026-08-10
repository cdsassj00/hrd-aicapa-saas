import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

// org_owner 는 초대로 부여하지 않는다 — DB 제약과 같은 규칙(§0004).
const INVITABLE_ROLES: { value: UserRole; label: string }[] = [
  { value: 'org_admin', label: '조직 관리자' },
  { value: 'examiner', label: '평가자' },
  { value: 'applicant', label: '응시자' },
  { value: 'viewer', label: '열람자' },
];

const ROLE_LABEL: Record<UserRole, string> = {
  org_owner: '소유자',
  org_admin: '조직 관리자',
  examiner: '평가자',
  applicant: '응시자',
  viewer: '열람자',
};

interface MemberRow {
  user_id: string;
  role: UserRole;
  status: string;
  department: string | null;
  position: string | null;
  profiles: { name: string | null } | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: UserRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function OrgMembersPage() {
  const { activeOrg, activeOrgId, role } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('applicant');
  const [issuing, setIssuing] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const isAdmin = role === 'org_admin' || role === 'org_owner';

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    const [m, i] = await Promise.all([
      supabase
        .from('org_members')
        .select('user_id, role, status, department, position, profiles(name)')
        .eq('org_id', activeOrgId),
      supabase
        .from('org_invitations')
        .select('id, email, role, expires_at, accepted_at, revoked_at, created_at')
        .eq('org_id', activeOrgId)
        .order('created_at', { ascending: false }),
    ]);
    if (m.error) toast.error(`멤버를 불러오지 못했습니다: ${m.error.message}`);
    if (i.error && isAdmin) toast.error(`초대 목록을 불러오지 못했습니다: ${i.error.message}`);
    setMembers((m.data ?? []) as unknown as MemberRow[]);
    setInvites((i.data ?? []) as unknown as InviteRow[]);
  }, [activeOrgId, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !email.trim()) return;

    setIssuing(true);
    try {
      const { data, error } = await supabase.rpc('create_org_invitation', {
        _org_id: activeOrgId,
        _email: email.trim().toLowerCase(),
        _role: inviteRole,
      });

      if (error) { toast.error(error.message); return; }

      // 원문 토큰은 이 응답에서만 얻을 수 있다. DB 에는 해시만 남는다.
      // 메일 발송(Resend)이 붙기 전까지는 링크를 직접 전달한다.
      setLastLink(`${window.location.origin}/invite/accept?token=${data}`);
      setEmail('');
      toast.success('초대를 발급했습니다.');
      void load();
    } finally {
      setIssuing(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const { error } = await supabase.rpc('revoke_org_invitation', { _invitation_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success('초대를 취소했습니다.');
    void load();
  };

  if (!activeOrgId) {
    return <p className="p-6 text-sm text-muted-foreground">조직을 먼저 선택하세요.</p>;
  }

  const pending = invites.filter(i => !i.accepted_at && !i.revoked_at);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{activeOrg?.orgName} 멤버</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          역할은 이 조직 안에서만 유효합니다. 다른 조직의 권한에는 영향을 주지 않습니다.
        </p>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">초대하기</CardTitle>
            <CardDescription>
              아직 가입하지 않은 사람도 초대할 수 있습니다. 초대는 14일 후 만료됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                <Label htmlFor="invite-email">이메일</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="teammate@company.co.kr"
                  required
                />
              </div>
              <div className="flex w-44 flex-col gap-1.5">
                <Label htmlFor="invite-role">역할</Label>
                <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
                  <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVITABLE_ROLES.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={issuing}>
                {issuing ? '발급 중...' : '초대 발급'}
              </Button>
            </form>

            {lastLink && (
              <div className="rounded-md border border-dashed p-3">
                <p className="text-sm font-medium">초대 링크 (이번 한 번만 표시됩니다)</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{lastLink}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(lastLink);
                      toast.success('복사했습니다.');
                    }}
                  >
                    복사
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLastLink(null)}>닫기</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  서버에는 이 토큰의 해시만 저장됩니다. 창을 닫으면 다시 볼 수 없고,
                  재발급하면 이전 링크는 무효가 됩니다.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">멤버 {members.length}명</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>부서</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(m => (
                <TableRow key={`${m.user_id}-${m.role}`}>
                  <TableCell>{m.profiles?.name ?? '—'}</TableCell>
                  <TableCell>{ROLE_LABEL[m.role] ?? m.role}</TableCell>
                  <TableCell>{m.department ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={m.status === 'active' ? 'default' : 'secondary'}>{m.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">
                    아직 멤버가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && pending.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">대기 중인 초대 {pending.length}건</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이메일</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>만료</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map(i => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell>{ROLE_LABEL[i.role] ?? i.role}</TableCell>
                    <TableCell>{new Date(i.expires_at).toLocaleDateString('ko-KR')}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleRevoke(i.id)}>취소</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
