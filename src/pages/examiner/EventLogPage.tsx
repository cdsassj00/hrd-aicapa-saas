import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MonitoringEventType } from '@/types';
import { supabase } from '@/integrations/supabase/client';

const eventTypeLabels: Record<MonitoringEventType, string> = {
  face_missing: '얼굴 이탈',
  multiple_faces: '복수 인원',
  tab_switch: '탭 전환',
  screen_share_off: '화면공유 해제',
  voice_detected: '음성 감지',
};

export default function EventLogPage() {
  const [filter, setFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [events, setEvents] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('monitoring_events')
      .select('*, exam_sessions(applicant_id, exam_id, exams(title))')
      .order('detected_at', { ascending: false });
    if (data) {
      setEvents(data);
      // Fetch profiles for applicant names
      const userIds = [...new Set(data.map((e: any) => e.exam_sessions?.applicant_id).filter(Boolean))];
      if (userIds.length > 0) {
        const { data: profs } = await (supabase.from('profiles') as any).select('*').in('id', userIds);
        if (profs) setProfiles(new Map(profs.map((p: any) => [p.id, p])));
      }
    }
  };

  const handleToggleReview = async (eventId: string, currentValue: boolean) => {
    await supabase.from('monitoring_events').update({ is_reviewed: !currentValue }).eq('id', eventId);
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, is_reviewed: !currentValue } : e));
  };

  const filtered = events.filter(e => {
    if (filter !== 'all' && e.event_type !== filter) return false;
    if (reviewFilter === 'reviewed' && !e.is_reviewed) return false;
    if (reviewFilter === 'unreviewed' && e.is_reviewed) return false;
    return true;
  });

  const getApplicantName = (event: any) => {
    const applicantId = event.exam_sessions?.applicant_id;
    return profiles.get(applicantId)?.name || '알 수 없음';
  };

  return (
    <div className="space-y-4">
      <h1>이벤트 로그</h1>

      <div className="flex gap-3 items-center">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[160px] text-[12px]"><SelectValue placeholder="이벤트 유형" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">전체 유형</SelectItem>
            <SelectItem value="face_missing" className="text-[12px]">얼굴 없음</SelectItem>
            <SelectItem value="tab_switch" className="text-[12px]">탭 전환</SelectItem>
            <SelectItem value="screen_share_off" className="text-[12px]">화면공유 해제</SelectItem>
            <SelectItem value="multiple_faces" className="text-[12px]">복수 인원</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reviewFilter} onValueChange={setReviewFilter}>
          <SelectTrigger className="w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">전체</SelectItem>
            <SelectItem value="reviewed" className="text-[12px]">검토 완료</SelectItem>
            <SelectItem value="unreviewed" className="text-[12px]">미검토</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[12px] text-muted-foreground ml-auto">총 {filtered.length}건</span>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[12px] w-[50px]">검토</TableHead>
              <TableHead className="text-[12px]">응시자</TableHead>
              <TableHead className="text-[12px]">시험명</TableHead>
              <TableHead className="text-[12px]">유형</TableHead>
              <TableHead className="text-[12px]">문제#</TableHead>
              <TableHead className="text-[12px]">감지 시간</TableHead>
              <TableHead className="text-[12px]">리뷰 메모</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(ev => (
              <TableRow key={ev.id}>
                <TableCell>
                  <Checkbox checked={ev.is_reviewed} onCheckedChange={() => handleToggleReview(ev.id, ev.is_reviewed)} />
                </TableCell>
                <TableCell className="text-[12px] font-medium">{getApplicantName(ev)}</TableCell>
                <TableCell className="text-[12px] text-muted-foreground">{(ev.exam_sessions as any)?.exams?.title || '-'}</TableCell>
                <TableCell>
                  <Badge variant="destructive" className="text-[10px]">{eventTypeLabels[ev.event_type as MonitoringEventType]}</Badge>
                </TableCell>
                <TableCell className="text-[12px] font-mono">{(ev as any).question_index || '-'}</TableCell>
                <TableCell className="text-[12px]">{new Date(ev.detected_at).toLocaleString('ko-KR')}</TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {ev.reviewer_note || <Input placeholder="메모 입력..." className="h-7 text-[11px] w-[200px]" />}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-[12px] text-muted-foreground py-8">이벤트가 없습니다</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
