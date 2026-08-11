import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useSiteSettings, useUpdateSiteSettings } from '@/hooks/useSiteSettings';
import { useToast } from '@/hooks/use-toast';
import { Settings, Save } from 'lucide-react';

export default function SettingsPage() {
  const { settings, isLoading } = useSiteSettings();
  const updateMutation = useUpdateSiteSettings();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [footerOrg, setFooterOrg] = useState('');
  const [emailSubjectPrefix, setEmailSubjectPrefix] = useState('');
  const [emailFromName, setEmailFromName] = useState('');
  const [emailFromAddress, setEmailFromAddress] = useState('');

  useEffect(() => {
    if (!isLoading) {
      setTitle(settings.title);
      setSubtitle(settings.subtitle);
      setFooterOrg(settings.footerOrg);
      setEmailSubjectPrefix(settings.emailSubjectPrefix);
      setEmailFromName(settings.emailFromName);
      setEmailFromAddress(settings.emailFromAddress);
    }
  }, [isLoading, settings]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ title, subtitle, footerOrg, emailSubjectPrefix, emailFromName, emailFromAddress });
      toast({ title: '설정이 저장되었습니다.' });
    } catch {
      toast({ title: '저장 실패', description: '설정 저장 중 오류가 발생했습니다.', variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">로딩 중...</div>;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-bold">시스템 설정</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">브랜딩</CardTitle>
          <CardDescription className="text-[12px]">
            로그인 페이지와 상단 헤더에 표시되는 시스템 이름을 설정합니다. 테넌트별로 변경 가능합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-[12px]">시스템 제목</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 2026 상반기 AI 역량평가" />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px]">부제</Label>
            <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="AI 역량 인증평가 플랫폼" />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px]">푸터 조직명</Label>
            <Input value={footerOrg} onChange={e => setFooterOrg(e.target.value)} placeholder="예: 주식회사 마루" />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px]">이메일 제목 접두어</Label>
            <Input value={emailSubjectPrefix} onChange={e => setEmailSubjectPrefix(e.target.value)} placeholder="예: [마루 인재개발원]" />
            <p className="text-[11px] text-muted-foreground">초대 메일 제목 앞에 붙는 접두어입니다. 예: [마루 인재개발원] 평가명 응시 초대</p>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px]">발신자 이름</Label>
            <Input value={emailFromName} onChange={e => setEmailFromName(e.target.value)} placeholder="AI역량인증 평가" />
            <p className="text-[11px] text-muted-foreground">초대 메일의 발신자 이름입니다. 예: AI역량인증 평가</p>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px]">발신 이메일 주소</Label>
            <Input value={emailFromAddress} onChange={e => setEmailFromAddress(e.target.value)} placeholder="예: noreply@example.com" />
            <p className="text-[11px] text-muted-foreground">초대 메일의 발신 이메일 주소입니다. Resend에서 인증된 도메인이어야 합니다.</p>
          </div>
          <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {updateMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
