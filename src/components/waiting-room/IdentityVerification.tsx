import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Camera, Upload, UserCheck, CheckCircle2, Loader2, XCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  sessionId?: string;
  verified: boolean;
  onVerified: () => void;
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

// 실패 유형별 구체적 촬영 가이드
const FAILURE_GUIDES: Record<NonNullable<ErrorCode>, { title: string; tips: string[] }> = {
  NO_FACE_IN_SELFIE: {
    title: '셀카에서 얼굴이 인식되지 않았습니다',
    tips: [
      '카메라를 정면으로 응시하고 얼굴 전체가 화면 가이드 안에 들어오게 하세요',
      '마스크·선글라스·모자는 벗어 주세요',
      '머리카락이 눈썹·눈을 가리지 않게 정리해 주세요',
      '얼굴이 너무 작거나 화면 가장자리에 치우치지 않게 하세요',
    ],
  },
  NO_FACE_IN_ID: {
    title: '신분증 사진에서 얼굴이 인식되지 않았습니다',
    tips: [
      '신분증을 평평한 곳에 놓고 정면에서 촬영해 주세요',
      '얼굴 사진 부분이 잘리거나 가려지지 않도록 전체가 보이게 해 주세요',
      '신분증을 기울이거나 비스듬히 찍지 마세요',
      '주민등록증·운전면허증·여권 등 사진이 있는 공식 신분증을 사용해 주세요',
    ],
  },
  LOW_QUALITY: {
    title: '사진 품질이 낮아 정확한 비교가 어렵습니다',
    tips: [
      '밝은 곳에서 촬영해 주세요 (역광·어두운 환경 피하기)',
      '카메라 렌즈를 깨끗이 닦은 뒤 다시 촬영해 주세요',
      '카메라를 흔들지 말고 초점을 맞춰 주세요',
      '얼굴 그림자(예: 모자챙·실내 형광등)를 피해 주세요',
    ],
  },
  MISMATCH: {
    title: '신분증 인물과 셀카가 일치하지 않습니다',
    tips: [
      '본인 명의의 신분증인지 확인해 주세요',
      '제3자의 신분증으로는 응시할 수 없습니다',
      '신분증 사진과 현재 외모(머리 길이·안경 등)가 크게 달라졌다면 다른 신분증으로 시도해 주세요',
      '계속 실패하면 관리자에게 문의해 주세요',
    ],
  },
  IMAGE_TOO_LARGE: {
    title: '이미지 용량이 너무 큽니다',
    tips: [
      '5MB 이하 JPG 파일로 다시 업로드해 주세요',
      '신분증을 휴대폰으로 새로 촬영하면 용량이 자동으로 줄어듭니다',
    ],
  },
  INVALID_FORMAT: {
    title: '지원하지 않는 이미지 형식입니다',
    tips: ['JPG 또는 PNG 형식으로 다시 업로드해 주세요'],
  },
  API_ERROR: {
    title: '본인 확인 처리 중 일시적 오류가 발생했습니다',
    tips: [
      '잠시 후 다시 시도해 주세요',
      '계속 오류가 발생하면 관리자에게 문의해 주세요',
    ],
  },
};


export default function IdentityVerification({ sessionId, verified, onVerified }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState<'idle' | 'selfie' | 'id' | 'verifying' | 'done'>('idle');
  const [selfieData, setSelfieData] = useState<string | null>(null);
  const [idData, setIdData] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const countdownRef = useRef<number | null>(null);
  const capturedRef = useRef(false);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      setCameraStream(stream);
      setStep('selfie');
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch {
      toast({ title: '카메라 접근 실패', description: '카메라 권한을 허용해 주세요.', variant: 'destructive' });
    }
  }, [toast]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.split(',')[1];
    setSelfieData(base64);

    // Stop camera
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setStep('id');
  }, [cameraStream]);

  // Auto-countdown: start 3s timer when camera opens
  useEffect(() => {
    if (step !== 'selfie') return;
    capturedRef.current = false;

    // Wait 1.5s for camera to stabilize, then start countdown
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
            capturePhoto();
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
  }, [step, capturePhoto]);

  const handleIdUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Also upload to storage for record
    if (sessionId) {
      const ext = file.name.split('.').pop();
      const path = `id-photos/${sessionId}_${Date.now()}.${ext}`;
      await supabase.storage.from('answer-files').upload(path, file);
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setIdData(base64);
      verifyIdentity(base64);
    };
    reader.readAsDataURL(file);
  }, [sessionId, selfieData]);

  const verifyIdentity = useCallback(async (idBase64: string) => {
    if (!selfieData) return;
    setStep('verifying');

    try {
      const { data, error } = await supabase.functions.invoke('verify-identity', {
        body: { selfie_base64: selfieData, id_photo_base64: idBase64, user_name: user?.name || '' },
      });

      if (error) throw error;

      setVerifyResult(data);
      setStep('done');

      if (data.match && (data.confidence === 'high' || data.confidence === 'medium')) {
        onVerified();
        toast({ title: '본인 확인 완료', description: data.reason });
      } else {
        toast({
          title: '본인 확인 실패',
          description: data.reason || '얼굴이 일치하지 않습니다. 다시 시도해주세요.',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      setStep('done');
      setVerifyResult({ match: false, confidence: 'low', reason: '인증 처리 중 오류가 발생했습니다.', errorCode: 'API_ERROR' });
      toast({ title: '인증 오류', description: err.message, variant: 'destructive' });
    }
  }, [selfieData, onVerified, toast]);

  const reset = useCallback(() => {
    setSelfieData(null);
    setIdData(null);
    setVerifyResult(null);
    setStep('idle');
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
  }, [cameraStream]);

  if (verified) {
    return (
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <UserCheck className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">본인 확인</p>
            <p className="text-[11px] text-muted-foreground">AI 얼굴 매칭으로 본인 확인이 완료되었습니다</p>
          </div>
        </div>
        <Button variant="default" size="sm" className="text-[12px]" disabled>
          <CheckCircle2 className="h-3 w-3 mr-1" />확인됨
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <UserCheck className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">본인 확인 (AI 얼굴 매칭)</p>
            <p className="text-[11px] text-muted-foreground">
              {step === 'idle' && '얼굴 사진 촬영 후 신분증과 대조합니다'}
              {step === 'selfie' && '얼굴을 가이드 안에 맞추세요 — 자동 촬영됩니다'}
              {step === 'id' && '신분증 사진을 업로드해 주세요'}
              {step === 'verifying' && 'AI가 얼굴을 대조하고 있습니다...'}
              {step === 'done' && (verifyResult?.match ? '본인 확인 완료' : '확인 실패 — 다시 시도해주세요')}
            </p>
          </div>
        </div>
        {step === 'idle' && (
          <Button variant="outline" size="sm" className="text-[12px]" onClick={startCamera}>
            <Camera className="h-3 w-3 mr-1" />촬영 시작
          </Button>
        )}
        {step === 'verifying' && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Camera view for selfie */}
      {step === 'selfie' && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="relative rounded-md overflow-hidden bg-black aspect-video max-h-[240px]">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              {/* Face guide overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-36 h-48 border-2 border-dashed rounded-full border-white/60" />
              </div>
              {/* Countdown overlay */}
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
              <Button size="sm" onClick={capturePhoto}>
                <Camera className="h-3 w-3 mr-1" />수동 촬영
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>취소</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selfie preview + ID upload */}
      {step === 'id' && selfieData && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-4">
              <div className="flex-1 space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">촬영된 얼굴</p>
                <img
                  src={`data:image/jpeg;base64,${selfieData}`}
                  alt="셀카"
                  className="w-full rounded-md border aspect-[4/3] object-cover"
                />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">신분증 사진</p>
                {idData ? (
                  <img
                    src={`data:image/jpeg;base64,${idData}`}
                    alt="신분증"
                    className="w-full rounded-md border aspect-[4/3] object-cover"
                  />
                ) : (
                  <div
                    className="w-full rounded-md border border-dashed aspect-[4/3] flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <p className="text-[11px] text-muted-foreground">클릭하여 업로드</p>
                  </div>
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleIdUpload}
            />
            <div className="flex gap-2 justify-center">
              {!idData && (
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3 w-3 mr-1" />신분증 업로드
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={reset}>
                <RotateCcw className="h-3 w-3 mr-1" />처음부터
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verifying */}
      {step === 'verifying' && (
        <Card className="border-primary/30">
          <CardContent className="p-6 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-[13px] font-medium">AI가 얼굴을 대조하고 있습니다...</p>
            <p className="text-[11px] text-muted-foreground">잠시만 기다려주세요</p>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {step === 'done' && verifyResult && !verifyResult.match && (() => {
        const code = (verifyResult.errorCode || 'LOW_QUALITY') as NonNullable<ErrorCode>;
        const guide = FAILURE_GUIDES[code] ?? FAILURE_GUIDES.LOW_QUALITY;
        const isMismatch = code === 'MISMATCH';
        return (
          <Card className={isMismatch ? 'border-destructive/40' : 'border-yellow-500/40'}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                {isMismatch
                  ? <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  : <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />}
                <div className="flex-1 space-y-2">
                  <div>
                    <p className="text-[13px] font-medium">{guide.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{verifyResult.reason}</p>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside pl-1">
                    {guide.tips.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={reset}>
                <RotateCcw className="h-3 w-3 mr-1" />다시 시도
              </Button>
            </CardContent>
          </Card>
        );
      })()}


      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
