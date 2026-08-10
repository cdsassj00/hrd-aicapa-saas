import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Monitor, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface DualMonitorDetectorProps {
  onResult: (singleMonitor: boolean) => void;
  descOverride?: string;
}

type DetectStatus = 'idle' | 'checking' | 'single' | 'dual' | 'permission_required' | 'unsupported';

export default function DualMonitorDetector({ onResult, descOverride }: DualMonitorDetectorProps) {
  const [screenCount, setScreenCount] = useState<number | null>(null);
  const [status, setStatus] = useState<DetectStatus>('idle');
  const [showWarning, setShowWarning] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  const detectScreens = async () => {
    setStatus('checking');
    try {
      if (!('getScreenDetails' in window)) {
        // Chromium 외 브라우저(Safari, Firefox)는 모니터 수 확정 불가 → 엄격 모드에서 차단
        setStatus('unsupported');
        onResult(false);
        setShowPermissionDialog(true);
        return;
      }

      // 권한 상태 사전 조회 (Chromium)
      try {
        const perm = await (navigator.permissions as any).query({ name: 'window-management' as any });
        if (perm.state === 'denied') {
          setStatus('permission_required');
          onResult(false);
          setShowPermissionDialog(true);
          return;
        }
      } catch {
        // 일부 브라우저는 query 미지원 — 그대로 진행
      }

      const screenDetails = await (window as any).getScreenDetails();
      const count = screenDetails.screens?.length || 1;
      setScreenCount(count);
      if (count > 1) {
        setStatus('dual');
        setShowWarning(true);
        onResult(false);
      } else {
        setStatus('single');
        onResult(true);
      }
    } catch (err: any) {
      // 사용자가 권한 거부 → 통과시키지 않고 차단
      console.warn('[DualMonitorDetector] getScreenDetails failed:', err);
      setStatus('permission_required');
      onResult(false);
      setShowPermissionDialog(true);
    }
  };

  useEffect(() => {
    detectScreens();
    const handleChange = () => detectScreens();
    const screenObj = window.screen as any;
    if (screenObj?.addEventListener) {
      screenObj.addEventListener('change', handleChange);
      return () => screenObj.removeEventListener('change', handleChange);
    }
  }, []);

  const renderStatusBadge = () => {
    if (status === 'idle' || status === 'checking') return null;
    if (status === 'single') {
      return (
        <span className="text-[11px] text-primary flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> 단일 모니터
        </span>
      );
    }
    if (status === 'dual') {
      return (
        <span className="text-[11px] text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> 듀얼 모니터 감지
        </span>
      );
    }
    if (status === 'permission_required') {
      return (
        <span className="text-[11px] text-destructive flex items-center gap-1">
          <ShieldAlert className="h-3 w-3" /> 권한 필요
        </span>
      );
    }
    return (
      <span className="text-[11px] text-destructive flex items-center gap-1">
        <ShieldAlert className="h-3 w-3" /> 미지원 브라우저
      </span>
    );
  };

  return (
    <>
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">1. 모니터 확인</p>
            <p className="text-[11px] text-muted-foreground">{descOverride || '모니터는 1개만 사용해야 합니다. 듀얼 모니터 사용 시 응시가 제한됩니다.'}</p>
          </div>
        </div>
        {renderStatusBadge()}
      </div>

      {/* 듀얼 모니터 감지 시 */}
      <Dialog open={showWarning} onOpenChange={setShowWarning}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-[14px]">
              <AlertTriangle className="h-5 w-5" />
              듀얼 모니터 감지
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            <p>현재 <strong>{screenCount}개의 모니터</strong>가 연결된 것으로 감지되었습니다.</p>
            <p>평가의 공정성을 위해 <strong>단일 모니터</strong>만 사용해야 합니다. 추가 모니터의 연결을 해제한 후 다시 시도해 주세요.</p>
            <Card className="bg-muted/50">
              <CardContent className="p-3 text-[12px] space-y-1">
                <p className="font-medium">해결 방법:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                  <li>추가 모니터의 케이블을 분리하세요</li>
                  <li>디스플레이 설정에서 확장 디스플레이를 비활성화하세요</li>
                  <li>노트북의 경우 외부 모니터 연결을 해제하세요</li>
                </ul>
              </CardContent>
            </Card>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowWarning(false); detectScreens(); }}>
              다시 확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 권한 미허용 / 미지원 브라우저 */}
      <Dialog open={showPermissionDialog} onOpenChange={setShowPermissionDialog}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-[14px]">
              <ShieldAlert className="h-5 w-5" />
              {status === 'unsupported' ? '지원되지 않는 브라우저' : '창 관리 권한이 필요합니다'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            {status === 'unsupported' ? (
              <>
                <p>현재 브라우저는 모니터 개수 확인 기능을 지원하지 않습니다.</p>
                <p>평가의 공정성을 위해 <strong>최신 Chrome 또는 Edge</strong>로 다시 접속해 주세요.</p>
              </>
            ) : (
              <>
                <p>모니터 개수를 확인하려면 <strong>"창 관리(Window Management)"</strong> 권한이 필요합니다.</p>
                <p>주소창 왼쪽의 자물쇠 아이콘 → <strong>사이트 설정</strong> → <strong>창 관리: 허용</strong>으로 변경한 뒤 페이지를 새로고침해 주세요.</p>
                <Card className="bg-muted/50">
                  <CardContent className="p-3 text-[12px] space-y-1">
                    <p className="font-medium">왜 필요한가요?</p>
                    <p className="text-muted-foreground">권한 없이 통과시키면 듀얼 모니터를 우회할 수 있어 부정 응시가 가능합니다. 이 권한은 모니터 개수만 확인하는 데 사용됩니다.</p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowPermissionDialog(false); detectScreens(); }}>
              다시 확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
