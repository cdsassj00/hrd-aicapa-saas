import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Smartphone, CheckCircle2, Loader2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  sessionId?: string;
  verified: boolean;
  onVerified: () => void;
}

export default function SmsOtpVerification({ sessionId, verified, onVerified }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<'idle' | 'sent' | 'verifying'>('idle');
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');

  const sendOtp = useCallback(async () => {
    if (!sessionId) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-otp', {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setMaskedPhone(data.phone || '');
      setStep('sent');
      toast({ title: '인증코드 발송', description: `${data.phone || '등록된 번호'}로 인증코드를 보냈습니다.` });
    } catch (err: any) {
      toast({ title: '발송 실패', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  }, [sessionId, toast]);

  const verifyOtp = useCallback(async () => {
    if (!sessionId || code.length !== 6) return;
    setStep('verifying');
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { session_id: sessionId, code },
      });
      if (error) throw error;

      if (data.success) {
        onVerified();
        toast({ title: 'SMS 인증 완료', description: '본인 인증이 완료되었습니다.' });
      } else {
        setStep('sent');
        toast({ title: '인증 실패', description: data.error || '인증코드를 확인해 주세요.', variant: 'destructive' });
      }
    } catch (err: any) {
      setStep('sent');
      toast({ title: '인증 오류', description: err.message, variant: 'destructive' });
    }
  }, [sessionId, code, onVerified, toast]);

  if (verified) {
    return (
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">SMS 본인인증</p>
            <p className="text-[11px] text-muted-foreground">휴대폰 인증이 완료되었습니다</p>
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
      <div className="flex items-center justify-between p-3 rounded-md border bg-card">
        <div className="flex items-center gap-3">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[13px] font-medium">SMS 본인인증</p>
            <p className="text-[11px] text-muted-foreground">
              {step === 'idle' && '가입 시 등록한 휴대폰으로 인증코드를 발송합니다'}
              {step === 'sent' && `${maskedPhone}로 인증코드를 보냈습니다`}
              {step === 'verifying' && '인증코드 확인 중...'}
            </p>
          </div>
        </div>
        {step === 'idle' && (
          <Button variant="outline" size="sm" className="text-[12px]" onClick={sendOtp} disabled={sending}>
            {sending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />발송 중...</> : <><Send className="h-3 w-3 mr-1" />인증코드 발송</>}
          </Button>
        )}
        {step === 'verifying' && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {step === 'sent' && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">6자리 인증코드를 입력해 주세요 (5분 이내)</p>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="text-center text-lg tracking-widest font-mono"
                maxLength={6}
              />
              <Button onClick={verifyOtp} disabled={code.length !== 6} size="sm">
                확인
              </Button>
            </div>
            <Button variant="link" size="sm" className="text-[11px] p-0 h-auto" onClick={sendOtp} disabled={sending}>
              {sending ? '재발송 중...' : '인증코드 재발송'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
