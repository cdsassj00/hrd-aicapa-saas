import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserCheck, IdCard, Camera, Upload, CheckCircle2, Loader2, XCircle, AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import IdCardMasker from './IdCardMasker';

interface Props {
  sessionId?: string;
  verified: boolean;
  onVerified: () => void;
  /** true 이면 신분증 업로드 후 얼굴 매칭 단계를 생략하고 바로 통과 처리 */
  skipFaceMatch?: boolean;
}

type ErrorCode =
  | 'NO_FACE_IN_ID'
  | 'NO_FACE_IN_SELFIE'
  | 'LOW_QUALITY'
  | 'MISMATCH'
  | 'IMAGE_TOO_LARGE'
  | 'INVALID_FORMAT'
  | 'API_ERROR'
  | null;

type VerifyResult = {
  match: boolean;
  confidence: string;
  reason: string;
  errorCode?: ErrorCode;
  similarity?: number;
} | null;

const FAILURE_GUIDES: Record<NonNullable<ErrorCode>, { title: string; tips: string[] }> = {
  NO_FACE_IN_SELFIE: {
    title: '셀카에서 얼굴이 인식되지 않았습니다',
    tips: [
      '카메라를 정면으로 응시하고 얼굴 전체가 화면 가이드 안에 들어오게 하세요',
      '마스크·선글라스·모자는 벗어 주세요',
      '머리카락이 눈썹·눈을 가리지 않게 정리해 주세요',
    ],
  },
  NO_FACE_IN_ID: {
    title: '신분증 사진에서 얼굴이 인식되지 않았습니다',
    tips: [
      '신분증을 평평한 곳에 놓고 정면에서 촬영해 주세요',
      '얼굴 사진 부분이 잘리거나 가려지지 않도록 전체가 보이게 해 주세요',
      '사진이 있는 공식 신분증을 사용해 주세요',
    ],
  },
  LOW_QUALITY: {
    title: '사진 품질이 낮아 정확한 비교가 어렵습니다',
    tips: [
      '밝은 곳에서 촬영해 주세요',
      '카메라 렌즈를 깨끗이 닦은 뒤 다시 촬영해 주세요',
      '얼굴 그림자를 피해 주세요',
    ],
  },
  MISMATCH: {
    title: '신분증 인물과 셀카가 일치하지 않습니다',
    tips: [
      '본인 명의의 신분증인지 확인해 주세요',
      '제3자의 신분증으로는 응시할 수 없습니다',
      '계속 실패하면 관리자에게 문의해 주세요',
    ],
  },
  IMAGE_TOO_LARGE: { title: '이미지 용량이 너무 큽니다', tips: ['5MB 이하 JPG 파일로 다시 업로드해 주세요'] },
  INVALID_FORMAT: { title: '지원하지 않는 이미지 형식입니다', tips: ['JPG 또는 PNG 형식으로 다시 업로드해 주세요'] },
  API_ERROR: { title: '본인 확인 처리 중 일시적 오류가 발생했습니다', tips: ['잠시 후 다시 시도해 주세요'] },
};

type Stage = 'idle' | 'id_uploading' | 'id_done' | 'selfie' | 'verifying' | 'failed';

export default function IdentityCheckCard({ sessionId, verified, onVerified, skipFaceMatch = false }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();

  // Stage machine
  const [stage, setStage] = useState<Stage>('idle');

  // Step 1: ID card
  const [maskerFile, setMaskerFile] = useState<File | null>(null);
  const [maskerOpen, setMaskerOpen] = useState(false);
  const [idBase64, setIdBase64] = useState<string | null>(null);
  const [idPreviewUrl, setIdPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: selfie
  const [selfieBase64, setSelfieBase64] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const capturedRef = useRef(false);
  const countdownRef = useRef<number | null>(null);

  // Result
  const [verifyResult, setVerifyResult] = useState<VerifyResult>(null);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => { cameraStream?.getTracks().forEach(t => t.stop()); };
  }, [cameraStream]);

  // 마운트 시 권한 없이 일단 디바이스 목록 노출 (라벨은 비어있을 수 있음)
  useEffect(() => {
    (async () => {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput' && d.deviceId);
        if (videoDevices.length > 0) {
          setDevices(videoDevices);
          setSelectedDeviceId(prev => prev || videoDevices[0].deviceId);
        }
      } catch { /* silent */ }
    })();
  }, []);

  // 권한 획득 후 라벨 포함된 디바이스 다시 가져오기
  const refreshDevicesWithLabels = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput' && d.deviceId);
      setDevices(videoDevices);
    } catch { /* silent */ }
  }, []);

  // ───── Step 1: ID card upload ─────
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: '파일 크기 초과', description: '최대 5MB까지 업로드 가능합니다.', variant: 'destructive' });
      return;
    }
    if (!file.type.match(/^image\/(jpeg|png)$/)) {
      toast({ title: '지원하지 않는 형식', description: 'JPG 또는 PNG 파일만 업로드 가능합니다.', variant: 'destructive' });
      return;
    }
    setMaskerFile(file);
    setMaskerOpen(true);
    e.target.value = '';
  };

  const handleMaskedConfirm = async (blob: Blob) => {
    setMaskerOpen(false);
    setMaskerFile(null);
    if (!sessionId) return;
    setStage('id_uploading');

    // blob → base64
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    const base64 = dataUrl.split(',')[1];

    // 엣지 펑션 경유로 업로드 (service role → 간헐적 storage 403 회피)
    const invokeUpload = async () => {
      return await supabase.functions.invoke('upload-id-card', {
        body: { sessionId, imageBase64: base64 },
      });
    };

    let { data, error } = await invokeUpload();
    // 실패 시 1회 자동 재시도 (1초 후)
    if (error) {
      console.error('upload-id-card 1차 실패:', error, data);
      await new Promise(r => setTimeout(r, 1000));
      const retry = await invokeUpload();
      data = retry.data;
      error = retry.error;
    }

    if (error || (data as any)?.error) {
      console.error('upload-id-card 최종 실패:', { error, data });
      const msg = (data as any)?.error || (error as any)?.context?.error || error?.message || '알 수 없는 오류';
      setStage('idle');
      toast({ title: '업로드 실패', description: msg, variant: 'destructive' });
      return;
    }

    setIdBase64(base64);
    setIdPreviewUrl(dataUrl);
    setStage('id_done');
    if (skipFaceMatch) {
      onVerified();
      toast({ title: '신분증 제출 완료', description: '본인 확인이 완료되었습니다.' });
    } else {
      toast({ title: '신분증 제출 완료', description: '이제 본인 얼굴을 촬영해 주세요.' });
    }
  };

  // ───── Step 2: selfie ─────
  const startCamera = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: 640, height: 480 }
          : { facingMode: 'user', width: 640, height: 480 },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      setStage('selfie');
      refreshDevicesWithLabels(); // 권한 받은 후 라벨 갱신
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch {
      toast({ title: '카메라 접근 실패', description: '카메라 권한을 허용해 주세요.', variant: 'destructive' });
    }
  }, [toast, selectedDeviceId, refreshDevicesWithLabels]);

  // selfie 단계 도중 카메라 변경 시 stream 재시작 + 카운트다운 리셋
  const handleDeviceChange = useCallback(async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (stage !== 'selfie') return;

    cameraStream?.getTracks().forEach(t => t.stop());
    // 카운트다운 리셋
    capturedRef.current = false;
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: 640, height: 480 },
      });
      setCameraStream(stream);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
      // selfie 상태 그대로 두면 기존 useEffect 가 카운트다운 다시 시작
    } catch {
      toast({ title: '카메라 전환 실패', variant: 'destructive' });
    }
  }, [stage, cameraStream, toast]);

  const captureAndVerify = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !idBase64) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const selfie = dataUrl.split(',')[1];
    setSelfieBase64(selfie);

    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setStage('verifying');

    try {
      const { data, error } = await supabase.functions.invoke('verify-identity', {
        body: { selfie_base64: selfie, id_photo_base64: idBase64, user_name: user?.name || '' },
      });
      if (error) throw error;
      setVerifyResult(data);
      if (data.match && (data.confidence === 'high' || data.confidence === 'medium')) {
        onVerified();
        toast({ title: '본인 확인 완료', description: data.reason });
      } else {
        setStage('failed');
        toast({ title: '본인 확인 실패', description: data.reason, variant: 'destructive' });
      }
    } catch (err: any) {
      setVerifyResult({ match: false, confidence: 'low', reason: '인증 처리 중 오류가 발생했습니다.', errorCode: 'API_ERROR' });
      setStage('failed');
      toast({ title: '인증 오류', description: err.message, variant: 'destructive' });
    }
  }, [idBase64, cameraStream, user, onVerified, toast]);

  // Auto-countdown when selfie camera opens
  useEffect(() => {
    if (stage !== 'selfie') return;
    capturedRef.current = false;
    const delay = setTimeout(() => {
      let count = 3;
      setCountdown(count);
      const timer = window.setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(timer);
          countdownRef.current = null;
          setCountdown(null);
          if (!capturedRef.current) {
            capturedRef.current = true;
            captureAndVerify();
          }
          return;
        }
        setCountdown(count);
      }, 1000);
      countdownRef.current = timer;
    }, 1500);
    return () => {
      clearTimeout(delay);
      if (countdownRef.current !== null) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdown(null);
    };
  }, [stage, captureAndVerify]);

  const retrySelfie = () => {
    setSelfieBase64(null);
    setVerifyResult(null);
    setStage('id_done');
  };

  const resetAll = () => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setIdBase64(null);
    setIdPreviewUrl(null);
    setSelfieBase64(null);
    setVerifyResult(null);
    setStage('idle');
  };

  // ───── Verified state (compact) ─────
  if (verified) {
    return (
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <UserCheck className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">본인 확인</p>
            <p className="text-[11px] text-muted-foreground">
              {skipFaceMatch ? '신분증 제출이 완료되었습니다' : '신분증 제출 및 AI 얼굴 매칭이 완료되었습니다'}
              {verifyResult?.similarity ? ` (일치도 ${verifyResult.similarity.toFixed(1)}%)` : ''}
            </p>
          </div>
        </div>
        <Badge variant="default" className="text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />확인됨</Badge>
      </div>
    );
  }

  const step1Done = stage === 'id_done' || stage === 'selfie' || stage === 'verifying' || stage === 'failed';

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <UserCheck className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">{skipFaceMatch ? '본인 확인 (신분증 제출)' : '본인 확인 (신분증 + AI 얼굴 매칭)'}</p>
            <p className="text-[11px] text-muted-foreground">
              {skipFaceMatch ? '신분증을 업로드하면 본인 확인이 완료됩니다' : '신분증을 업로드하고 본인 얼굴을 촬영하면 자동으로 대조됩니다'}
            </p>
          </div>
        </div>
        {stage === 'id_uploading' || stage === 'verifying' ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {/* Stepper card */}
      <Card className="border-primary/20">
        <CardContent className="p-4 space-y-4">
          {/* Step 1: ID card */}
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
              step1Done ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary'
            }`}>
              {step1Done ? <CheckCircle2 className="h-4 w-4" /> : '1'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <IdCard className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[12px] font-medium">신분증 업로드 (주민번호 뒷자리 마스킹)</p>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                JPG/PNG, 최대 5MB. 업로드 후 주민번호 뒷자리를 검정으로 가립니다.
              </p>
              {!step1Done && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={handleFilePick}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[12px]"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={stage === 'id_uploading'}
                  >
                    {stage === 'id_uploading'
                      ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />업로드 중...</>
                      : <><Upload className="h-3 w-3 mr-1" />신분증 선택</>}
                  </Button>
                </>
              )}
              {step1Done && idPreviewUrl && (
                <div className="flex items-center gap-3 mt-1">
                  <img src={idPreviewUrl} alt="신분증" className="h-16 w-24 object-cover rounded border" />
                  <Button size="sm" variant="ghost" className="text-[11px] h-7" onClick={resetAll}>
                    <RotateCcw className="h-3 w-3 mr-1" />다시 업로드
                  </Button>
                </div>
              )}
            </div>
          </div>

          {!skipFaceMatch && <>
          {/* Divider */}
          <div className="border-t border-dashed" />

          {/* Step 2: selfie */}
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
              !step1Done ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary'
            }`}>
              2
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                <p className={`text-[12px] font-medium ${!step1Done ? 'text-muted-foreground' : ''}`}>
                  본인 얼굴 촬영 → 자동 대조
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                카메라가 켜지면 3초 후 자동 촬영되어 신분증 사진과 비교합니다.
              </p>

              {stage === 'id_done' && !skipFaceMatch && (
                <div className="space-y-2">
                  {devices.length > 0 && (
                    <div className="flex items-center gap-2 px-3">
                      <span className="text-[11px] text-muted-foreground shrink-0">카메라 선택</span>
                      <Select value={selectedDeviceId} onValueChange={handleDeviceChange}>
                        <SelectTrigger className="h-7 text-[11px] flex-1">
                          <SelectValue placeholder="웹캠 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          {devices.map((d, i) => (
                            <SelectItem key={d.deviceId} value={d.deviceId} className="text-[11px]">
                              {d.label || `카메라 ${i + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refreshDevicesWithLabels()} title="새로고침">
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <Button size="sm" className="text-[12px]" onClick={startCamera}>
                    <Camera className="h-3 w-3 mr-1" />얼굴 촬영 시작
                  </Button>
                </div>
              )}

              {stage === 'selfie' && !skipFaceMatch && (
                <div className="space-y-2">
                  {devices.length > 1 && (
                    <div className="flex items-center gap-2 px-3">
                      <span className="text-[11px] text-muted-foreground shrink-0">카메라</span>
                      <Select value={selectedDeviceId} onValueChange={handleDeviceChange}>
                        <SelectTrigger className="h-7 text-[11px] flex-1">
                          <SelectValue placeholder="웹캠 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          {devices.map((d, i) => (
                            <SelectItem key={d.deviceId} value={d.deviceId} className="text-[11px]">
                              {d.label || `카메라 ${i + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="relative rounded-md overflow-hidden bg-black aspect-video max-h-[240px]">
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-36 h-48 border-2 border-dashed rounded-full border-white/60" />
                    </div>
                    {countdown !== null && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-[64px] font-bold text-white drop-shadow-lg animate-pulse">{countdown}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-center text-muted-foreground">
                    {countdown !== null ? `${countdown}초 후 자동 촬영됩니다 — 가만히 계세요` : '카메라 준비 중...'}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" onClick={captureAndVerify}>
                      <Camera className="h-3 w-3 mr-1" />수동 촬영
                    </Button>
                    <Button size="sm" variant="ghost" onClick={retrySelfie}>취소</Button>
                  </div>
                </div>
              )}

              {stage === 'verifying' && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <p className="text-[12px]">AI가 신분증과 얼굴을 대조하고 있습니다...</p>
                </div>
              )}

              {stage === 'failed' && verifyResult && (() => {
                const code = (verifyResult.errorCode || 'LOW_QUALITY') as NonNullable<ErrorCode>;
                const guide = FAILURE_GUIDES[code] ?? FAILURE_GUIDES.LOW_QUALITY;
                const isMismatch = code === 'MISMATCH';
                return (
                  <div className={`p-3 rounded-md border ${isMismatch ? 'border-destructive/40 bg-destructive/5' : 'border-yellow-500/40 bg-yellow-500/5'}`}>
                    <div className="flex items-start gap-2">
                      {isMismatch
                        ? <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        : <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />}
                      <div className="flex-1 space-y-1.5">
                        <div>
                          <p className="text-[12px] font-medium">{guide.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{verifyResult.reason}</p>
                        </div>
                        <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
                          {guide.tips.map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="outline" className="text-[11px] h-7" onClick={retrySelfie}>
                            <RotateCcw className="h-3 w-3 mr-1" />얼굴 다시 촬영
                          </Button>
                          {(code === 'NO_FACE_IN_ID' || code === 'MISMATCH') && (
                            <Button size="sm" variant="ghost" className="text-[11px] h-7" onClick={resetAll}>
                              신분증부터 다시
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            </div>
          </>}
        </CardContent>
      </Card>

      {/* Masker dialog */}
      {maskerFile && (
        <IdCardMasker
          file={maskerFile}
          open={maskerOpen}
          onClose={() => { setMaskerOpen(false); setMaskerFile(null); }}
          onConfirm={handleMaskedConfirm}
        />
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
