import { useEffect, useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Maximize, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface FullscreenGuardProps {
  enabled: boolean;
  sessionId: string;
  onViolation: (count: number) => void;
  maxViolations?: number;
  onForceSubmit?: () => void;
}

export default function FullscreenGuard({ enabled, sessionId, onViolation, maxViolations = 5, onForceSubmit }: FullscreenGuardProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [violationCount, setViolationCount] = useState(0);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);
  const graceRef = useRef(false);

  useEffect(() => {
    // Check if fullscreen is actually available
    const supported = document.fullscreenEnabled ?? false;
    setFullscreenSupported(supported);
  }, []);

  const enterFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && document.fullscreenEnabled) {
        graceRef.current = true;
        await document.documentElement.requestFullscreen();
        // Grace period to prevent immediate re-trigger
        setTimeout(() => { graceRef.current = false; }, 1000);
      }
      setShowWarning(false);
    } catch (err) {
      console.warn('Fullscreen request denied:', err);
      // CRITICAL: dismiss the dialog even if fullscreen fails
      // so the user isn't trapped
      setShowWarning(false);
      setFullscreenSupported(false);
    }
  }, []);

  const dismissWarning = useCallback(() => {
    setShowWarning(false);
  }, []);

  useEffect(() => {
    if (!enabled || !fullscreenSupported) return;

    const handleFullscreenChange = () => {
      if (graceRef.current) return;
      if (!document.fullscreenElement && enabled) {
        setShowWarning(true);
        setViolationCount(prev => {
          const next = prev + 1;
          onViolation(next);

          supabase.from('monitoring_events').insert({
            session_id: sessionId,
            event_type: 'tab_switch' as any,
          }).then();

          supabase.from('exam_sessions').update({ is_flagged: true }).eq('id', sessionId).then();

          if (next >= maxViolations && onForceSubmit) {
            onForceSubmit();
          }
          return next;
        });
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    enterFullscreen();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [enabled, fullscreenSupported, sessionId, onViolation, maxViolations, onForceSubmit, enterFullscreen]);

  if (!enabled) return null;

  return (
    <Dialog open={showWarning} onOpenChange={() => {}}>
      <DialogContent className="[&>button]:hidden" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            ⚠️ 전체화면 이탈 감지
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <p>전체화면 모드를 이탈하였습니다. 이 행위는 부정행위로 기록됩니다.</p>
            <p className="text-destructive font-semibold">
              위반 횟수: {violationCount}/{maxViolations}회
            </p>
            {violationCount >= maxViolations - 1 && (
              <p className="text-destructive font-bold">
                다음 위반 시 시험이 자동으로 제출됩니다!
              </p>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button onClick={enterFullscreen} className="w-full">
            <Maximize className="h-4 w-4 mr-2" />
            전체화면으로 복귀
          </Button>
          {!fullscreenSupported && (
            <Button variant="outline" onClick={dismissWarning} className="w-full text-[12px]">
              전체화면을 지원하지 않는 환경입니다 — 닫기
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={dismissWarning} className="w-full text-[11px] text-muted-foreground">
            전체화면 복귀가 안 되면 여기를 눌러주세요
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
