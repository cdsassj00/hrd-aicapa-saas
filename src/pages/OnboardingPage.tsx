import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FullscreenLoader } from '@/components/FullscreenLoader';
import { toast } from 'sonner';
import { Clock, Mail, CreditCard, LogOut, Send } from 'lucide-react';
import { ORG_DOMAIN_SUFFIX } from '@/lib/brand';

/** 서브도메인으로 그대로 쓰이므로 DB 의 organizations_slug_format 과
 *  같은 규칙을 화면에서도 미리 걸러 준다. 최종 판정은 DB 가 한다. */
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export default function OnboardingPage() {
  const { user, memberships, loading, isPlatformAdmin, switchOrg, refreshMemberships, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 승인 요청/독촉 폼 (일반 가입자)
  const [reqOrg, setReqOrg] = useState('');
  const [reqHeadcount, setReqHeadcount] = useState('');
  const [reqMessage, setReqMessage] = useState('');
  const [reqSending, setReqSending] = useState(false);
  const [reqSent, setReqSent] = useState(false);

  const handleRequestAccess = async () => {
    setReqSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-access', {
        body: { org: reqOrg.trim(), headcount: reqHeadcount.trim(), message: reqMessage.trim() },
      });
      const res = (data ?? {}) as { error?: string; ok?: boolean; emailed?: boolean };
      if (error || res.error) {
        toast.error(res.error || '승인 요청 전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      setReqSent(true);
      if (res.emailed === false) {
        // 요청은 기록됐으나 알림 메일 발송은 실패(예: 발신 도메인 미인증).
        toast.success('승인 요청이 접수되었습니다. 담당자가 관리자 화면에서 확인합니다.');
      } else {
        toast.success('담당자에게 승인 요청 메일을 보냈습니다. 승인 후 로그인해 이용할 수 있습니다.');
      }
    } catch {
      toast.error('승인 요청 전송 중 오류가 발생했습니다.');
    } finally {
      setReqSending(false);
    }
  };

  if (loading) return <FullscreenLoader message="세션 확인 중..." />;
  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  const effectiveSlug = slugTouched ? slug : suggestSlug(name);
  const slugValid = SLUG_RE.test(effectiveSlug);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slugValid) return;

    setSubmitting(true);
    try {
      // 조직·소유자 멤버십·브랜딩을 한 트랜잭션으로 만드는 유일한 통로.
      // 0023 이후 플랫폼 운영자만 호출할 수 있다.
      const { data, error } = await supabase.rpc('create_organization', {
        _slug: effectiveSlug,
        _name: name.trim(),
      });

      if (error) {
        const msg = error.message.includes('organizations_slug_key')
          ? '이미 사용 중인 주소입니다. 다른 주소를 입력하세요.'
          : error.message.includes('slug_not_reserved')
            ? '사용할 수 없는 주소입니다. 다른 주소를 입력하세요.'
            : error.message;
        toast.error(msg);
        return;
      }

      const org = Array.isArray(data) ? data[0] : data;
      await refreshMemberships();
      if (org?.id) switchOrg(org.id);
      toast.success(`${name.trim()} 조직을 만들었습니다.`);
      navigate('/', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  // 이미 속한 조직이 있으면(초대 수락 등) 바로 들어갈 수 있게 항상 먼저 보여준다.
  const orgSwitcher = memberships.length > 0 && (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">이미 속한 조직</CardTitle>
        <CardDescription>선택해서 바로 들어갈 수 있습니다.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {memberships.map(m => (
          <Button
            key={`${m.orgId}-${m.role}`}
            variant="outline"
            className="justify-between"
            onClick={() => { switchOrg(m.orgId); navigate('/', { replace: true }); }}
          >
            <span>{m.orgName}</span>
            <span className="text-xs text-muted-foreground">{m.role}</span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      {isPlatformAdmin ? (
        // ── 플랫폼 운영자: 고객사 조직을 직접 프로비저닝한다 ──────────────
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">조직 프로비저닝 (운영자)</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              승인된 고객사의 조직을 만들고, 만든 사람이 소유자(org_owner)가 됩니다.
              진단·평가 데이터는 조직 단위로 완전히 분리됩니다.
            </p>
          </div>

          {orgSwitcher}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">새 조직 만들기</CardTitle>
              <CardDescription>운영자 전용. 일반 가입자는 도입 문의를 거쳐 승인됩니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="org-name">조직 이름</Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="주식회사 에이스엠"
                    required
                    maxLength={80}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="org-slug">주소</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="org-slug"
                      value={effectiveSlug}
                      onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
                      placeholder="acme"
                      required
                      maxLength={63}
                    />
                    {ORG_DOMAIN_SUFFIX && (
                      <span className="whitespace-nowrap text-sm text-muted-foreground">{ORG_DOMAIN_SUFFIX}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    영문 소문자·숫자·하이픈만. 조직을 식별하는 고유 주소이며, 나중에 자체 도메인을 연결할 수 있습니다.
                  </p>
                  {effectiveSlug && !slugValid && (
                    <p className="text-xs text-destructive">
                      주소 형식이 올바르지 않습니다. 영문 소문자로 시작하고 끝나야 합니다.
                    </p>
                  )}
                </div>

                <Button type="submit" disabled={submitting || !name.trim() || !slugValid}>
                  {submitting ? '만드는 중...' : '조직 만들기'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      ) : (
        // ── 일반 가입자: 승인 대기. 자가 조직 생성은 불가(도입문의→승인) ──
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">가입이 완료되었습니다 🎉</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              계정은 만들어졌지만, 아직 연결된 조직(워크스페이스)이 없습니다.
              시스템 이용은 <b>담당자 승인</b>을 거쳐 열립니다.
            </p>
          </div>

          {orgSwitcher}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" /> 승인 후 로그인해 이용할 수 있습니다
              </CardTitle>
              <CardDescription>담당자 승인이 나면 이 계정으로 바로 시스템에 입장합니다.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-[13.5px]">
              <div className="flex gap-3">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <div className="font-medium flex items-center gap-2">
                    크레딧 구매 · 구독 결제 <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">준비 중</span>
                  </div>
                  <p className="text-muted-foreground">
                    응시 인원만큼 크레딧을 구매해 바로 시작하는 방식과 정기 구독은 결제 심사 후 오픈됩니다.
                    지금은 아래로 <b>승인 요청</b>을 보내주세요.
                  </p>
                </div>
              </div>

              {reqSent ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-[13px]">
                  <div className="flex items-center gap-2 font-medium text-primary"><Send className="h-4 w-4" /> 승인 요청을 보냈습니다</div>
                  <p className="mt-1 text-muted-foreground">
                    담당자 검토 후 조직을 개설하고 권한을 부여해 드립니다. 승인 완료 안내를 받으면 다시 로그인해 주세요.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3 text-[13px]" disabled={reqSending} onClick={handleRequestAccess}>
                    한 번 더 독촉하기
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <Mail className="h-4 w-4 text-primary" /> 승인 요청 · 독촉하기
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    담당자(sjshin@cdsa.kr)에게 승인 요청 메일이 전송됩니다. 소속·인원을 남기면 더 빨리 처리됩니다.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Input value={reqOrg} onChange={e => setReqOrg(e.target.value)} placeholder="소속 기관/회사 (선택)" maxLength={80} />
                    <Input value={reqHeadcount} onChange={e => setReqHeadcount(e.target.value)} placeholder="예상 응시 인원 (선택)" maxLength={40} />
                  </div>
                  <textarea
                    value={reqMessage}
                    onChange={e => setReqMessage(e.target.value)}
                    placeholder="도입 목적·희망 시기 등 메모 (선택)"
                    maxLength={1000}
                    rows={2}
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-[13px]"
                  />
                  <Button className="mt-3 w-full text-[13px]" disabled={reqSending} onClick={handleRequestAccess}>
                    {reqSending ? '보내는 중...' : '승인 요청 메일 보내기'}
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <a href="https://ai-hrd.com/#contact"><Button variant="outline" className="text-[13px]">도입 문의 페이지</Button></a>
                <Button variant="outline" className="text-[13px]" onClick={() => navigate('/demo')}>응시 화면 미리보기</Button>
              </div>
            </CardContent>
          </Card>

          <button
            type="button"
            onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}
            className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> 로그아웃
          </button>
        </>
      )}

      <p className="text-center text-xs text-muted-foreground">
        초대를 받으셨나요? 메일의 링크로 들어오시면 조직에 바로 합류합니다.
      </p>
    </div>
  );
}
