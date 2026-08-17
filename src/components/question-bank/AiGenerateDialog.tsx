import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

const TYPE_OPTIONS = [
  { value: 'multiple_choice', label: '객관식' },
  { value: 'short_answer', label: '단답형' },
  { value: 'essay', label: '서술형' },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 생성·적재 성공 시 호출(목록 새로고침) */
  onGenerated: () => void;
}

export function AiGenerateDialog({ open, onOpenChange, onGenerated }: Props) {
  const { activeOrgId } = useAuth();
  const { toast } = useToast();
  const [topic, setTopic] = useState('');
  const [category, setCategory] = useState('');
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState('medium');
  const [types, setTypes] = useState<string[]>(['multiple_choice']);
  const [loading, setLoading] = useState(false);

  const toggleType = (t: string) =>
    setTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));

  const handleGenerate = async () => {
    if (!activeOrgId) {
      toast({ title: '조직 미선택', description: '상단에서 조직을 선택하세요.', variant: 'destructive' });
      return;
    }
    if (!topic.trim()) {
      toast({ title: '주제를 입력하세요', variant: 'destructive' });
      return;
    }
    if (types.length === 0) {
      toast({ title: '문항 유형을 하나 이상 선택하세요', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-questions', {
        body: {
          org_id: activeOrgId,
          topic: topic.trim(),
          category: category.trim() || null,
          count,
          difficulty,
          types,
        },
      });
      if (error || data?.error) {
        toast({ title: '생성 실패', description: data?.error || error?.message, variant: 'destructive' });
        return;
      }
      toast({ title: `문항 ${data.created}개 생성 완료`, description: '문제은행에 초안으로 추가되었습니다. 검수 후 사용하세요.' });
      onGenerated();
      onOpenChange(false);
      setTopic(''); setCategory('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI 문항 생성
          </DialogTitle>
          <DialogDescription>
            주제를 입력하면 이론형 문항 초안을 생성해 문제은행에 추가합니다. <b>생성 후 반드시 검수</b>하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-topic">주제 / 지시문</Label>
            <Textarea
              id="ai-topic"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="예: 생성형 AI를 활용한 업무 자동화(엑셀 수식·문서 요약) 실무 활용력"
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-cat">역량 영역(선택)</Label>
              <Input id="ai-cat" value={category} onChange={e => setCategory(e.target.value)} placeholder="데이터 분석" maxLength={40} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-count">문항 수</Label>
              <Input id="ai-count" type="number" min={1} max={20} value={count}
                onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>난이도</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">쉬움</SelectItem>
                <SelectItem value="medium">보통</SelectItem>
                <SelectItem value="hard">어려움</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>문항 유형</Label>
            <div className="flex gap-4">
              {TYPE_OPTIONS.map(t => (
                <label key={t.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={types.includes(t.value)} onCheckedChange={() => toggleType(t.value)} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={loading} className="mt-2">
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />생성 중...</> : <><Sparkles className="h-4 w-4 mr-2" />생성하기</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
