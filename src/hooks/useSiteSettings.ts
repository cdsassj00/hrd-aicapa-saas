import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/brand';

interface SiteSettings {
  title: string;
  subtitle: string;
  footerOrg: string;
  emailSubjectPrefix: string;
  emailFromName: string;
  emailFromAddress: string;
}

/** 조직이 값을 설정하기 전의 표시용 기본값.
 *  원본 브랜딩(행정안전부·NIA·CDSA·aicapa.kr)은 전부 걷어냈습니다.
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

const KEY_MAP: Record<string, keyof SiteSettings> = {
  site_title: 'title',
  site_subtitle: 'subtitle',
  footer_org: 'footerOrg',
  email_subject_prefix: 'emailSubjectPrefix',
  email_from_name: 'emailFromName',
  email_from_address: 'emailFromAddress',
};

const REVERSE_MAP: Record<keyof SiteSettings, string> = {
  title: 'site_title',
  subtitle: 'site_subtitle',
  footerOrg: 'footer_org',
  emailSubjectPrefix: 'email_subject_prefix',
  emailFromName: 'email_from_name',
  emailFromAddress: 'email_from_address',
};

async function fetchSettings(): Promise<SiteSettings> {
  const { data } = await supabase.from('site_settings').select('key, value');
  const settings = { ...DEFAULTS };
  if (data) {
    for (const row of data) {
      const field = KEY_MAP[row.key];
      if (field) settings[field] = row.value;
    }
  }
  return settings;
}

export function useSiteSettings() {
  const { data, isLoading } = useQuery({
    queryKey: ['site-settings'],
    queryFn: fetchSettings,
    staleTime: 5 * 60 * 1000,
  });

  return { settings: data ?? DEFAULTS, isLoading };
}

export function useUpdateSiteSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<SiteSettings>) => {
      for (const [field, value] of Object.entries(updates)) {
        const dbKey = REVERSE_MAP[field as keyof SiteSettings];
        if (!dbKey) continue;
        const { error } = await supabase
          .from('site_settings')
          .update({ value, updated_at: new Date().toISOString() })
          .eq('key', dbKey);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
    },
  });
}
