import { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface FaceMonitorProps {
  /** The <video> element showing the webcam feed */
  videoEl: HTMLVideoElement | null;
  sessionId: string;
  questionIndex?: number;
  enabled: boolean;
  /** 시험 알림설정 화이트리스트: face_missing 이벤트 알림/기록 허용 여부 (기본 true) */
  notifyFaceMissing?: boolean;
  /** 시험 알림설정 화이트리스트: multiple_faces 이벤트 알림/기록 허용 여부 (기본 true) */
  notifyMultipleFaces?: boolean;
}

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
const CHECK_INTERVAL_MS = 4000;
const CONSECUTIVE_MISSING_THRESHOLD = 3; // 3 × 4s = ~12s
const ALERT_COOLDOWN_MS = 15_000;

// 모듈 레벨 캐시: 앱 전체에서 모델을 1회만 다운로드
let modelLoadPromise: Promise<void> | null = null;
const ensureModelsLoaded = (): Promise<void> => {
  if (!modelLoadPromise) {
    modelLoadPromise = faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
      .catch(err => {
        modelLoadPromise = null; // 실패 시 다음 호출에서 재시도 가능
        throw err;
      });
  }
  return modelLoadPromise;
};

export default function FaceMonitor({ videoEl, sessionId, questionIndex, enabled, notifyFaceMissing = true, notifyMultipleFaces = true }: FaceMonitorProps) {

  const [modelsReady, setModelsReady] = useState(false);
  const consecutiveMissing = useRef(0);
  const lastFaceMissingAlert = useRef(0);
  const lastMultipleFacesAlert = useRef(0);
  const questionIndexRef = useRef(questionIndex);

  useEffect(() => { questionIndexRef.current = questionIndex; }, [questionIndex]);

  // Load face detection model — 모듈 레벨 캐시로 앱 전체에서 1회만 네트워크 요청
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    ensureModelsLoaded()
      .then(() => { if (!cancelled) setModelsReady(true); })
      .catch(err => { console.warn('Face detection model load failed:', err); });
    return () => { cancelled = true; };
  }, [enabled]);

  // Detection loop
  useEffect(() => {
    if (!enabled || !videoEl) return;

    const interval = setInterval(async () => {
      if (!modelsReady || !videoEl || videoEl.paused || videoEl.ended || videoEl.readyState < 2) return;

      try {
        const detections = await faceapi.detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }));
        const now = Date.now();

        if (detections.length === 0) {
          consecutiveMissing.current++;
          if (notifyFaceMissing && consecutiveMissing.current >= CONSECUTIVE_MISSING_THRESHOLD && now - lastFaceMissingAlert.current > ALERT_COOLDOWN_MS) {
            lastFaceMissingAlert.current = now;
            toast.warning('⚠️ 카메라에 얼굴이 감지되지 않습니다', {
              description: '카메라 정면을 바라봐 주세요. 이 행위는 기록됩니다.',
              duration: 6000,
            });
            supabase.from('monitoring_events').insert({
              session_id: sessionId,
              event_type: 'face_missing' as any,
              question_index: questionIndexRef.current ?? null,
            } as any).then();
          }
        } else if (detections.length > 1) {
          consecutiveMissing.current = 0;
          if (notifyMultipleFaces && now - lastMultipleFacesAlert.current > ALERT_COOLDOWN_MS) {
            lastMultipleFacesAlert.current = now;
            toast.warning('⚠️ 복수 인원이 감지되었습니다', {
              description: '혼자서 평가에 응시해 주세요. 이 행위는 기록됩니다.',
              duration: 6000,
            });
            supabase.from('monitoring_events').insert({
              session_id: sessionId,
              event_type: 'multiple_faces' as any,
              question_index: questionIndexRef.current ?? null,
            } as any).then();
          }
        } else {
          consecutiveMissing.current = 0;
        }

      } catch {
        // Silently ignore detection errors
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, videoEl, sessionId, modelsReady]);

  return null;
}
