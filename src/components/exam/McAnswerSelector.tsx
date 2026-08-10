import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';

interface McAnswerSelectorProps {
  options: { label: string; value: string }[];
  selected: string;
  onChange: (value: string) => void;
}

export default function McAnswerSelector({ options, selected, onChange }: McAnswerSelectorProps) {
  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all text-[13px]",
              isSelected
                ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                : "border-border bg-card hover:border-primary/40 hover:bg-primary/5"
            )}
          >
            <span className={cn(
              "flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0 text-[11px] font-bold",
              isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 text-muted-foreground"
            )}>
              {isSelected ? <CheckCircle2 className="h-4 w-4" /> : (i + 1)}
            </span>
            <span className={cn("flex-1", isSelected && "font-medium")}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
