import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Upload, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Provider = 'facepp' | 'aws';

type Result = {
  confidence?: number;
  thresholds?: Record<string, number>;
  passLevel?: 'high' | 'medium' | 'low' | 'fail';
  match?: boolean;
  faces1?: number;
  faces2?: number;
  matchedFaces?: number;
  unmatchedFaces?: number;
  error?: string;
  raw?: any;
};

export default function FaceppTestPage() {
  const { toast } = useToast();
  const [provider, setProvider] = useState<Provider>('aws');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [idPhoto, setIdPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idInputRef = useRef<HTMLInputElement>(null);


  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      setStream(s);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch {
      toast({ title: '카메라 접근 실패', variant: 'destructive' });
    }
  };

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current, c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    setSelfie(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
  };

  const onIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => setIdPhoto((r.result as string).split(',')[1]);
    r.readAsDataURL(f);
  };

  const runCompare = useCallback(async () => {
    if (!selfie || !idPhoto) return;
    setLoading(true); setResult(null);
    try {
      const fn = provider === 'aws' ? 'aws-rekognition-compare-test' : 'facepp-compare-test';
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { selfie_base64: selfie, id_photo_base64: idPhoto },
      });
      if (error) throw error;
      setResult(data);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  }, [selfie, idPhoto, provider]);


  const reset = () => { setSelfie(null); setIdPhoto(null); setResult(null); stream?.getTracks().forEach(t => t.stop()); setStream(null); };

  return (
    <div className="container max-w-4xl mx-auto py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">얼굴 대조 테스트</h1>
        <p className="text-sm text-muted-foreground mt-1">
          기존 본인 확인(verify-identity) 기능과 독립된 테스트 페이지입니다. 운영 흐름에 영향을 주지 않습니다.
        </p>
      </div>

      <Card>
        <CardContent className="py-3 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium mr-2">엔진:</span>
          <Button
            size="sm"
            variant={provider === 'aws' ? 'default' : 'outline'}
            onClick={() => { setProvider('aws'); setResult(null); }}
          >
            AWS Rekognition (서울)
          </Button>
          <Button
            size="sm"
            variant={provider === 'facepp' ? 'default' : 'outline'}
            onClick={() => { setProvider('facepp'); setResult(null); }}
          >
            Face++ (중국)
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">
            {provider === 'aws' ? '국내 리전 처리 · 임계값 80/90/95' : '중국 서버 · 임계값 1e-3/1e-4/1e-5'}
          </span>
        </CardContent>
      </Card>


      <div className="grid grid-cols-2 gap-4">
        {/* Selfie */}
        <Card>
          <CardHeader><CardTitle className="text-base">1. 셀카 촬영</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {selfie ? (
              <img src={`data:image/jpeg;base64,${selfie}`} className="w-full aspect-[4/3] object-cover rounded border" alt="selfie" />
            ) : stream ? (
              <>
                <div className="relative rounded overflow-hidden bg-black aspect-[4/3]">
                  <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                </div>
                <Button size="sm" onClick={capture} className="w-full"><Camera className="h-3 w-3 mr-1" />촬영</Button>
              </>
            ) : (
              <Button size="sm" onClick={startCamera} className="w-full"><Camera className="h-3 w-3 mr-1" />카메라 시작</Button>
            )}
          </CardContent>
        </Card>

        {/* ID */}
        <Card>
          <CardHeader><CardTitle className="text-base">2. 신분증 업로드</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {idPhoto ? (
              <img src={`data:image/jpeg;base64,${idPhoto}`} className="w-full aspect-[4/3] object-cover rounded border" alt="id" />
            ) : (
              <div onClick={() => idInputRef.current?.click()}
                className="w-full aspect-[4/3] rounded border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/50">
                <Upload className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">클릭하여 신분증 업로드</p>
              </div>
            )}
            <input ref={idInputRef} type="file" accept="image/*" className="hidden" onChange={onIdUpload} />
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button onClick={runCompare} disabled={!selfie || !idPhoto || loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {provider === 'aws' ? 'AWS Rekognition' : 'Face++'} Compare 실행
        </Button>
        <Button variant="outline" onClick={reset}>초기화</Button>
      </div>

      {result && (
        <Card className={result.error ? 'border-destructive/40' : result.match ? 'border-green-500/40' : 'border-yellow-500/40'}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {result.error ? <XCircle className="h-4 w-4 text-destructive" /> :
                result.match ? <CheckCircle2 className="h-4 w-4 text-green-600" /> :
                <XCircle className="h-4 w-4 text-yellow-600" />}
              결과 ({provider === 'aws' ? 'AWS Rekognition' : 'Face++'})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {result.error ? (
              <p className="text-destructive">{result.error}</p>
            ) : (
              <>
                <p><span className="font-medium">{provider === 'aws' ? 'Similarity' : 'Confidence'}:</span> {result.confidence?.toFixed(2)} / 100</p>
                <p><span className="font-medium">판정 등급:</span> {result.passLevel}</p>
                <p><span className="font-medium">검출된 얼굴:</span> 신분증 {result.faces1}, 셀카 {result.faces2}</p>
                {provider === 'aws' ? (
                  <p className="text-xs text-muted-foreground">
                    Thresholds — 80%(low) / 90%(medium) / 95%(high) · 매칭 {result.matchedFaces ?? 0} / 비매칭 {result.unmatchedFaces ?? 0}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Thresholds — 1e-3: {result.thresholds?.['1e-3']?.toFixed(2)} / 1e-4: {result.thresholds?.['1e-4']?.toFixed(2)} / 1e-5: {result.thresholds?.['1e-5']?.toFixed(2)}
                  </p>
                )}

                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-muted-foreground">원본 응답</summary>
                  <pre className="text-[10px] mt-1 p-2 bg-muted rounded overflow-auto">{JSON.stringify(result.raw, null, 2)}</pre>
                </details>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
