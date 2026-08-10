import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { mergeCustomTexts, ExamCustomTexts } from '@/lib/defaultCustomTexts';

export default function SubmittedPage() {
  const { sessionId } = useParams();
  const [title, setTitle] = useState('시험이 제출되었습니다');

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const { data } = await supabase
        .from('exam_sessions')
        .select('*, exams(*)')
        .eq('id', sessionId)
        .single();
      if (data) {
        const exam = (data as any).exams;
        const ct = mergeCustomTexts(exam?.custom_texts as ExamCustomTexts | null);
        setTitle(ct.submitted.title);
      }
    })();
  }, [sessionId]);

  return (
    <div className="max-w-[500px] mx-auto mt-20">
      <Card className="text-center">
        <CardContent className="p-10 space-y-6">
          <CheckCircle2 className="h-16 w-16 text-success mx-auto" />
          <h1 className="text-[18px] font-semibold">{title}</h1>
        </CardContent>
      </Card>
    </div>
  );
}
