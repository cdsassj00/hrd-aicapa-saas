import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/brand';

/** 테넌트별 화이트라벨 설정.
 *
 *  원본은 전역 단일 행 테이블 site_settings 를 읽었는데, squash 재설계에서
 *  org_branding(테넌트별)으로 대체됐다(0002). 화면이 그대로 남아 있어 로그인마다
 *  404 가 나고 설정 저장이 실패했다 — 이제 org_branding 을 본다(0027).
 *
 *  로그인 전에는 볼 조직이 없으므로 제품 기본값으로 떨어진다. */
interface SiteSettings {
  title: string;
  subtitle: string;
  footerOrg: string;
  emailSubjectPrefix: string;
  emailFromName: string;
  emailFromAddress: string;
}

/** 조직이 값을 설정하기 전의 표시용 기본값.
 *  발신 주소 기본값은 두지 않습니다 — 잘못된 도메인으로 메일을 보내느니
 *  비워 두고 Edge Function 의 MAIL_FROM 이 판정하게 하는 편이 안전합니다. */
const DEFAULTS: SiteSettings = {
  title: PRODUCT_NAME,
  subtitle: PRODUCT_TAGLINE,
  footerOrg: '',
  emailSubjectPrefix: '',
  emailFromName: PRODUCT_NAME,
  emailFromAddress: '',
};

type BrandingRow = {
  site_title: string | null;
  site_subtitle: string | null;
  footer_org: string | null;
  email_subject_prefix: string | null;
  email_from_name: string | null;
  email_from_address: string | null;
};

const COLUMNS = 'site_title, site_subtitle, footer_org, email_subject_prefix, email_from_name, email_from_address';

function toSettings(row: BrandingRow | null): SiteSettings {
  if (!row) return DEFAULTS;
  return {
    title: row.site_title || DEFAULTS.title,
    subtitle: row.site_subtitle || DEFAULTS.subtitle,
    footerOrg: row.footer_org || DEFAULTS.footerOrg,
    emailSubjectPrefix: row.email_subject_prefix || DEFAULTS.emailSubjectPrefix,
    emailFromName: row.email_from_name || DEFAULTS.emailFromName,
    emailFromAddress: row.email_from_address || DEFAULTS.emailFromAddress,
  };
}

async function fetchSettings(orgId: string | null): Promise<SiteSettings> {
  if (!orgId) return DEFAULTS; // 로그인 전 — 볼 조직이 없다
  const { data } = await supabase
    .from('org_branding')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .maybeSingle();
  return toSettings(data as BrandingRow | null);
}

export function useSiteSettings() {
  const { activeOrgId } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['site-settings', activeOrgId],
    queryFn: () => fetchSettings(activeOrgId),
    staleTime: 5 * 60 * 1000,
  });

  return { settings: data ?? DEFAULTS, isLoading };
}

export function useUpdateSiteSettings() {
  const queryClient = useQueryClient();
  const { activeOrgId } = useAuth();

  return useMutation({
    mutationFn: async (updates: Partial<SiteSettings>) => {
      if (!activeOrgId) throw new Error('조직을 선택한 뒤에 설정을 저장할 수 있습니다.');

      const patch: Record<string, string> = {};
      if (updates.title !== undefined) patch.site_title = updates.title;
      if (updates.subtitle !== undefined) patch.site_subtitle = updates.subtitle;
      if (updates.footerOrg !== undefined) patch.footer_org = updates.footerOrg;
      if (updates.emailSubjectPrefix !== undefined) patch.email_subject_prefix = updates.emailSubjectPrefix;
      if (updates.emailFromName !== undefined) patch.email_from_name = updates.emailFromName;
      if (updates.emailFromAddress !== undefined) patch.email_from_address = updates.emailFromAddress;
      if (Object.keys(patch).length === 0) return;

      // org_branding 행은 조직 생성 시 만들어진다(create_organization). 없으면 만들어 준다.
      const { error } = await supabase
        .from('org_branding')
        .upsert({ org_id: activeOrgId, ...patch }, { onConflict: 'org_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
    },
  });
}
