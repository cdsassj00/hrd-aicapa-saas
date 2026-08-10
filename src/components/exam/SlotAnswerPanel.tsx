import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, CheckCircle2, FileText, Link2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { anonStorage } from '@/integrations/supabase/anonStorageClient';
import type { SubmissionSlot } from '@/lib/examStructure';
import { cn } from '@/lib/utils';

interface Props {
  questionId: string;
  sessionId: string;
  slots: SubmissionSlot[];
  values: Record<string, string>;   // slotId → 현재 값 (text/number/url/long_text 또는 file storage path)
  onChange: (slotId: string, value: string) => void;
  showRubric?: boolean;
}

/**
 * 슬롯별 입력칸 렌더링.
 * - text / short → Input
 * - number       → Input type=number
 * - url          → Input type=url
 * - long_text    → Textarea
 * - file         → 파일 업로드 (storage path 저장)
 *
 * 저장은 onChange 콜백에 위임 (부모에서 debounce + DB upsert).
 */
export default function SlotAnswerPanel({ questionId, sessionId, slots, values, onChange, showRubric = false }: Props) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  // 원본 파일명을 storage key에 안전하게 끼워넣기 위한 base64url 인코딩 (UTF-8 지원)
  const encodeName = (name: string) => {
    const bytes = new TextEncoder().encode(name);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const handleFileUpload = async (slot: SubmissionSlot, file: File) => {
    const maxMb = slot.max_size_mb ?? 20;
    if (file.size > maxMb * 1024 * 1024) {
      toast({ title: '파일 크기 초과', description: `최대 ${maxMb}MB까지 업로드 가능합니다.`, variant: 'destructive' });
      return;
    }
    setUploading(prev => ({ ...prev, [slot.id]: true }));
    // 확장자 추출 (ASCII 안전하게)
    const extMatch = file.name.match(/\.([A-Za-z0-9]{1,10})$/);
    const ext = (extMatch?.[1] || 'bin').toLowerCase();
    // 원본 이름을 base64url로 인코딩해 경로에 보존 → 다운로드/표시 시 디코딩
    const encoded = encodeName(file.name).slice(0, 180);
    const path = `slots/${sessionId}/${questionId}/${slot.id}_${Date.now()}_n-${encoded}.${ext}`;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await anonStorage.storage.from('answer-files').upload(path, file, {
        upsert: false, // path에 Date.now() 포함되어 충돌 없음 → SELECT 사전조회 우회
        contentType: file.type || undefined,
      });
      if (!error) { lastErr = null; break; }
      lastErr = error;
      if (attempt < 3) await new Promise(r => setTimeout(r, 400 * attempt));
    }
    setUploading(prev => ({ ...prev, [slot.id]: false }));
    if (lastErr) {
      toast({ title: '파일 업로드 실패', description: lastErr.message, variant: 'destructive' });
      return;
    }
    onChange(slot.id, path);
    toast({ title: '파일 업로드 완료', description: file.name });
  };

  // 경로에서 원본 파일명 복원
  const displayName = (path: string): string => {
    try {
      const last = path.split('/').pop() || '';
      const m = last.match(/_n-([A-Za-z0-9_-]+)\.[A-Za-z0-9]+$/);
      if (!m) return last.split('_').slice(2).join('_') || last;
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const bin = atob(padded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch {
      return path.split('/').pop() || path;
    }
  };

  return (
    <div className="space-y-4">
      {slots.map((slot, idx) => {
        const value = values[slot.id] ?? '';
        const isFilled = value.trim().length > 0;
        return (
          <div key={slot.id} className={cn(
            "rounded-lg border p-4 space-y-2.5",
            isFilled ? "border-success/40 bg-success/5" : "bg-card",
          )}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <span className="text-[13.5px] font-semibold leading-[1.55] text-foreground break-words">
                  <span className="text-primary mr-1">{idx + 1}.</span>
                  {slot.label?.trim() || `항목 ${idx + 1}`}
                  {slot.required !== false && <span className="text-destructive ml-1">*</span>}
                </span>
                {isFilled && <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />}
              </div>
              <Badge variant="outline" className="text-[11px] shrink-0 whitespace-nowrap">{slot.max_score}점</Badge>
            </div>

            {showRubric && slot.rubric && (
              <div className="text-[12px] leading-relaxed text-muted-foreground bg-muted/40 border border-border/60 rounded px-2.5 py-1.5">
                💡 {slot.rubric}
              </div>
            )}

            {slot.type === 'long_text' && (
              <Textarea
                value={value}
                onChange={(e) => onChange(slot.id, e.target.value)}
                placeholder={slot.placeholder || '답안을 작성하세요...'}
                maxLength={slot.max_length || 5000}
                className="min-h-[120px] text-[13px]"
              />
            )}

            {slot.type === 'text' && (
              <Input
                value={value}
                onChange={(e) => onChange(slot.id, e.target.value)}
                placeholder={slot.placeholder || '답안을 입력하세요'}
                maxLength={slot.max_length || 500}
                className="text-[13px]"
              />
            )}

            {slot.type === 'number' && (
              <Input
                type="number"
                value={value}
                onChange={(e) => onChange(slot.id, e.target.value)}
                onWheel={(e) => (e.target as HTMLElement).blur()}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                  }
                }}
                placeholder={slot.placeholder || '숫자만 입력'}
                className="text-[13px]"
              />
            )}

            {slot.type === 'url' && (
              <div className="relative">
                <Link2 className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="url"
                  value={value}
                  onChange={(e) => onChange(slot.id, e.target.value)}
                  placeholder={slot.placeholder || 'https://...'}
                  className="text-[13px] pl-8"
                />
              </div>
            )}

            {slot.type === 'file' && (
              <div className="space-y-1.5">
                <input
                  type="file"
                  id={`slot-file-${questionId}-${slot.id}`}
                  className="hidden"
                  accept={slot.accept || undefined}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(slot, f);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[12px] w-full justify-start"
                  disabled={uploading[slot.id]}
                  onClick={() => document.getElementById(`slot-file-${questionId}-${slot.id}`)?.click()}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {uploading[slot.id]
                    ? '업로드 중...'
                    : isFilled
                      ? '다른 파일로 교체'
                      : `파일 선택 ${slot.accept ? `(${slot.accept})` : ''}`}
                </Button>
                {isFilled && (
                  <p className="text-[11px] text-success flex items-center gap-1 break-all">
                    <FileText className="h-3 w-3 shrink-0" />
                    제출됨: {displayName(value)}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  최대 {slot.max_size_mb || 20}MB
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
