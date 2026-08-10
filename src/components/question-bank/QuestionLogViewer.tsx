import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';

const actionLabels: Record<string, string> = {
  created: '생성',
  updated: '수정',
  deleted: '삭제',
};
const actionColors: Record<string, string> = {
  created: 'bg-green-100 text-green-700',
  updated: 'bg-blue-100 text-blue-700',
  deleted: 'bg-red-100 text-red-700',
};

const fieldLabels: Record<string, string> = {
  content: '문제 내용',
  category: '카테고리',
  grade: '등급',
  difficulty: '난이도',
  type: '유형',
  max_score: '배점',
  tags: '태그',
  options: '보기',
  correct_answer: '정답',
  allow_file_upload: '파일 제출',
  attachments: '첨부 파일',
};

interface QuestionLogViewerProps {
  questionId: string;
}

export function QuestionLogViewer({ questionId }: QuestionLogViewerProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!questionId) return;
    const fetchLogs = async () => {
      const { data } = await supabase
        .from('question_logs' as any)
        .select('*')
        .eq('question_id', questionId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (data) {
        setLogs(data as any[]);
        // fetch actor names
        const actorIds = [...new Set((data as any[]).map((l: any) => l.actor_id))];
        if (actorIds.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, name')
            .in('id', actorIds);
          if (profs) {
            const map: Record<string, string> = {};
            profs.forEach(p => { map[p.id] = p.name; });
            setProfiles(map);
          }
        }
      }
    };
    fetchLogs();
  }, [questionId]);

  if (logs.length === 0) {
    return <p className="text-[12px] text-muted-foreground py-4 text-center">변경 이력이 없습니다</p>;
  }

  return (
    <ScrollArea className="max-h-[300px]">
      <div className="space-y-3">
        {logs.map((log: any) => (
          <div key={log.id} className="border rounded-md p-3 text-[12px]">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`text-[10px] ${actionColors[log.action] || ''}`}>
                {actionLabels[log.action] || log.action}
              </Badge>
              <span className="text-muted-foreground">
                {profiles[log.actor_id] || '알 수 없음'}
              </span>
              <span className="text-muted-foreground ml-auto">
                {format(new Date(log.created_at), 'yyyy-MM-dd HH:mm', { locale: ko })}
              </span>
            </div>
            {log.changes && Object.keys(log.changes).length > 0 && (
              <div className="mt-2 space-y-1">
                {Object.entries(log.changes).map(([field, val]: [string, any]) => (
                  <div key={field} className="text-[11px]">
                    <span className="font-medium">{fieldLabels[field] || field}:</span>{' '}
                    <span className="text-muted-foreground line-through">
                      {typeof val.before === 'object' ? JSON.stringify(val.before) : String(val.before ?? '-')}
                    </span>
                    {' → '}
                    <span>{typeof val.after === 'object' ? JSON.stringify(val.after) : String(val.after ?? '-')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
