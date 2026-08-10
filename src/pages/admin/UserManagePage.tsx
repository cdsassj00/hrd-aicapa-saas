import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Search, Users, Trash2 } from 'lucide-react';
import { UserRole } from '@/types';

interface UserWithRole {
  id: string;
  name: string;
  email: string;
  organization: string;
  department: string;
  position: string;
  phone: string;
  role: UserRole;
  created_at: string;
}

const roleLabels: Record<UserRole, string> = {
  applicant: '응시자',
  examiner: '감독관',
  admin: '관리자',
  viewer: '조회자',
};

const roleBadgeVariants: Record<UserRole, string> = {
  admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  examiner: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  applicant: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

export default function UserManagePage() {
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<UserWithRole | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    const [profilesRes, rolesRes, emailsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_roles').select('*'),
      supabase.rpc('get_user_emails' as any),
    ]);

    if (profilesRes.error || rolesRes.error) {
      toast({ title: '사용자 목록 로딩 실패', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const roleMap = new Map<string, UserRole>();
    (rolesRes.data || []).forEach((r: any) => roleMap.set(r.user_id, r.role as UserRole));

    const emailMap = new Map<string, string>();
    ((emailsRes.data as any[]) || []).forEach((e: any) => emailMap.set(e.user_id, e.email));

    const merged: UserWithRole[] = (profilesRes.data || []).map((p: any) => ({
      id: p.id,
      name: p.name || '',
      email: emailMap.get(p.id) || '',
      organization: p.organization || '',
      department: p.department || '',
      position: p.position || '',
      phone: p.phone || '',
      role: roleMap.get(p.id) || 'applicant',
      created_at: p.created_at || '',
    }));

    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const { error } = await supabase.rpc('set_user_role', { _user_id: userId, _role: newRole } as any);
    if (error) {
      toast({ title: '역할 변경 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '역할 변경 완료', description: `${roleLabels[newRole]}(으)로 변경되었습니다.` });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { user_id: deleteTarget.id },
      });
      if (error || data?.error) {
        toast({ title: '삭제 실패', description: data?.error || error?.message, variant: 'destructive' });
      } else {
        toast({ title: '사용자 삭제 완료', description: `${deleteTarget.name || deleteTarget.email} 계정이 삭제되었습니다.` });
        setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      }
    } catch {
      toast({ title: '삭제 중 오류 발생', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const filtered = users.filter(u => {
    const matchSearch = !search || u.name.includes(search) || u.email.includes(search) || u.organization.includes(search) || u.phone.includes(search);
    const matchRole = filterRole === 'all' || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const roleCounts = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Users className="h-5 w-5" /> 사용자 관리
        </h2>
        <div className="flex gap-2 text-[12px]">
          {(['applicant', 'examiner', 'admin', 'viewer'] as UserRole[]).map(r => (
            <Badge key={r} variant="outline" className={roleBadgeVariants[r]}>
              {roleLabels[r]} {roleCounts[r] || 0}
            </Badge>
          ))}
          <Badge variant="outline">전체 {users.length}</Badge>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 text-[13px]"
              placeholder="이름, 소속, 연락처 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-[130px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 역할</SelectItem>
              <SelectItem value="applicant">응시자</SelectItem>
              <SelectItem value="examiner">감독관</SelectItem>
              <SelectItem value="admin">관리자</SelectItem>
              <SelectItem value="viewer">조회자</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[12px]">이름</TableHead>
                <TableHead className="text-[12px]">이메일</TableHead>
                <TableHead className="text-[12px]">소속기관</TableHead>
                <TableHead className="text-[12px]">부서</TableHead>
                <TableHead className="text-[12px]">직위</TableHead>
                <TableHead className="text-[12px]">연락처</TableHead>
                <TableHead className="text-[12px]">현재 역할</TableHead>
                <TableHead className="text-[12px]">역할 변경</TableHead>
                <TableHead className="text-[12px] w-[60px]">삭제</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                   <TableCell colSpan={8} className="text-center text-muted-foreground text-[13px] py-8">
                    로딩 중...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground text-[13px] py-8">
                    사용자가 없습니다.
                  </TableCell>
                </TableRow>
              ) : filtered.map(user => (
                <TableRow key={user.id}>
                  <TableCell className="text-[13px] font-medium">{user.name}</TableCell>
                  <TableCell className="text-[13px]">{user.email}</TableCell>
                  <TableCell className="text-[13px]">{user.organization}</TableCell>
                  <TableCell className="text-[13px]">{user.department}</TableCell>
                  <TableCell className="text-[13px]">{user.position}</TableCell>
                  <TableCell className="text-[13px]">{user.phone}</TableCell>
                  <TableCell>
                    <Badge className={`text-[11px] ${roleBadgeVariants[user.role]}`}>
                      {roleLabels[user.role]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Select value={user.role} onValueChange={v => handleRoleChange(user.id, v as UserRole)}>
                      <SelectTrigger className="h-8 w-[110px] text-[12px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="applicant">응시자</SelectItem>
                        <SelectItem value="examiner">감독관</SelectItem>
                        <SelectItem value="admin">관리자</SelectItem>
                        <SelectItem value="viewer">조회자</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(user)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>사용자 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name || deleteTarget?.email}</strong> 계정을 완전히 삭제합니다.
              <br />인증 계정, 프로필, 역할 데이터가 모두 제거되며 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? '삭제 중...' : '삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
