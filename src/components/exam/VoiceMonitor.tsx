import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface VoiceMonitorProps {
  sessionId: string;
  questionIndex?: number;
  enabled: boolean;
  /** Daily가 잡은 mic+webcam 스트림을 공유받음 (중복 점유 방지) */
  audioStream?: MediaStream | null;
}

const ALERT_COOLDOWN_MS = 20_000;
const VOLUME_THRESHOLD = 0.15;
const SUSTAINED_FRAMES = 15;

export default function VoiceMonitor({ sessionId, questionIndex, enabled, audioStream }: VoiceMonitorProps) {
  const lastAlertTime = useRef(0);
  const loudFrames = useRef(0);
  const questionIndexRef = useRef(questionIndex);

  useEffect(() => { questionIndexRef.current = questionIndex; }, [questionIndex]);

  useEffect(() => {
    if (!enabled || !audioStream) return;
    if (audioStream.getAudioTracks().length === 0) return;

    let cancelled = false;
    let animId = 0;
    let audioCtx: AudioContext | null = null;

    try {
      audioCtx = new AudioContext();
      // ⚠️ 외부 스트림을 stop 하지 않음 (Daily 가 관리)
      const source = audioCtx.createMediaStreamSource(audioStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      const dataArray = new Float32Array(analyser.fftSize);

      const checkVolume = () => {
        if (cancelled) return;
        analyser.getFloatTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / dataArray.length);

        if (rms > VOLUME_THRESHOLD) {
          loudFrames.current++;
          if (loudFrames.current >= SUSTAINED_FRAMES) {
            const now = Date.now();
            if (now - lastAlertTime.current > ALERT_COOLDOWN_MS) {
              lastAlertTime.current = now;
              toast.warning('⚠️ 주변 음성이 감지되었습니다', {
                description: '조용한 환경에서 평가에 응시해 주세요. 이 행위는 기록됩니다.',
                duration: 6000,
              });
              supabase.from('monitoring_events').insert({
                session_id: sessionId,
                event_type: 'voice_detected' as any,
                question_index: questionIndexRef.current ?? null,
              } as any).then();
            }
            loudFrames.current = 0;
          }
        } else {
          loudFrames.current = Math.max(0, loudFrames.current - 1);
        }

        animId = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (err) {
      console.warn('Voice monitoring unavailable:', err);
    }

    return () => {
      cancelled = true;
      if (animId) cancelAnimationFrame(animId);
      audioCtx?.close().catch(() => {});
      // audioStream 은 외부(Daily)가 관리하므로 stop 하지 않음
    };
  }, [enabled, sessionId, audioStream]);

  return null;
}
