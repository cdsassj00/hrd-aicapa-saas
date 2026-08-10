import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface SiteSettings {
  title: string;
  subtitle: string;
  footerOrg: string;
  emailSubjectPrefix: string;
  emailFromName: string;
  emailFromAddress: string;
}

const DEFAULTS: SiteSettings = {
  title: 'AX역량 인증평가 CBT',
  subtitle: 'AI 역량 인증평가 플랫폼',
  footerOrg: '한국데이터사이언티스트협회',
  emailSubjectPrefix: '[행정안전부·NIA]',
  emailFromName: 'AI역량인증 평가',
  emailFromAddress: 'noreply@aicapa.kr',
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
