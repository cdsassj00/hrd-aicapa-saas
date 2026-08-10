import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, RotateCcw } from 'lucide-react';
import { ExamCustomTexts, DEFAULT_CUSTOM_TEXTS, mergeCustomTexts } from '@/lib/defaultCustomTexts';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ExamCustomTexts;
  onChange: (value: ExamCustomTexts) => void;
}

export default function ExamCustomTextsEditor({ open, onOpenChange, value, onChange }: Props) {
  const [local, setLocal] = useState<ExamCustomTexts>(() => mergeCustomTexts(value));

  useEffect(() => {
    if (open) setLocal(mergeCustomTexts(value));
  }, [open, value]);

  const resetToDefaults = () => setLocal(mergeCustomTexts(null));

  const handleSave = () => {
    onChange(local);
    onOpenChange(false);
  };

  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
  };

  const updateWR = (key: string, val: string) =>
    setLocal(p => ({ ...p, waiting_room: { ...mergeCustomTexts(p).waiting_room, [key]: val } }));

  const updatePledge = (key: string, val: any) =>
    setLocal(p => ({ ...p, security_pledge: { ...mergeCustomTexts(p).security_pledge, [key]: val } }));

  const updateBanner = (key: string, val: any) =>
    setLocal(p => ({ ...p, policy_banner: { ...mergeCustomTexts(p).policy_banner, [key]: val } }));

  const pledgeItems = local.security_pledge?.items || DEFAULT_CUSTOM_TEXTS.security_pledge.items;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[750px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[14px] flex items-center justify-between">
            시험 문구 커스터마이징
            <Button variant="ghost" size="sm" className="text-[11px] gap-1 text-muted-foreground" onClick={resetToDefaults}>
              <RotateCcw className="h-3 w-3" /> 기본값 복원
            </Button>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="waiting" className="w-full">
          <TabsList className="w-full grid grid-cols-4 text-[11px]">
            <TabsTrigger value="waiting" className="text-[11px]">대기실</TabsTrigger>
            <TabsTrigger value="pledge" className="text-[11px]">보안 서약</TabsTrigger>
            <TabsTrigger value="banner" className="text-[11px]">정책 배너</TabsTrigger>
            <TabsTrigger value="submitted" className="text-[11px]">제출 완료</TabsTrigger>
          </TabsList>

          {/* 대기실 환경 점검 안내 */}
          <TabsContent value="waiting" className="space-y-3 mt-3">
            <p className="text-[11px] text-muted-foreground">각 환경 점검 단계에 표시되는 설명 문구를 수정할 수 있습니다.</p>
            {([
              ['monitor_desc', '1. 모니터 확인'],
              ['webcam_desc', '2. 웹캠 연결'],
              ['mic_desc', '3. 마이크 연결'],
              ['screen_desc', '4. 화면 공유'],
              ['email_desc', '5. 이메일 본인인증'],
              ['id_card_desc', '6. 신분증 제출'],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label className="text-[11px] font-medium">{label}</Label>
                <Input
                  value={(local.waiting_room as any)?.[key] || (DEFAULT_CUSTOM_TEXTS.waiting_room as any)[key]}
                  onChange={e => updateWR(key, e.target.value)}
                  className="text-[12px]"
                />
              </div>
            ))}
          </TabsContent>

          {/* 보안 서약 */}
          <TabsContent value="pledge" className="space-y-3 mt-3">
            <div className="space-y-1">
              <Label className="text-[11px] font-medium">안내 문구</Label>
              <Textarea
                value={local.security_pledge?.intro || DEFAULT_CUSTOM_TEXTS.security_pledge.intro}
                onChange={e => updatePledge('intro', e.target.value)}
                className="text-[12px] min-h-[60px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[11px] font-medium">부정행위 항목 ({pledgeItems.length}개)</Label>
              {pledgeItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[11px] text-muted-foreground mt-2 w-4 shrink-0">{i + 1}.</span>
                  <Input
                    value={item}
                    onChange={e => {
                      const newItems = [...pledgeItems];
                      newItems[i] = e.target.value;
                      updatePledge('items', newItems);
                    }}
                    className="text-[11px] flex-1"
                  />
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => {
                      const newItems = pledgeItems.filter((_, j) => j !== i);
                      updatePledge('items', newItems);
                    }}
                    disabled={pledgeItems.length <= 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="text-[11px] gap-1" onClick={() => updatePledge('items', [...pledgeItems, ''])}>
                <Plus className="h-3 w-3" /> 항목 추가
              </Button>
            </div>
          </TabsContent>

          {/* 정책 배너 */}
          <TabsContent value="banner" className="space-y-4 mt-3">
            <div className="space-y-3 p-3 rounded-md border border-destructive/20 bg-destructive/5">
              <p className="text-[11px] font-semibold text-destructive">🔒 제한 모드 (객관식/단답형/서술형)</p>
              <div className="space-y-1">
                <Label className="text-[11px]">배너 제목</Label>
                <Input
                  value={local.policy_banner?.restricted_title || DEFAULT_CUSTOM_TEXTS.policy_banner.restricted_title}
                  onChange={e => updateBanner('restricted_title', e.target.value)}
                  className="text-[12px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">안내 문구 (줄바꿈으로 구분)</Label>
                <Textarea
                  value={(local.policy_banner?.restricted_lines || DEFAULT_CUSTOM_TEXTS.policy_banner.restricted_lines).join('\n')}
                  onChange={e => updateBanner('restricted_lines', e.target.value.split('\n'))}
                  className="text-[11px] min-h-[60px]"
                />
              </div>
            </div>
            <div className="space-y-3 p-3 rounded-md border border-success/20 bg-success/5">
              <p className="text-[11px] font-semibold text-success">✅ 허용 모드 (작업형)</p>
              <div className="space-y-1">
                <Label className="text-[11px]">배너 제목</Label>
                <Input
                  value={local.policy_banner?.allowed_title || DEFAULT_CUSTOM_TEXTS.policy_banner.allowed_title}
                  onChange={e => updateBanner('allowed_title', e.target.value)}
                  className="text-[12px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">안내 문구 (줄바꿈으로 구분)</Label>
                <Textarea
                  value={(local.policy_banner?.allowed_lines || DEFAULT_CUSTOM_TEXTS.policy_banner.allowed_lines).join('\n')}
                  onChange={e => updateBanner('allowed_lines', e.target.value.split('\n'))}
                  className="text-[11px] min-h-[80px]"
                />
              </div>
            </div>
          </TabsContent>

          {/* 제출 완료 */}
          <TabsContent value="submitted" className="space-y-3 mt-3">
            <div className="space-y-1">
              <Label className="text-[11px] font-medium">제출 완료 제목</Label>
              <Input
                value={local.submitted?.title || DEFAULT_CUSTOM_TEXTS.submitted.title}
                onChange={e => setLocal(p => ({ ...p, submitted: { ...p.submitted, title: e.target.value } }))}
                className="text-[12px]"
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSave}>적용</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
