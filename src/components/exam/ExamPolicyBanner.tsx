import { Badge } from '@/components/ui/badge';
import { Shield, ExternalLink, Lock } from 'lucide-react';
import { mergeCustomTexts, ExamCustomTexts } from '@/lib/defaultCustomTexts';

const ALLOWED_TOOLS = [
  { name: 'ChatGPT', url: 'https://chat.openai.com' },
  { name: 'Claude', url: 'https://claude.ai' },
  { name: 'Google Gemini', url: 'https://gemini.google.com' },
  { name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com' },
  { name: 'Google 검색', url: 'https://google.com' },
];

const questionTypeLabels: Record<string, string> = {
  multiple_choice: '객관식',
  short_answer: '단답형',
  essay: '서술형',
  work_based: '작업형',
  file_upload: '실기형',
};

interface ExamPolicyBannerProps {
  questionType: string;
  customTexts?: ExamCustomTexts | null;
}

export default function ExamPolicyBanner({ questionType, customTexts }: ExamPolicyBannerProps) {
  const ct = mergeCustomTexts(customTexts);
  const isRestricted = questionType === 'multiple_choice' || questionType === 'short_answer' || questionType === 'essay';
  const isWorkBased = questionType === 'work_based';

  if (isRestricted) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
        <Lock className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-[12px] font-semibold text-destructive">{ct.policy_banner.restricted_title}</p>
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {ct.policy_banner.restricted_lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isWorkBased) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2.5">
        <Shield className="h-4 w-4 text-success shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-[12px] font-semibold text-success">{ct.policy_banner.allowed_title}</p>
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {ct.policy_banner.allowed_lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {ALLOWED_TOOLS.map(tool => (
              <Badge key={tool.name} variant="outline" className="text-[9px] px-1.5 py-0 gap-1 cursor-default">
                <ExternalLink className="h-2.5 w-2.5" />
                {tool.name}
              </Badge>
            ))}
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 cursor-default">
              외 프로그램
            </Badge>
          </div>
        </div>
      </div>
    );
  }

  // file_upload type - moderate policy
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
      <Shield className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-[12px] font-semibold text-warning">참고자료 활용 가능</p>
        <p className="text-[11px] text-muted-foreground">
          파일 제출형 문항입니다. 필요한 도구를 활용할 수 있으나, 모든 활동이 기록됩니다.
        </p>
      </div>
    </div>
  );
}

export { questionTypeLabels };
