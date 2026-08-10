import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Layers } from 'lucide-react';
import type { QuestionSet } from '@/lib/examStructure';
import { downloadAttachment, downloadAttachmentsAsZip } from '@/lib/attachmentDownload';
import MarkdownView from '@/components/exam/MarkdownView';

interface Props {
  set: QuestionSet;
  /** 같은 세트 내 N번째 문항 / 총 M개 */
  questionPosition?: { current: number; total: number };
}

/**
 * 응시 화면 상단에 표시되는 세트(시나리오) 카드.
 */
export default function SetScenarioCard({ set, questionPosition }: Props) {
  const hasAttachments = set.attachments && set.attachments.length > 0;
  const handleDownloadAll = async () => {
    await downloadAttachmentsAsZip(set.attachments, `${set.title || '세트_공통_첨부'}.zip`);
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="h-4 w-4 text-primary shrink-0" />
            <span className="text-[13px] font-bold text-primary truncate">{set.title}</span>
            <Badge variant="outline" className="text-[10px] shrink-0">세트</Badge>
          </div>
          {questionPosition && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              과목 {questionPosition.current} / {questionPosition.total}
            </span>
          )}
        </div>

        {set.scenario && (
          <div className="bg-card border rounded-lg px-5 py-4">
            <MarkdownView content={set.scenario} variant="scenario" className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
          </div>
        )}

        {hasAttachments && (
          <div className="space-y-1.5 p-2.5 rounded-md bg-card border">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> 세트 공통 첨부
              </p>
              {set.attachments.length > 1 && (
                <button type="button" onClick={handleDownloadAll} className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                  <Download className="h-3 w-3" />ZIP 전체 다운로드
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {set.attachments.map((att, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => downloadAttachment(att, idx)}
                  className="flex items-center gap-1 text-[12px] text-primary hover:underline"
                >
                  <Download className="h-3 w-3" />
                  {att.name || `첨부 ${idx + 1}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
