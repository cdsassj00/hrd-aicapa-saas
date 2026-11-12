import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DailyRoomInfo {
  room_name: string;
  room_url: string;
}

export function useDailyRoom() {
  const { toast } = useToast();
  const [roomInfo, setRoomInfo] = useState<DailyRoomInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const createRoom = useCallback(async (examId: string, examTitle?: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('daily-room', {
        body: { action: 'create', exam_id: examId, exam_title: examTitle },
      });
      if (error) throw error;
      setRoomInfo(data);
      return data as DailyRoomInfo;
    } catch (err: any) {
      toast({ title: 'Daily 룸 생성 실패', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const getRoom = useCallback(async (examId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('daily-room', {
        body: { action: 'get', exam_id: examId },
      });
      if (error) throw error;
      if (data?.daily_room_name) {
        setRoomInfo({ room_name: data.daily_room_name, room_url: data.daily_room_url });
      }
      return data;
    } catch (err: any) {
      toast({ title: '룸 정보 조회 실패', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const getToken = useCallback(async (roomName: string, userName: string, isOwner = false) => {
    try {
      const { data, error } = await supabase.functions.invoke('daily-room', {
        body: { action: 'create-token', room_name: roomName, user_name: userName, is_owner: isOwner },
      });
      if (error) {
        // functions.invoke 는 4xx/5xx 를 'non-2xx' 로만 알려 준다. 서버가 준 이유를 꺼낸다.
        let reason = '';
        try { reason = (await (error as any).context?.json?.())?.error ?? ''; } catch { /* 본문 없음 */ }
        throw new Error(reason === 'forbidden'
          ? '이 시험의 감독 권한이 없습니다. 상단에서 시험이 속한 조직을 선택했는지 확인하세요.'
          : reason || error.message);
      }
      return data?.token as string;
    } catch (err: any) {
      toast({ title: '감독 화면 연결 실패', description: err.message, variant: 'destructive' });
      return null;
    }
  }, [toast]);

  const deleteRoom = useCallback(async (examId: string) => {
    try {
      await supabase.functions.invoke('daily-room', {
        body: { action: 'delete', exam_id: examId },
      });
      setRoomInfo(null);
    } catch (err: any) {
      toast({ title: '룸 삭제 실패', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  return { roomInfo, loading, createRoom, getRoom, getToken, deleteRoom };
}
