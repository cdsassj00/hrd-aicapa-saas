import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GradeBadge } from '@/components/GradeBadge';
import { Download, Award, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function ResultsPage() {
  const { sessionId } = useParams();
  const [session, setSession] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);
  const { role } = useAuth();
  const isApplicantRole = role === 'applicant';

  useEffect(() => {
    if (sessionId) fetchData();
  }, [sessionId]);

  const fetchData = async () => {
    const { data: sess } = await supabase
      .from('exam_sessions')
      .select('*, exams(*)')
      .eq('id', sessionId!)
      .single();

    if (sess) {
      setSession(sess);
      setExam((sess as any).exams);
    }
  };

  if (!session || !exam) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">로딩 중...</p></div>;
  }

  const passed = session.status === 'passed';
  const failed = session.status === 'failed';
  const isGraded = passed || failed;

  if (!isGraded) {
    return (
      <div className="max-w-[700px] mx-auto space-y-6">
        <h1>결과 확인</h1>
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <Award className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-[14px] font-medium">아직 채점이 완료되지 않았습니다</p>
            <p className="text-[12px] text-muted-foreground">채점이 완료되면 결과를 확인할 수 있습니다.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 응시자 역할: 합격/불합격/점수를 일절 노출하지 않음
  if (isApplicantRole) {
    return (
      <div className="max-w-[700px] mx-auto space-y-6">
        <h1>결과 확인</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">{exam.title}</CardTitle>
            <div className="flex items-center gap-2 mt-2">
              <GradeBadge grade={exam.grade} />
              <Badge variant="secondary" className="text-[11px]">채점 완료</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-start gap-3 p-4 rounded-md bg-muted/40">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-[13px] font-medium">응시가 완료되었습니다.</p>
                <p className="text-[12px] text-muted-foreground">
                  결과(합격/불합격) 및 점수는 응시자 화면에 노출되지 않습니다. 자세한 사항은 관리자에게 문의하세요.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 관리자/감독관 등 다른 역할: 합격 여부 표시
  return (
    <div className="max-w-[700px] mx-auto space-y-6">
      <h1>결과 확인</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-[14px]">{exam.title}</CardTitle>
              <div className="flex items-center gap-2 mt-2">
                <GradeBadge grade={exam.grade} />
                <Badge variant={passed ? 'default' : 'destructive'} className="text-[11px]">
                  {passed ? '합격' : '불합격'}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[13px] font-medium text-muted-foreground">세부 점수는 관리자 기준으로만 확인됩니다.</p>
            </div>
          </div>
        </CardHeader>
      </Card>

      {passed && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Award className="h-8 w-8 text-success" />
              <div>
                <p className="text-[14px] font-bold">합격을 축하합니다!</p>
                <p className="text-[12px] text-muted-foreground">세부 점수는 관리자 기준으로만 확인됩니다.</p>
              </div>
            </div>
            <Button className="gap-2">
              <Download className="h-4 w-4" /> 인증서 다운로드
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
