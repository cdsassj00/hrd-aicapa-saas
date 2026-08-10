import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ExamBlackScreenProps {
  restricted: boolean;
  sessionId: string;
  questionIndex?: number;
  onViolation: (count: number) => void;
  maxViolations?: number;
  onForceSubmit?: () => void;
  /** 작업형 등 외부 도구 사용이 합법인 문항이면 true → 로깅만, 위반 카운트 제외 */
  isTaskQuestion?: boolean;
  /** false면 탭/창 전환 감지를 완전히 비활성화 (이벤트 리스너 등록 X, 로깅 X) */
  enabled?: boolean;
}

/**
 * [4] 부정행위 오탐 개선
 * - 1차 신호: visibilitychange (탭/창 전환)
 * - 2차 신호: window blur가 3초 이상 지속되고 document.hasFocus()===false 일 때만 (window_blur)
 * - 화이트리스트: getDisplayMedia/getUserMedia 호출 직후 5초간 grace
 *   (외부에서 window.dispatchEvent(new CustomEvent('proctor:media-prompt')) 호출하면 grace 시작)
 * - 작업형 문항(isTaskQuestion=true): 로깅만, 위반 카운트 제외
 * - 마운트 직후 30초 grace (입장 직후 권한 다이얼로그/picker 폭주 방지)
 */
export default function ExamBlackScreen({
  restricted,
  sessionId,
  questionIndex,
  onViolation,
  maxViolations = 5,
  isTaskQuestion = false,
  enabled = true,
}: ExamBlackScreenProps) {
  const restrictedRef = useRef(restricted);
  const sessionIdRef = useRef(sessionId);
  const questionIndexRef = useRef(questionIndex);
  const isTaskRef = useRef(isTaskQuestion);
  const onViolationRef = useRef(onViolation);
  const violationCountRef = useRef(0);

  const lastViolationTime = useRef(0);
  const mountedAt = useRef(Date.now());
  const mediaPromptUntil = useRef(0);
  const blurStartedAt = useRef<number | null>(null);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => { restrictedRef.current = restricted; }, [restricted]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { questionIndexRef.current = questionIndex; }, [questionIndex]);
  useEffect(() => { isTaskRef.current = isTaskQuestion; }, [isTaskQuestion]);
  useEffect(() => { onViolationRef.current = onViolation; }, [onViolation]);

  const logEvent = useCallback(async (event_type: 'tab_switch' | 'window_blur' | 'screen_share_picker') => {
    const payload = {
      session_id: sessionIdRef.current,
      event_type: event_type as any,
      question_index: questionIndexRef.current ?? null,
    };
    // 3회 재시도 후 실패 시 localStorage 큐에 보관 (다음 페이지 로드 시 재전송)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error } = await supabase.from('monitoring_events').insert(payload as any);
        if (!error) return;
        throw error;
      } catch {
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        // 최종 실패: 로컬 큐에 보관 (최대 100개)
        try {
          const key = 'pendingMonitoringEvents';
          const pending = JSON.parse(localStorage.getItem(key) || '[]');
          pending.push({ ...payload, queued_at: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(pending.slice(-100)));
        } catch { /* localStorage 가득 차도 무시 */ }
      }
    }
  }, []);

  const recordViolation = useCallback((eventType: 'tab_switch' | 'window_blur') => {
    const now = Date.now();
    // 입장 직후 30초 grace (권한 다이얼로그/picker 등 false positive 방지)
    if (now - mountedAt.current < 30000) return;
    // 미디어 권한 prompt 중이면 5초 grace
    if (now < mediaPromptUntil.current) {
      logEvent('screen_share_picker');
      return;
    }
    // 단순 debounce 1.5s
    if (now - lastViolationTime.current < 1500) return;
    lastViolationTime.current = now;

    // 항상 로깅 (분류는 eventType으로)
    logEvent(eventType);

    // 작업형 문항이면 위반 카운트 제외 (외부 도구 사용 합법)
    if (isTaskRef.current) return;

    if (restrictedRef.current) {
      violationCountRef.current += 1;
      const next = violationCountRef.current;
      onViolationRef.current(next);
      supabase
        .from('exam_sessions')
        .update({ is_flagged: true })
        .eq('id', sessionIdRef.current)
        .then();
    }
  }, [logEvent]);

  useEffect(() => {
    if (!enabled) return; // 외부 도구 허용 문항/세트 → 감지 완전 OFF
    // 1) visibilitychange — 탭 전환 1차 신호 (즉시 위반)
    const handleVisibility = () => {
      if (document.hidden) recordViolation('tab_switch');
    };

    // 2) window blur — 3초 이상 hasFocus=false 지속될 때만 위반
    const handleBlur = () => {
      blurStartedAt.current = Date.now();
      if (blurTimer.current) window.clearTimeout(blurTimer.current);
      blurTimer.current = window.setTimeout(() => {
        if (!document.hasFocus() && !document.hidden) {
          recordViolation('window_blur');
        }
        blurStartedAt.current = null;
        blurTimer.current = null;
      }, 3000);
    };

    const handleFocus = () => {
      if (blurTimer.current) {
        window.clearTimeout(blurTimer.current);
        blurTimer.current = null;
      }
      blurStartedAt.current = null;
    };

    // 3) 화이트리스트: 미디어 권한 prompt 시작 알림 (5초 grace)
    const handleMediaPrompt = () => {
      mediaPromptUntil.current = Date.now() + 5000;
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('proctor:media-prompt' as any, handleMediaPrompt);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('proctor:media-prompt' as any, handleMediaPrompt);
      if (blurTimer.current) window.clearTimeout(blurTimer.current);
    };
  }, [recordViolation, enabled]);

  return null;
}
