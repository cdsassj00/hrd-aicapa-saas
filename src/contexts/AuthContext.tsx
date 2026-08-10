import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { User, UserRole } from '@/types';

const PROTECTED_SESSION_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2500];
const LOGIN_SESSION_RETRY_DELAYS_MS = [150, 350, 700, 1200];

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

interface AuthContextType {
  user: User | null;
  role: UserRole;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, profileData: { name: string; organization: string; department: string; position: string; phone: string }, role: UserRole) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  setRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRoleState] = useState<UserRole>('applicant');
  const [loading, setLoading] = useState(true);
  const hydratedUserIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const sessionSyncIdRef = useRef(0);
  const manualSignOutRef = useRef(false);

  const loadUser = useCallback(async (userId: string, email: string): Promise<{ user: User; role: UserRole }> => {
    try {
      const { data: existingProfile, error: profileSelectErr } = await supabase
        .from('profiles').select('id').eq('id', userId).maybeSingle();
      if (profileSelectErr) console.warn('[auth] profile select failed:', profileSelectErr);

      if (!existingProfile) {
        const { error: profileInsertErr } = await supabase
          .from('profiles').insert({ id: userId, name: email.split('@')[0] } as any);
        if (profileInsertErr) console.warn('[auth] profile insert failed:', profileInsertErr);
      }

      const { data: existingRole, error: roleSelectErr } = await supabase
        .from('user_roles').select('role').eq('user_id', userId).maybeSingle();
      if (roleSelectErr) console.warn('[auth] role select failed:', roleSelectErr);

      if (!existingRole) {
        const { error: rpcErr } = await supabase
          .rpc('set_user_role', { _user_id: userId, _role: 'applicant' } as any);
        if (rpcErr) console.warn('[auth] set_user_role RPC failed:', rpcErr);
      }


      const [profileRes, roleRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
      ]);

      const profile = profileRes.data;
      const userRole = (roleRes.data?.role as UserRole) || 'applicant';

      return {
        role: userRole,
        user: {
          id: userId,
          email,
          name: profile?.name || email.split('@')[0],
          role: userRole,
          organization: profile?.organization || '',
          department: profile?.department || '',
          position: profile?.position || '',
          phone: profile?.phone || '',
        },
      };
    } catch (e) {
      console.error('loadUser error:', e);
      throw e;
    }
  }, []);

  const clearUserState = useCallback(() => {
    setUser(null);
    setRoleState('applicant');
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

        const loaded = await loadUser(stableSession.user.id, stableSession.user.email || '');
        if (sessionSyncIdRef.current !== syncId) return;

        setRoleState(loaded.role);
        setUser(loaded.user);
        hydratedUserIdRef.current = loaded.user.id;
        currentUserIdRef.current = loaded.user.id;
        return;
      }

      clearUserState();
    } catch (e) {
      console.error('syncSession error:', e);
      if (sessionSyncIdRef.current === syncId) clearUserState();
    } finally {
      if (sessionSyncIdRef.current === syncId) setLoading(false);
    }
  }, [clearUserState, loadUser]);

  const applyLoadedUser = useCallback((loaded: { user: User; role: UserRole }) => {
    setRoleState(loaded.role);
    setUser(loaded.user);
    hydratedUserIdRef.current = loaded.user.id;
    currentUserIdRef.current = loaded.user.id;
  }, []);

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
      const loaded = await loadUser(data.user.id, data.user.email || '');
      applyLoadedUser(loaded);
      return { error: null };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (
    email: string,
    password: string,
    profileData: { name: string; organization: string; department: string; position: string; phone: string },
    selectedRole: UserRole
  ) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user) return { error: error || new Error('회원가입 실패') };

    await supabase.from('profiles').insert({
      id: data.user.id,
      ...profileData,
    } as any);

    await supabase.rpc('set_user_role', { _user_id: data.user.id, _role: selectedRole } as any);

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

  const setRole = (newRole: UserRole) => {
    if (!user) return;
    setRoleState(newRole);
    setUser(prev => prev ? { ...prev, role: newRole } : null);
    supabase.rpc('set_user_role', { _user_id: user.id, _role: newRole } as any);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signUp, signOut, setRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
