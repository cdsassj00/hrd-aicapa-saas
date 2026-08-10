import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ShieldAlert } from 'lucide-react';
import { mergeCustomTexts, ExamCustomTexts } from '@/lib/defaultCustomTexts';

interface SecurityPledgeProps {
  agreed: boolean;
  onAgree: (agreed: boolean) => void;
  customTexts?: ExamCustomTexts | null;
}

export default function SecurityPledge({ agreed, onAgree, customTexts }: SecurityPledgeProps) {
  const texts = mergeCustomTexts(customTexts);
  const cheatingExamples = texts.security_pledge.items;
  const [checkedItems, setCheckedItems] = useState<boolean[]>(new Array(cheatingExamples.length).fill(false));

  const allChecked = checkedItems.every(Boolean);

  const handleItemCheck = (index: number) => {
    const next = [...checkedItems];
    next[index] = !next[index];
    setCheckedItems(next);
    if (next.every(Boolean)) {
      onAgree(true);
    } else {
      onAgree(false);
    }
  };

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          <h3 className="text-[13px] font-semibold">보안 서약</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {texts.security_pledge.intro}
        </p>
        <div className="space-y-2">
          {cheatingExamples.map((text, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-background/60 cursor-pointer select-none">
              <Checkbox
                id={`pledge-${i}`}
                checked={checkedItems[i]}
                onCheckedChange={() => handleItemCheck(i)}
                className="mt-0.5"
              />
              <label htmlFor={`pledge-${i}`} className="text-[11px] cursor-pointer leading-relaxed select-none">
                {i + 1}. {text}
              </label>
            </div>
          ))}
        </div>
        <div className="pt-2 border-t">
          <p className={`text-[11px] font-medium ${allChecked ? 'text-success' : 'text-muted-foreground'}`}>
            {allChecked
              ? '✅ 모든 보안 서약 항목에 동의하셨습니다.'
              : `${checkedItems.filter(Boolean).length}/${cheatingExamples.length}개 항목 확인됨`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
