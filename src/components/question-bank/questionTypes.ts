import { QuestionType, QuestionDifficulty } from '@/types';

export const questionTypeLabels: Record<QuestionType, string> = {
  multiple_choice: '객관식',
  short_answer: '단답형',
  essay: '서술형',
  file_upload: '실기형',
  work_based: '작업형',
};

export const questionTypeColors: Record<QuestionType, string> = {
  multiple_choice: 'bg-purple-100 text-purple-700 border-purple-200',
  short_answer: 'bg-sky-100 text-sky-700 border-sky-200',
  essay: 'bg-amber-100 text-amber-700 border-amber-200',
  file_upload: 'bg-rose-100 text-rose-700 border-rose-200',
  work_based: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export const categoryColors: Record<string, string> = {
  '생성형AI활용': 'bg-grade-green-bg text-grade-green border-grade-green/20',
  '데이터분석': 'bg-grade-blue-bg text-grade-blue border-grade-blue/20',
  '서비스구현': 'bg-grade-black-bg text-grade-black border-grade-black/20',
};

export const difficultyLabels: Record<QuestionDifficulty, string> = {
  easy: '하',
  medium: '중',
  hard: '상',
};

export const difficultyColors: Record<QuestionDifficulty, string> = {
  easy: 'bg-success/10 text-success border-success/20',
  medium: 'bg-warning/10 text-warning border-warning/20',
  hard: 'bg-destructive/10 text-destructive border-destructive/20',
};
