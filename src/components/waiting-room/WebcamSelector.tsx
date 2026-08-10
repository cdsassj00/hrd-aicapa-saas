import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface WebcamSelectorProps {
  checked: boolean;
  checking: boolean;
  onChecked: (stream: MediaStream, deviceId: string) => void;
  stream: MediaStream | null;
  descOverride?: string;
}

/** Verify the video track is truly producing frames */
async function verifyVideoTrack(stream: MediaStream): Promise<boolean> {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live' || !track.enabled) return false;

  // Draw a frame to canvas and check it's not blank
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.play().then(() => {
      setTimeout(() => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 320;
          canvas.height = video.videoHeight || 240;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(false); return; }
          ctx.drawImage(video, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          // Check if all pixels are black (no signal)
          let nonBlack = 0;
          for (let i = 0; i < data.length; i += 16) {
            if (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5) nonBlack++;
          }
          resolve(nonBlack > 10);
        } catch {
          resolve(false);
        }
      }, 800);
    }).catch(() => resolve(false));
  });
}

export default function WebcamSelector({ checked, checking, onChecked, stream, descOverride }: WebcamSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  // 마운트 시 권한 없이 일단 디바이스 목록 노출 (라벨이 비어있을 수 있음)
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

  const enumerateDevices = async () => {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput' && d.deviceId);
      setDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }
      return videoDevices;
    } catch {
      toast({ title: '웹캠 접근 실패', description: '웹캠 권한을 허용해 주세요.', variant: 'destructive' });
      return [];
    }
  };

  const activateWebcam = async (deviceId?: string) => {
    setLoading(true);
    try {
      const targetId = deviceId || selectedDeviceId;
      const videoDevices = devices.length > 0 ? devices : await enumerateDevices();
      const finalId = targetId || (videoDevices.length > 0 ? videoDevices[0].deviceId : undefined);

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: finalId ? { deviceId: { exact: finalId } } : true,
      });

      // Verify the track is actually producing frames
      const isReal = await verifyVideoTrack(newStream);
      if (!isReal) {
        newStream.getTracks().forEach(t => t.stop());
        toast({
          title: '웹캠 영상 없음',
          description: '웹캠이 연결되어 있지만 영상이 감지되지 않습니다. 다른 카메라를 선택하거나 웹캠 연결을 확인해 주세요.',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      setSelectedDeviceId(finalId || '');
      onChecked(newStream, finalId || '');
      toast({ title: '웹캠 연결 성공', description: '웹캠이 정상적으로 감지되었습니다.' });
    } catch {
      toast({
        title: '웹캠 연결 실패',
        description: '웹캠 접근 권한을 허용해 주세요. 다른 프로그램(Zoom 등)이 카메라를 사용 중이면 종료 후 다시 시도하세요.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeviceChange = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (!checked) return; // 점검 전에는 선택만 저장
    stream?.getTracks().forEach(t => t.stop());
    await activateWebcam(deviceId);
  };

  const isLoading = loading || checking;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <Camera className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">2. 웹캠 연결</p>
            <p className="text-[11px] text-muted-foreground">{descOverride || '웹캠이 정상적으로 연결되어 있어야 하며, 얼굴 전체가 화면에 보여야 합니다.'}</p>
          </div>
        </div>
        <Button
          variant={checked ? 'default' : 'outline'}
          size="sm"
          className="text-[12px]"
          onClick={() => activateWebcam()}
          disabled={checked || isLoading}
        >
          {isLoading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />확인 중...</> :
           checked ? <><CheckCircle2 className="h-3 w-3 mr-1" />확인됨</> : '확인하기'}
        </Button>
      </div>

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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => enumerateDevices()} title="새로고침">
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      )}

      {stream && (
        <div className="rounded-md border overflow-hidden bg-black max-w-[320px] mx-auto">
          <video ref={videoRef} autoPlay muted playsInline className="w-full aspect-video object-cover" />
        </div>
      )}
    </div>
  );
}
