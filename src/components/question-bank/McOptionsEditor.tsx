import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Plus, Trash2 } from 'lucide-react';
import { McOption } from '@/types';

interface McOptionsEditorProps {
  options: McOption[];
  onChange: (options: McOption[]) => void;
}

export function McOptionsEditor({ options, onChange }: McOptionsEditorProps) {
  const addOption = () => {
    onChange([...options, { id: crypto.randomUUID(), text: '', is_correct: false }]);
  };

  const removeOption = (id: string) => {
    onChange(options.filter(o => o.id !== id));
  };

  const updateText = (id: string, text: string) => {
    onChange(options.map(o => o.id === id ? { ...o, text } : o));
  };

  const setCorrect = (id: string) => {
    onChange(options.map(o => ({ ...o, is_correct: o.id === id })));
  };

  const correctId = options.find(o => o.is_correct)?.id || '';

  return (
    <div className="space-y-2">
      <Label className="text-[12px]">보기 (정답 선택)</Label>
      <RadioGroup value={correctId} onValueChange={setCorrect}>
        {options.map((opt, i) => (
          <div key={opt.id} className="flex items-center gap-2">
            <RadioGroupItem value={opt.id} id={opt.id} />
            <span className="text-[12px] text-muted-foreground w-4">{i + 1}.</span>
            <Input
              value={opt.text}
              onChange={e => updateText(opt.id, e.target.value)}
              placeholder={`보기 ${i + 1}`}
              className="text-[12px] h-8 flex-1"
            />
            {options.length > 2 && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeOption(opt.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </RadioGroup>
      {options.length < 6 && (
        <Button variant="outline" size="sm" className="text-[12px] h-7 gap-1" onClick={addOption}>
          <Plus className="h-3 w-3" />보기 추가
        </Button>
      )}
    </div>
  );
}
