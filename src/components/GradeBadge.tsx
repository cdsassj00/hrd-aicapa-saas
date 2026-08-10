import { ExamGrade } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const gradeConfig: Record<ExamGrade, { label: string; className: string }> = {
  green: { label: '그린', className: 'bg-grade-green-bg text-grade-green border-grade-green/20' },
  blue: { label: '블루', className: 'bg-grade-blue-bg text-grade-blue border-grade-blue/20' },
  black: { label: '블랙', className: 'bg-grade-black-bg text-grade-black border-grade-black/20' },
  '전문인재': { label: '전문인재', className: 'bg-amber-50 text-amber-700 border-amber-300/40 dark:bg-amber-950 dark:text-amber-400' },
};

export function GradeBadge({ grade, className }: { grade: ExamGrade; className?: string }) {
  const config = gradeConfig[grade];
  return (
    <Badge variant="outline" className={cn(config.className, 'font-medium whitespace-nowrap', className)}>
      {config.label}
    </Badge>
  );
}
