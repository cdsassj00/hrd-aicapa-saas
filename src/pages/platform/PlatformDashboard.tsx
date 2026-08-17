import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Building2, Inbox, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

const INQUIRY_STATUSES = ['신규', '상담중', '보류', '완료', '취소'];

type Org = { id: string; name: string; slug: string; status: string; created_at: string };
type Inquiry = {
  id: string; company: string; contact_name: string | null; email: string | null; phone: string | null;
  inquiry_type: string | null; headcount: string | null; timeframe: string | null; source: string | null;
  message: string | null; status: string; created_at: string;
};

export default function PlatformDashboard() {
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [orgRes, inqRes] = await Promise.all([
      supabase.from('organizations').select('id, name, slug, status, created_at').order('created_at', { ascending: false }),
      supabase.from('inquiries').select('*').order('created_at', { ascending: false }),
    ]);
    if (orgRes.error) toast({ title: '조직 로드 실패', description: orgRes.error.message, variant: 'destructive' });
    if (inqRes.error) toast({ title: '문의 로드 실패', description: inqRes.error.message, variant: 'destructive' });
    setOrgs((orgRes.data as Org[]) || []);
    setInquiries((inqRes.data as Inquiry[]) || []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (id: string, status: string) => {
    const prev = inquiries;
    setInquiries(list => list.map(i => (i.id === id ? { ...i, status } : i)));
    const { error } = await supabase.from('inquiries').update({ status }).eq('id', id);
    if (error) {
      setInquiries(prev);
      toast({ title: '상태 변경 실패', description: error.message, variant: 'destructive' });
    }
  };

  const newCount = inquiries.filter(i => i.status === '신규').length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">플랫폼 관리</h1>
            <p className="text-xs text-muted-foreground">한국데이터사이언티스트협회(CDSA) · 운영자 전용</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />새로고침
        </Button>
      </header>

      <div className="p-6 grid grid-cols-2 gap-4 max-w-md">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />조직</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{orgs.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Inbox className="h-3.5 w-3.5" />신규 문의</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{newCount}<span className="text-sm font-normal text-muted-foreground"> / {inquiries.length}</span></CardContent>
        </Card>
      </div>

      <div className="px-6 pb-10">
        <Tabs defaultValue="inquiries">
          <TabsList>
            <TabsTrigger value="inquiries">도입 문의 ({inquiries.length})</TabsTrigger>
            <TabsTrigger value="orgs">조직 ({orgs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="inquiries" className="mt-4">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>접수일</TableHead><TableHead>회사</TableHead><TableHead>담당자</TableHead>
                      <TableHead>연락처</TableHead><TableHead>유형</TableHead><TableHead>규모/시기</TableHead>
                      <TableHead>내용</TableHead><TableHead className="w-[130px]">상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inquiries.map(i => (
                      <TableRow key={i.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{format(new Date(i.created_at), 'MM-dd HH:mm')}</TableCell>
                        <TableCell className="font-medium">{i.company}</TableCell>
                        <TableCell>{i.contact_name || '-'}</TableCell>
                        <TableCell className="text-xs">{i.email || i.phone || '-'}</TableCell>
                        <TableCell>{i.inquiry_type ? <Badge variant="outline">{i.inquiry_type}</Badge> : '-'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{[i.headcount, i.timeframe].filter(Boolean).join(' / ') || '-'}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs" title={i.message || ''}>{i.message || '-'}</TableCell>
                        <TableCell>
                          <Select value={INQUIRY_STATUSES.includes(i.status) ? i.status : '신규'} onValueChange={v => updateStatus(i.id, v)}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {INQUIRY_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                    {inquiries.length === 0 && !loading && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">접수된 문의가 없습니다.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orgs" className="mt-4">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>생성일</TableHead><TableHead>조직명</TableHead><TableHead>주소(slug)</TableHead><TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgs.map(o => (
                      <TableRow key={o.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{format(new Date(o.created_at), 'yyyy-MM-dd')}</TableCell>
                        <TableCell className="font-medium">{o.name}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{o.slug}</TableCell>
                        <TableCell><Badge variant={o.status === 'active' ? 'default' : 'secondary'}>{o.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {orgs.length === 0 && !loading && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">조직이 없습니다.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
