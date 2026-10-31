import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Building2, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/** 현장 시험: 감독관이 알려준 6자리 입실 코드 입력 (0047). */
export default function OnsiteCodeCard({ sessionId, verified, onVerified }: {
  sessionId: string; verified: boolean; onVerified: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async () => {
    setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('verify_onsite_code', { _session_id: sessionId, _code: code });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    if (data === 'ok') { onVerified(); return; }
    setMsg({
      wrong: '입실 코드가 맞지 않습니다. 감독관에게 다시 확인해 주세요.',
      locked: '입력 횟수를 초과했습니다. 감독관에게 잠금 해제를 요청해 주세요.',
      no_code: '아직 입실 코드가 발급되지 않았습니다. 감독관에게 문의해 주세요.',
    }[data as string] ?? '확인하지 못했습니다.');
  };

  return (
    <div className="p-4 rounded-md border space-y-3" data-testid="onsite-card">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-medium">현장 시험 입실 확인</span>
        {verified && <CheckCircle2 className="h-4 w-4 text-success ml-auto" />}
      </div>
      {verified ? (
        <p className="text-[12px] text-muted-foreground">입실이 확인되었습니다.</p>
      ) : (
        <>
          <p className="text-[12px] text-muted-foreground">
            감독관에게 신분증을 확인받은 뒤, 감독관이 알려주는 <b>6자리 입실 코드</b>를 입력하세요.
            이 시험은 웹캠·화면 녹화를 하지 않습니다.
          </p>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="w-32 font-mono tracking-widest text-center"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) submit(); }}
            />
            <Button onClick={submit} disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '확인'}
            </Button>
          </div>
          {msg && <p className="text-[12px] text-destructive">{msg}</p>}
        </>
      )}
    </div>
  );
}
