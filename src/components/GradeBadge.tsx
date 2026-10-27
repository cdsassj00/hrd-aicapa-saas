import { ExamGrade } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const gradeConfig: Record<ExamGrade, { label: string; className: string }> = {
  green: { label: '그린', className: 'bg-grade-green-bg text-grade-green border-grade-green/20' },
  blue: { label: '블루', className: 'bg-grade-blue-bg text-grade-blue border-grade-blue/20' },
  black: { label: '블랙', className: 'bg-grade-black-bg text-grade-black border-grade-black/20' },
  '전문인재': { label: '전문인재', className: 'bg-amber-50 text-amber-700 border-amber-300/40 dark:bg-amber-950 dark:text-amber-400' },
};

// 등급은 선택 항목이다(exams.grade·certifications.grade 모두 NULL 허용, 조직 등급 체계는 grade_scales).
// 비었거나 목록에 없는 값이면 빈 표시만 한다 — 예전엔 여기서 터져 회차 목록 전체가 백지가 됐다.
export function GradeBadge({ grade, className }: { grade: ExamGrade | string | null | undefined; className?: string }) {
  const config = grade ? gradeConfig[grade as ExamGrade] : undefined;
  if (!config) {
    return grade
      ? <Badge variant="outline" className={cn('font-medium whitespace-nowrap', className)}>{grade}</Badge>
      : <span className="text-muted-foreground">—</span>;
  }
  return (
    <Badge variant="outline" className={cn(config.className, 'font-medium whitespace-nowrap', className)}>
      {config.label}
    </Badge>
  );
}
