import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Eraser, RotateCcw, Upload, MousePointer2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  file: File;
  open: boolean;
  onClose: () => void;
  onConfirm: (maskedBlob: Blob) => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function IdCardMasker({ file, open, onClose, onConfirm }: Props) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Load image
  useEffect(() => {
    if (!open || !file) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setRects([]);
      setCurrentRect(null);
      fitCanvas();
    };
    img.src = URL.createObjectURL(file);
    return () => URL.revokeObjectURL(img.src);
  }, [file, open]);

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imgRef.current;
    if (!canvas || !container || !img) return;

    const maxW = container.clientWidth;
    if (!maxW) return; // 레이아웃 전 → ResizeObserver가 다시 부름
    const maxH = container.clientHeight || 500;
    const s = Math.min(maxW / img.width, maxH / img.height, 1);
    setScale(s);

    const displayW = img.width * s;
    const displayH = img.height * s;
    canvas.width = displayW;
    canvas.height = displayH;
    setOffset({ x: 0, y: 0 });
    redraw(s, []);
  }, []);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => fitCanvas());
    ro.observe(container);
    return () => ro.disconnect();
  }, [open, fitCanvas]);

  const redraw = useCallback((s?: number, rectList?: Rect[]) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sc = s ?? scale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, img.width * sc, img.height * sc);

    // Draw saved rects
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    for (const r of (rectList ?? rects)) {
      ctx.fillRect(r.x * sc, r.y * sc, r.w * sc, r.h * sc);
    }

    // Draw current rect
    if (currentRect) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(currentRect.x * sc, currentRect.y * sc, currentRect.w * sc, currentRect.h * sc);
    }
  }, [scale, rects, currentRect]);

  useEffect(() => {
    redraw();
  }, [rects, currentRect, redraw]);

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    setStartPos(pos);
    setDrawing(true);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing || !startPos) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    setCurrentRect({
      x: Math.min(startPos.x, pos.x),
      y: Math.min(startPos.y, pos.y),
      w: Math.abs(pos.x - startPos.x),
      h: Math.abs(pos.y - startPos.y),
    });
  };

  const handlePointerUp = () => {
    if (currentRect && currentRect.w > 5 && currentRect.h > 5) {
      setRects(prev => [...prev, currentRect]);
    }
    setCurrentRect(null);
    setDrawing(false);
    setStartPos(null);
  };

  const handleUndo = () => {
    setRects(prev => prev.slice(0, -1));
  };

  const handleReset = () => {
    setRects([]);
    setCurrentRect(null);
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;

    if (rects.length === 0) {
      toast({ title: '마스킹이 필요합니다', description: '주민번호 뒷자리를 드래그로 가린 후 업로드할 수 있습니다', variant: 'destructive' });
      return;
    }

    // iOS Safari 캔버스 픽셀 한계 회피: 긴 변 최대 2000px로 다운스케일
    const MAX_LONG = 2000;
    const longSide = Math.max(img.width, img.height);
    const ds = longSide > MAX_LONG ? MAX_LONG / longSide : 1;
    const outW = Math.round(img.width * ds);
    const outH = Math.round(img.height * ds);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = outW;
    exportCanvas.height = outH;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
      toast({ title: '이미지 처리에 실패했습니다', description: '사진 크기를 줄여 다시 시도해 주세요', variant: 'destructive' });
      return;
    }

    ctx.drawImage(img, 0, 0, outW, outH);
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    for (const r of rects) {
      ctx.fillRect(r.x * ds, r.y * ds, r.w * ds, r.h * ds);
    }

    exportCanvas.toBlob((blob) => {
      if (!blob) {
        toast({ title: '이미지 처리에 실패했습니다', description: '사진 크기를 줄여 다시 시도해 주세요', variant: 'destructive' });
        return;
      }
      onConfirm(blob);
    }, 'image/jpeg', 0.9);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-[15px]">주민번호 뒷자리 마스킹</DialogTitle>
          <DialogDescription className="text-[12px]">
            드래그하여 주민번호 뒷자리를 검은색으로 가려주세요. 마스킹 후 업로드됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MousePointer2 className="h-3 w-3" />
            드래그로 영역 선택
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={handleUndo} disabled={rects.length === 0} className="text-[11px] h-7">
            <Eraser className="h-3 w-3 mr-1" />실행 취소
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset} disabled={rects.length === 0} className="text-[11px] h-7">
            <RotateCcw className="h-3 w-3 mr-1" />전체 초기화
          </Button>
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-auto border rounded-md bg-muted/30 flex items-center justify-center min-h-[300px] max-h-[500px]"
        >
          <canvas
            ref={canvasRef}
            className="cursor-crosshair touch-none"
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
        </div>

        <p className="text-[10px] text-muted-foreground text-center mt-1">
          {rects.length > 0 ? `${rects.length}개 영역이 마스킹됩니다` : '가릴 영역을 드래그해 주세요'}
        </p>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-[12px]">취소</Button>
          <Button size="sm" onClick={handleConfirm} className="text-[12px]">
            <Upload className="h-3 w-3 mr-1" />마스킹 후 업로드
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
