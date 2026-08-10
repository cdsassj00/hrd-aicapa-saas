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
  const { user, memberships, loading, switchOrg, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      // organizations 에는 INSERT 정책이 없어 직접 insert 는 막혀 있다.
      const { data, error } = await supabase.rpc('create_organization', {
        _slug: effectiveSlug,
        _name: name.trim(),
      });

      if (error) {
        // DB 제약(중복 slug·예약어)이 그대로 올라온다 — 사람이 읽을 말로 바꾼다
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

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">조직을 만들어 시작하세요</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          진단·평가 데이터는 조직 단위로 완전히 분리됩니다. 다른 조직의 데이터는
          관리자라도 볼 수 없습니다.
        </p>
      </div>

      {memberships.length > 0 && (
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
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">새 조직 만들기</CardTitle>
          <CardDescription>만든 사람이 소유자(org_owner)가 됩니다.</CardDescription>
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
                <span className="whitespace-nowrap text-sm text-muted-foreground">.aicapa.io</span>
              </div>
              <p className="text-xs text-muted-foreground">
                영문 소문자·숫자·하이픈만. 나중에 자체 도메인을 연결할 수 있습니다.
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

      <p className="text-center text-xs text-muted-foreground">
        초대를 받으셨나요? 메일의 링크로 들어오시면 조직에 바로 합류합니다.
      </p>
    </div>
  );
}
