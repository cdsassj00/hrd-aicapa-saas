import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GradeBadge } from '@/components/GradeBadge';
import { Search, Download, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function CertificationsPage() {
  const [certs, setCerts] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Map<string, any>>(new Map());
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const { toast } = useToast();

  useEffect(() => { fetchCerts(); }, []);

  const fetchCerts = async () => {
    const { data } = await supabase.from('certifications').select('*').order('issued_at', { ascending: false });
    if (data) {
      setCerts(data);
      const userIds = [...new Set(data.map(c => c.applicant_id))];
      if (userIds.length > 0) {
        const { data: profs } = await (supabase.from('profiles') as any).select('*').in('id', userIds);
        if (profs) setProfiles(new Map(profs.map((p: any) => [p.id, p])));
      }
    }
  };

  const handleRevoke = async (certId: string) => {
    await supabase.from('certifications').update({ status: 'revoked' }).eq('id', certId);
    fetchCerts();
    toast({ title: '인증서가 취소되었습니다' });
  };

  const filtered = certs.filter(c => {
    const profile = profiles.get(c.applicant_id) || {};
    if (search && !profile.name?.includes(search) && !profile.organization?.includes(search) && !c.cert_number?.includes(search)) return false;
    if (gradeFilter !== 'all' && c.grade !== gradeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1>인증자 DB (AI챔피언 인재 명부)</h1>
        <Button variant="outline" size="sm" className="text-[12px] gap-1"><Download className="h-3.5 w-3.5" />엑셀 다운로드</Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름, 기관, 인증번호 검색..." className="pl-9 text-[12px]" />
        </div>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-[120px] text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 등급</SelectItem>
            <SelectItem value="green">그린</SelectItem>
            <SelectItem value="blue">블루</SelectItem>
            <SelectItem value="black">블랙</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[12px] text-muted-foreground self-center ml-auto">총 {filtered.length}명</span>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[12px]">이름</TableHead>
              <TableHead className="text-[12px]">소속기관</TableHead>
              <TableHead className="text-[12px]">등급</TableHead>
              <TableHead className="text-[12px]">인증일</TableHead>
              <TableHead className="text-[12px]">인증번호</TableHead>
              <TableHead className="text-[12px]">상태</TableHead>
              <TableHead className="text-[12px]">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(c => {
              const profile = profiles.get(c.applicant_id) || {};
              return (
                <TableRow key={c.id}>
                  <TableCell className="text-[12px] font-medium">{profile.name || '알 수 없음'}</TableCell>
                  <TableCell className="text-[12px]">{profile.organization || ''}</TableCell>
                  <TableCell><GradeBadge grade={c.grade} /></TableCell>
                  <TableCell className="text-[12px]">{new Date(c.issued_at).toLocaleDateString('ko-KR')}</TableCell>
                  <TableCell className="text-[12px] font-mono">{c.cert_number}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'valid' ? 'default' : 'destructive'} className="text-[10px]">
                      {c.status === 'valid' ? '유효' : '취소'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {c.status === 'valid' && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRevoke(c.id)}><XCircle className="h-3.5 w-3.5" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-[12px] text-muted-foreground py-8">인증자가 없습니다</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
