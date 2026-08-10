import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { AuthError, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { User, UserRole, OrgMembership } from '@/types';

const PROTECTED_SESSION_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2500];
const LOGIN_SESSION_RETRY_DELAYS_MS = [150, 350, 700, 1200];

/** 마지막으로 보던 조직. UI 필터일 뿐 보안 경계가 아니다 —
 *  실제 권한은 매 쿼리마다 DB 의 RLS 가 org_members 를 조회해 판정한다. */
const ACTIVE_ORG_KEY = 'aicapa.activeOrgId';

/** 역할 우선순위 — 한 조직에서 복수 역할을 가질 수 있으므로
 *  화면 라우팅에 쓸 대표 역할 하나를 고른다. */
const ROLE_RANK: Record<UserRole, number> = {
  org_owner: 5,
  org_admin: 4,
  examiner: 3,
  viewer: 2,
  applicant: 1,
};

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function hasStoredAuthToken() {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
    }
  } catch {
    // localStorage may be unavailable; assume we should retry
    return true;
  }
  return false;
}

async function getSessionWithRetry() {
  const isLoginPath = window.location.pathname === '/login' || window.location.pathname === '/auth/callback';
  const retryDelays = isLoginPath ? LOGIN_SESSION_RETRY_DELAYS_MS : PROTECTED_SESSION_RETRY_DELAYS_MS;

  const { data: initial } = await supabase.auth.getSession();
  if (initial.session?.user) return initial.session;

  // No persisted Supabase auth token → user is signed out. Don't burn ~6s retrying;
  // resolve immediately so protected routes can redirect to /login without a long
  // "로딩 중..." white-screen wait.
  if (!hasStoredAuthToken()) return null;

  for (const delay of retryDelays) {
    await wait(delay);
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session;
  }

  return null;
}

function readStoredOrgId() {
  try {
    return window.localStorage.getItem(ACTIVE_ORG_KEY);
  } catch {
    return null;
  }
}

function storeOrgId(orgId: string | null) {
  try {
    if (orgId) window.localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    else window.localStorage.removeItem(ACTIVE_ORG_KEY);
  } catch {
    // 저장 실패는 무시 — 다음 로드에서 첫 조직으로 떨어질 뿐이다
  }
}

interface LoadedIdentity {
  user: User;
  memberships: OrgMembership[];
  activeOrgId: string | null;
  role: UserRole;
}

interface AuthContextType {
  user: User | null;
  /** 현재 조직에서의 대표 역할. 조직이 없으면 'applicant' */
  role: UserRole;
  /** 현재 조직에서 보유한 모든 역할 */
  roles: UserRole[];
  memberships: OrgMembership[];
  activeOrgId: string | null;
  activeOrg: OrgMembership | null;
  /** 소속 조직이 하나도 없는 상태 — /onboarding 으로 보낸다 */
  needsOnboarding: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | Error | null }>;
  signUp: (email: string, password: string, profileData: { name: string; phone?: string }) => Promise<{ error: AuthError | Error | null }>;
  signOut: () => Promise<void>;
  switchOrg: (orgId: string) => void;
  /** 조직 생성·초대 수락 후 멤버십을 다시 읽는다 */
  refreshMemberships: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hydratedUserIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const sessionSyncIdRef = useRef(0);
  const manualSignOutRef = useRef(false);

  /** 프로필 + 멤버십을 읽는다.
   *
   *  원본은 user_roles 한 줄을 읽어 전역 역할을 정했다. 이제 역할은
   *  조직마다 다르므로 org_members 를 통째로 읽고, 현재 보는 조직에서만
   *  역할을 계산한다. profiles 행은 auth.users 트리거가 만들어 주므로
   *  여기서 만들지 않는다. */
  const loadIdentity = useCallback(async (userId: string, email: string): Promise<LoadedIdentity> => {
    const [profileRes, memberRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase
        .from('org_members')
        .select('org_id, role, status, department, position, organizations(id, slug, name, status)')
        .eq('user_id', userId)
        .eq('status', 'active'),
    ]);

    if (profileRes.error) console.warn('[auth] profile select failed:', profileRes.error);
    if (memberRes.error) console.warn('[auth] membership select failed:', memberRes.error);

    const profile = profileRes.data as { name?: string; phone?: string } | null;

    // PostgREST 임베드 결과. 관계가 1:1 이어도 배열로 올 수 있어 양쪽을 받는다.
    type MemberRow = {
      org_id: string;
      role: UserRole;
      department: string | null;
      position: string | null;
      organizations: OrgRow | OrgRow[] | null;
    };
    type OrgRow = { id: string; slug: string; name: string; status: string };

    const rows = (memberRes.data ?? []) as unknown as MemberRow[];
    const memberships: OrgMembership[] = rows.flatMap(r => {
      const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
      if (!org) return [];
      return [{
        orgId: r.org_id,
        orgName: org.name,
        orgSlug: org.slug,
        orgStatus: org.status,
        role: r.role,
        department: r.department ?? undefined,
        position: r.position ?? undefined,
      }];
    });

    const stored = readStoredOrgId();
    const activeOrgId =
      (stored && memberships.some(m => m.orgId === stored) ? stored : null) ??
      memberships[0]?.orgId ??
      null;

    return {
      memberships,
      activeOrgId,
      role: pickRole(memberships, activeOrgId),
      user: {
        id: userId,
        email,
        name: profile?.name || email.split('@')[0],
        phone: profile?.phone || '',
      },
    };
  }, []);

  const applyIdentity = useCallback((loaded: LoadedIdentity) => {
    setUser(loaded.user);
    setMemberships(loaded.memberships);
    setActiveOrgId(loaded.activeOrgId);
    storeOrgId(loaded.activeOrgId);
    hydratedUserIdRef.current = loaded.user.id;
    currentUserIdRef.current = loaded.user.id;
  }, []);

  const clearUserState = useCallback(() => {
    setUser(null);
    setMemberships([]);
    setActiveOrgId(null);
    storeOrgId(null);
    hydratedUserIdRef.current = null;
    currentUserIdRef.current = null;
  }, []);

  const syncSession = useCallback(async (
    session: Session | null,
    options: { retryMissing?: boolean; showLoader?: boolean } = {},
  ) => {
    const syncId = ++sessionSyncIdRef.current;
    const incomingUserId = session?.user?.id ?? null;
    const shouldShowLoader = options.showLoader ?? (!currentUserIdRef.current || (incomingUserId !== null && incomingUserId !== currentUserIdRef.current));

    if (shouldShowLoader) setLoading(true);

    try {
      const stableSession = session?.user
        ? session
        : options.retryMissing === false
          ? null
          : await getSessionWithRetry();

      if (sessionSyncIdRef.current !== syncId) return;

      if (stableSession?.user) {
        if (currentUserIdRef.current === stableSession.user.id && hydratedUserIdRef.current === stableSession.user.id) return;

        const loaded = await loadIdentity(stableSession.user.id, stableSession.user.email || '');
        if (sessionSyncIdRef.current !== syncId) return;

        applyIdentity(loaded);
        return;
      }

      clearUserState();
    } catch (e) {
      console.error('syncSession error:', e);
      if (sessionSyncIdRef.current === syncId) clearUserState();
    } finally {
      if (sessionSyncIdRef.current === syncId) setLoading(false);
    }
  }, [applyIdentity, clearUserState, loadIdentity]);

  const handleSignedOutEvent = useCallback(() => {
    if (manualSignOutRef.current) {
      manualSignOutRef.current = false;
      sessionSyncIdRef.current += 1;
      clearUserState();
      setLoading(false);
      return;
    }

    void syncSession(null, { retryMissing: true, showLoader: Boolean(currentUserIdRef.current) });
  }, [clearUserState, syncSession]);

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if (!isMounted) return;

      if (event === 'SIGNED_OUT') {
        handleSignedOutEvent();
        return;
      }

      void syncSession(session, { retryMissing: true });
    });

    const initSession = async () => {
      try {
        const session = await getSessionWithRetry();
        if (!isMounted) return;
        await syncSession(session, { retryMissing: false, showLoader: true });
      } catch (e) {
        console.error('initSession error:', e);
        if (isMounted) clearUserState();
      }
    };

    void initSession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [clearUserState, handleSignedOutEvent, syncSession]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };

    setLoading(true);
    hydratedUserIdRef.current = null;
    try {
      applyIdentity(await loadIdentity(data.user.id, data.user.email || ''));
      return { error: null };
    } finally {
      setLoading(false);
    }
  };

  /** 가입 시 역할을 고르지 않는다. 역할은 조직에 속해야 생기고,
   *  조직은 가입 이후 생성하거나 초대를 수락해서 들어간다. */
  const signUp = async (
    email: string,
    password: string,
    profileData: { name: string; phone?: string },
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: profileData.name } },
    });
    if (error || !data.user) return { error: error || new Error('회원가입 실패') };

    // profiles 행은 auth.users 트리거가 만든다. 여기서는 추가 정보만 채운다.
    if (profileData.phone) {
      await supabase.from('profiles').update({ phone: profileData.phone }).eq('id', data.user.id);
    }

    return { error: null };
  };

  const signOut = async () => {
    manualSignOutRef.current = true;
    sessionSyncIdRef.current += 1;
    hydratedUserIdRef.current = null;
    await supabase.auth.signOut();
    clearUserState();
    setLoading(false);
  };

  const switchOrg = useCallback((orgId: string) => {
    setMemberships(current => {
      if (!current.some(m => m.orgId === orgId)) return current;
      setActiveOrgId(orgId);
      storeOrgId(orgId);
      return current;
    });
  }, []);

  const refreshMemberships = useCallback(async () => {
    const userId = currentUserIdRef.current;
    if (!userId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const loaded = await loadIdentity(userId, session?.user?.email || user?.email || '');
    applyIdentity(loaded);
  }, [applyIdentity, loadIdentity, user?.email]);

  const activeOrg = memberships.find(m => m.orgId === activeOrgId) ?? null;
  const roles = memberships.filter(m => m.orgId === activeOrgId).map(m => m.role);

  return (
    <AuthContext.Provider
      value={{
        user,
        role: pickRole(memberships, activeOrgId),
        roles,
        memberships,
        activeOrgId,
        activeOrg,
        needsOnboarding: Boolean(user) && memberships.length === 0,
        loading,
        signIn,
        signUp,
        signOut,
        switchOrg,
        refreshMemberships,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** 현재 조직에서 가장 높은 역할. 조직이 없으면 applicant(최소 권한)로 떨어뜨린다. */
function pickRole(memberships: OrgMembership[], activeOrgId: string | null): UserRole {
  const inOrg = memberships.filter(m => m.orgId === activeOrgId);
  if (inOrg.length === 0) return 'applicant';
  return inOrg.reduce((best, m) => (ROLE_RANK[m.role] > ROLE_RANK[best] ? m.role : best), inOrg[0].role);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
